import { describe, expect, it } from "vitest";

import {
  assertAllowedOperation,
  buildApiUrl,
  resolveApiBaseUrl,
} from "../src/openapi.js";

const spec = {
  openapi: "3.1.0",
  servers: [{ url: "/v1" }],
  paths: {
    "/pets": { get: {}, post: {} },
    "/pets/{petId}": { get: {}, delete: {} },
  },
};

describe("resolveApiBaseUrl", () => {
  it("resolves relative OpenAPI servers against the schema URL", () => {
    expect(resolveApiBaseUrl(spec, "https://api.example.com/docs/openapi.json")).toBe(
      "https://api.example.com/v1/",
    );
  });

  it("expands server variables and honors an explicit override", () => {
    const variableSpec = {
      servers: [
        {
          url: "https://{region}.example.com/{version}",
          variables: {
            region: { default: "eu" },
            version: { default: "v2" },
          },
        },
      ],
    };

    expect(resolveApiBaseUrl(variableSpec, "https://schemas.example.com/openapi.json")).toBe(
      "https://eu.example.com/v2/",
    );
    expect(
      resolveApiBaseUrl(variableSpec, "https://schemas.example.com/openapi.json", "https://proxy.test/api"),
    ).toBe("https://proxy.test/api/");
  });

  it("rejects non-HTTP API servers", () => {
    expect(() => resolveApiBaseUrl({ servers: [{ url: "file:///etc" }] }, "https://example.com/spec")).toThrow(
      "HTTP",
    );
  });

  it("prefers operation and Path Item servers for the matched operation", () => {
    const serverSpec = {
      servers: [{ url: "https://root.example.com" }],
      paths: {
        "/operation": {
          servers: [{ url: "https://path.example.com" }],
          get: { servers: [{ url: "https://operation.example.com" }] },
        },
        "/path": {
          servers: [{ url: "https://path.example.com" }],
          get: {},
        },
        "/root": { get: {} },
      },
    };

    expect(
      resolveApiBaseUrl(serverSpec, "https://schemas.example.com/openapi.json", undefined, {
        method: "GET",
        path: "/operation",
      }),
    ).toBe("https://operation.example.com/");
    expect(
      resolveApiBaseUrl(serverSpec, "https://schemas.example.com/openapi.json", undefined, {
        method: "GET",
        path: "/path",
      }),
    ).toBe("https://path.example.com/");
    expect(
      resolveApiBaseUrl(serverSpec, "https://schemas.example.com/openapi.json", "https://override.test/api", {
        method: "GET",
        path: "/operation",
      }),
    ).toBe("https://override.test/api/");
    expect(
      resolveApiBaseUrl(serverSpec, "https://schemas.example.com/openapi.json", undefined, {
        method: "GET",
        path: "/root",
      }),
    ).toBe("https://root.example.com/");
    expect(
      resolveApiBaseUrl({ paths: { "/fallback": { get: {} } } }, "https://schemas.example.com/openapi.json", undefined, {
        method: "GET",
        path: "/fallback",
      }),
    ).toBe("https://schemas.example.com/");
  });

  it("matches concrete paths before templated paths", () => {
    const overlappingSpec = {
      paths: {
        "/pets/{petId}": { get: { servers: [{ url: "https://templated.example.com" }] } },
        "/pets/special": { get: { servers: [{ url: "https://concrete.example.com" }] } },
      },
    };

    expect(
      resolveApiBaseUrl(overlappingSpec, "https://schemas.example.com/openapi.json", undefined, {
        method: "GET",
        path: "/pets/special",
      }),
    ).toBe("https://concrete.example.com/");
  });
});

describe("assertAllowedOperation", () => {
  it("accepts declared reads and parameterized paths", () => {
    expect(() => assertAllowedOperation(spec, "GET", "/pets/capybara", false)).not.toThrow();
  });

  it("rejects undeclared paths and methods", () => {
    expect(() => assertAllowedOperation(spec, "GET", "/users", false)).toThrow("not declared");
    expect(() => assertAllowedOperation(spec, "PUT", "/pets/capybara", true)).toThrow("not declared");
  });

  it("blocks mutations by default", () => {
    expect(() => assertAllowedOperation(spec, "DELETE", "/pets/capybara", false)).toThrow(
      "Mutating",
    );
    expect(() => assertAllowedOperation(spec, "DELETE", "/pets/capybara", true)).not.toThrow();
  });

  it("rejects traversal and URL-like paths", () => {
    expect(() => assertAllowedOperation(spec, "GET", "/pets/../admin", false)).toThrow("Invalid API path");
    expect(() => assertAllowedOperation(spec, "GET", "//evil.test/pets", false)).toThrow("Invalid API path");
    expect(() => assertAllowedOperation(spec, "GET", "/pets/%2e%2e%2fadmin", false)).toThrow(
      "Invalid API path",
    );
    expect(() => assertAllowedOperation(spec, "GET", "/pets/id%5cadmin", false)).toThrow(
      "Invalid API path",
    );
  });

  it("resolves local Path Item references", () => {
    const referencedSpec = {
      paths: {
        "/pets": { $ref: "#/components/pathItems/Pets" },
      },
      components: {
        pathItems: {
          Pets: { get: {} },
        },
      },
    };

    expect(() => assertAllowedOperation(referencedSpec, "GET", "/pets", false)).not.toThrow();
  });

  it("rejects invalid and cyclic local Path Item references", () => {
    const missingRefSpec = {
      paths: { "/pets": { $ref: "#/components/pathItems/Missing" } },
      components: { pathItems: {} },
    };
    const cyclicRefSpec = {
      paths: { "/pets": { $ref: "#/components/pathItems/First" } },
      components: {
        pathItems: {
          First: { $ref: "#/components/pathItems/Second" },
          Second: { $ref: "#/components/pathItems/First" },
        },
      },
    };

    expect(() => assertAllowedOperation(missingRefSpec, "GET", "/pets", false)).toThrow("Invalid local");
    expect(() => assertAllowedOperation(cyclicRefSpec, "GET", "/pets", false)).toThrow("cyclic");
  });
});

describe("buildApiUrl", () => {
  it("preserves the server base path and adds query values", () => {
    expect(
      buildApiUrl("https://api.example.com/v1/", "/pets/capybara", {
        active: true,
        limit: 20,
      }).toString(),
    ).toBe("https://api.example.com/v1/pets/capybara?active=true&limit=20");
  });

  it("keeps scheme-like path segments on the configured origin", () => {
    const url = buildApiUrl("https://api.example.com/v1/", "/http:evil.com");

    expect(url.toString()).toBe("https://api.example.com/v1/http:evil.com");
    expect(url.origin).toBe("https://api.example.com");
  });
});
