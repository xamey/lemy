import { describe, expect, it, vi } from "vitest";

import { isBearerAuthorization, validateBearer } from "../src/worker/bearer-validation";

describe("bearer validation", () => {
  it("requires a well-formed bearer header", () => {
    expect(isBearerAuthorization("Bearer token")).toBe(true);
    expect(isBearerAuthorization("Bearer")).toBe(false);
  });

  it("returns a stable opaque principal scope", async () => {
    const fetchFn = vi.fn(async () => Response.json({ sub: "user-1", tenant: "workspace-1" }));
    const first = await validateBearer("Bearer token-a", "https://api.example.com/me", fetchFn);
    const second = await validateBearer("Bearer token-b", "https://api.example.com/me", fetchFn);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
    expect(fetchFn).toHaveBeenCalledWith("https://api.example.com/me", expect.objectContaining({
      headers: { Authorization: "Bearer token-a" },
      redirect: "manual",
    }));
  });

  it("rejects inactive, expired, and malformed identities", async () => {
    await expect(validateBearer("Bearer token", "https://api.example.com/me", async () =>
      Response.json({ sub: "user-1", active: false }))).rejects.toMatchObject({ status: 401 });
    await expect(validateBearer("Bearer token", "https://api.example.com/me", async () =>
      Response.json({ sub: "user-1", exp: 99 }), 100)).rejects.toMatchObject({ status: 401 });
    await expect(validateBearer("Bearer token", "https://api.example.com/me", async () =>
      Response.json({ active: true }))).rejects.toMatchObject({ status: 401 });
  });

  it("bounds the validation response", async () => {
    await expect(validateBearer("Bearer token", "https://api.example.com/me", async () =>
      new Response("x".repeat(16_385)))).rejects.toMatchObject({ status: 401 });
  });
});
