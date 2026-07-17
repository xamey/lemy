import { afterEach, describe, expect, it, vi } from "vitest";

const { createMcpHandlerMock, openApiMcpServerMock } = vi.hoisted(() => ({
  createMcpHandlerMock: vi.fn(),
  openApiMcpServerMock: vi.fn(),
}));

vi.mock("@cloudflare/codemode", () => ({
  DynamicWorkerExecutor: class {},
}));
vi.mock("@cloudflare/codemode/mcp", () => ({
  openApiMcpServer: openApiMcpServerMock,
}));
vi.mock("agents/mcp", () => ({
  createMcpHandler: createMcpHandlerMock,
}));

import worker, { parseResponse } from "../src/server.js";

const authorization = "Bearer top-secret-token";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("parseResponse", () => {
  it("recursively redacts credentials from successful JSON payloads", async () => {
    const response = Response.json({
      authorization,
      nested: [{ token: "top-secret-token" }],
      message: `received ${authorization}`,
    });

    await expect(parseResponse(response, authorization)).resolves.toEqual({
      authorization: "[REDACTED]",
      nested: [{ token: "[REDACTED]" }],
      message: "received [REDACTED]",
    });
  });

  it("redacts credentials from upstream error text", async () => {
    const response = new Response(`upstream echoed ${authorization} and top-secret-token`, {
      status: 401,
    });

    await expect(parseResponse(response, authorization)).rejects.toThrow(
      "API request failed: 401 upstream echoed [REDACTED] and [REDACTED]",
    );
  });
});

describe("health", () => {
  it("loads and caches the configured schema with a timeout signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        openapi: "3.1.0",
        info: { title: "Test", version: "1.0.0" },
        paths: {},
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const env = { OPENAPI_SCHEMA_URL: "https://schemas.example.com/health-openapi.json" } as never;

    const first = await worker.fetch(
      new Request("https://worker.test/health") as never,
      env,
      {} as never,
    );
    const second = await worker.fetch(
      new Request("https://worker.test/health") as never,
      env,
      {} as never,
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports unhealthy when the schema cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    const env = { OPENAPI_SCHEMA_URL: "https://schemas.example.com/unavailable-openapi.json" } as never;

    const response = await worker.fetch(
      new Request("https://worker.test/health") as never,
      env,
      {} as never,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unhealthy" });
  });

  it("reports unhealthy when the schema is not an OpenAPI document", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: "not a schema" })));
    const env = { OPENAPI_SCHEMA_URL: "https://schemas.example.com/invalid-openapi.json" } as never;

    const response = await worker.fetch(
      new Request("https://worker.test/health") as never,
      env,
      {} as never,
    );

    expect(response.status).toBe(503);
  });

  it("reports unhealthy when the schema URL is missing", async () => {
    const response = await worker.fetch(
      new Request("https://worker.test/health") as never,
      {} as never,
      {} as never,
    );

    expect(response.status).toBe(503);
  });
});

describe("API requests", () => {
  it("uses operation servers, a timeout signal, and redacts the result", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          openapi: "3.1.0",
          info: { title: "Test", version: "1.0.0" },
          servers: [{ url: "https://root.example.com" }],
          paths: {
            "/pets": {
              get: { servers: [{ url: "https://operation.example.com/v1" }] },
            },
          },
        }),
      )
      .mockResolvedValueOnce(Response.json({ echoed: authorization }));
    vi.stubGlobal("fetch", fetchMock);
    openApiMcpServerMock.mockImplementation((options) => options);
    createMcpHandlerMock.mockImplementation(
      (server) => async () =>
        Response.json(await server.request({ method: "GET", path: "/pets", query: {} })),
    );
    const env = {
      LOADER: {},
      OPENAPI_SCHEMA_URL: "https://schemas.example.com/request-openapi.json",
    } as never;

    const response = await worker.fetch(
      new Request("https://worker.test/mcp", {
        headers: { Authorization: authorization },
      }) as never,
      env,
      {} as never,
    );

    await expect(response.json()).resolves.toEqual({ echoed: "[REDACTED]" });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL("https://operation.example.com/v1/pets"),
      expect.objectContaining({
        redirect: "manual",
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
