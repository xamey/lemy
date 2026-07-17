import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createApp,
  isBearerAuthorization,
  validateBearer,
  type RuntimeSettings,
} from "../src/app.js";

const settings: RuntimeSettings = {
  agentUrl: "http://agent.test/agent",
  bearerValidationUrl: "https://api.test/me",
  corsOrigins: ["http://localhost:3000"],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isBearerAuthorization", () => {
  it("requires a non-empty bearer credential", () => {
    expect(isBearerAuthorization("Bearer api-token")).toBe(true);
    expect(isBearerAuthorization("bearer api-token")).toBe(true);
    expect(isBearerAuthorization("Basic api-token")).toBe(false);
    expect(isBearerAuthorization("Bearer ")).toBe(false);
  });
});

describe("validateBearer", () => {
  it("sends the bearer to the configured validation URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      validateBearer("Bearer api-token", "https://api.test/me", fetchImpl),
    ).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.test/me",
      expect.objectContaining({
        headers: { Authorization: "Bearer api-token" },
        method: "GET",
        redirect: "manual",
      }),
    );
  });

  it("rejects unauthorized validation responses", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));

    await expect(
      validateBearer("Bearer api-token", "https://api.test/me", fetchImpl),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("fails closed when validation cannot be reached", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));

    await expect(
      validateBearer("Bearer api-token", "https://api.test/me", fetchImpl),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("runtime server", () => {
  it("keeps health checks public", async () => {
    await request(createApp(settings)).get("/health").expect(200, { status: "ok" });
  });

  it("rejects runtime requests without a bearer", async () => {
    await request(createApp(settings))
      .get("/api/copilotkit/info")
      .expect(401, { error: "Bearer token required" });
  });

  it("allows unauthenticated CORS preflight requests", async () => {
    await request(createApp(settings))
      .options("/api/copilotkit/info")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "GET")
      .expect(204);
  });

  it("establishes the bearer scope for runner requests", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 })));
    const threadId = crypto.randomUUID();
    const response = await request(createApp(settings))
      .post(`/api/copilotkit/agent/default/stop/${threadId}`)
      .set("Authorization", "Bearer api-token")
      .expect(200);

    expect(response.body.stopped).toBe(false);
  });

  it("advertises the AG-UI agent to authenticated clients", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 })));
    const response = await request(createApp(settings))
      .get("/api/copilotkit/info")
      .set("Authorization", "Bearer api-token")
      .expect(200);

    expect(JSON.stringify(response.body)).toContain("default");
    expect(response.body.threadEndpoints).toEqual({
      inspect: false,
      list: false,
      mutations: false,
      realtimeMetadata: false,
    });
  });
});
