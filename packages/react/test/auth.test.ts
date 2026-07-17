import { describe, expect, it } from "vitest";

import { toAuthorizationHeader } from "../src/auth.js";

describe("toAuthorizationHeader", () => {
  it("accepts a raw token", () => {
    expect(toAuthorizationHeader("api-token")).toBe("Bearer api-token");
  });

  it("does not duplicate an existing bearer scheme", () => {
    expect(toAuthorizationHeader("Bearer api-token")).toBe("Bearer api-token");
    expect(toAuthorizationHeader("bearer api-token")).toBe("bearer api-token");
  });

  it("rejects empty credentials", () => {
    expect(() => toAuthorizationHeader("  ")).toThrow("bearerToken");
  });

  it("rejects malformed credentials", () => {
    expect(() => toAuthorizationHeader("Bearer")).toThrow("invalid");
    expect(() => toAuthorizationHeader("two tokens")).toThrow("invalid");
  });
});
