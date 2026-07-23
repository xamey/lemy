import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getProviderApiKey,
  listProviderConfigurations,
  saveValidatedProviderCredential,
  validateProviderApiKey,
} from "../src/worker/provider-credentials";

describe("workspace provider credentials", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM provider_credential WHERE owner_id = 'provider-user'").run();
    const now = Date.now();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    ).bind("provider-user", "Provider user", "provider@example.com", now, now).run();
  });

  it("validates keys with each provider's official models endpoint", async () => {
    const providerFetch = vi.fn(async () => Response.json({ data: [] }));

    await validateProviderApiKey("openai", "openai-secret", providerFetch);
    await validateProviderApiKey("anthropic", "anthropic-secret", providerFetch);

    expect(providerFetch).toHaveBeenNthCalledWith(1, "https://api.openai.com/v1/models", {
      headers: { Authorization: "Bearer openai-secret" },
      redirect: "manual",
      signal: expect.any(AbortSignal),
    });
    expect(providerFetch).toHaveBeenNthCalledWith(2, "https://api.anthropic.com/v1/models", {
      headers: {
        "anthropic-version": "2023-06-01",
        "x-api-key": "anthropic-secret",
      },
      redirect: "manual",
      signal: expect.any(AbortSignal),
    });
  });

  it("stores encrypted keys per owner and never returns them in configuration", async () => {
    await saveValidatedProviderCredential(
      env,
      "provider-user",
      "openai",
      "workspace-secret",
    );

    expect(await getProviderApiKey(env, "provider-user", "openai")).toBe("workspace-secret");
    const configurations = await listProviderConfigurations(env.DB, "provider-user");
    expect(configurations).toContainEqual(expect.objectContaining({
      configured: true,
      provider: "openai",
      status: "validated",
    }));
    expect(JSON.stringify(configurations)).not.toContain("workspace-secret");
    expect(await getProviderApiKey(env, "another-user", "openai")).toBeNull();
  });

  it("rejects invalid keys without persisting them", async () => {
    const providerFetch = vi.fn(async () => new Response("unauthorized", { status: 401 }));

    await expect(validateProviderApiKey("openai", "bad-key", providerFetch))
      .rejects.toMatchObject({ kind: "rejected" });
    expect(await listProviderConfigurations(env.DB, "provider-user"))
      .toContainEqual(expect.objectContaining({ provider: "openai", configured: false }));
  });
});
