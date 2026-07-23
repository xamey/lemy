import { describe, expect, it, vi } from "vitest";

import { createRuntimeSession, parseRuntimeUrl, runtimeAgentPath } from "../src/runtime.js";

describe("Lemy runtime sessions", () => {
  it("accepts HTTPS and loopback runtime URLs", () => {
    expect(parseRuntimeUrl("https://lemy.example.com/runtime/project/").pathname).toBe("/runtime/project");
    expect(parseRuntimeUrl("http://localhost:8788/runtime/project").origin).toBe("http://localhost:8788");
    expect(() => parseRuntimeUrl("http://lemy.example.com/runtime/project")).toThrow("HTTPS");
  });

  it("builds the deterministic Think agent path", () => {
    expect(runtimeAgentPath(
      "https://lemy.example.com/runtime/project",
      "94e3456c-25d8-4e56-954d-e4a1dc00e6d5",
    )).toBe("runtime/project/agent/94e3456c-25d8-4e56-954d-e4a1dc00e6d5");
  });

  it("exchanges the customer bearer only over the session endpoint", async () => {
    const threadId = "94e3456c-25d8-4e56-954d-e4a1dc00e6d5";
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://lemy.example.com/runtime/project/session");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer customer-secret");
      return Response.json({
        expiresAt: 2_000_000_000,
        protocol: "cloudflare-think",
        runtimePath: `/runtime/project/agent/${threadId}`,
        threadId,
        token: "opaque-session",
      });
    });

    const session = await createRuntimeSession({
      approvedTools: ["api.listTasks"],
      bearerToken: "customer-secret",
      runtimeUrl: "https://lemy.example.com/runtime/project",
      threadId,
      toolApprovalMode: "ask",
    }, fetchFn as typeof fetch);

    expect(session.token).toBe("opaque-session");
    expect(fetchFn).toHaveBeenCalledOnce();
  });
});
