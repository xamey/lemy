import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  destroyProject,
  provisionProject,
  restartProject,
} from "../src/worker/project-lifecycle";
import { registerProjectThread } from "../src/worker/project-threads";
import { createProject, getProject } from "../src/worker/projects";

const input = {
  name: "Tasks API",
  openapiSchemaUrl: "https://api.example.com/openapi.json",
  openapiBaseUrl: "https://api.example.com",
  bearerValidationUrl: "https://api.example.com/me",
  corsOrigins: ["https://app.example.com"],
  allowMutations: false,
  llmProvider: "openai" as const,
  llmModel: "gpt-5.6-luna",
  skills: [],
};

const lifecycleEnv = env as unknown as Parameters<typeof provisionProject>[0];

describe("project lifecycle", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM project WHERE owner_id = 'user-1'").run();
    const now = Date.now();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    ).bind("user-1", "User One", "user-1@example.com", now, now).run();
  });

  it("marks a project ready after validating its OpenAPI schema", async () => {
    const project = await createProject(lifecycleEnv, "user-1", input);
    const load = vi.fn(async () => ({ openapi: "3.1.0" }));

    await provisionProject(lifecycleEnv, project.id, load);

    expect(load).toHaveBeenCalledWith(input.openapiSchemaUrl);
    expect(await getProject(env.DB, "user-1", project.id)).toMatchObject({ status: "ready" });
  });

  it("records an unavailable OpenAPI schema", async () => {
    const project = await createProject(lifecycleEnv, "user-1", input);

    await provisionProject(lifecycleEnv, project.id, vi.fn(async () => {
      throw new Error("unavailable");
    }));

    expect(await getProject(env.DB, "user-1", project.id)).toMatchObject({
      status: "error",
      lastError: "The OpenAPI schema is unavailable",
    });
  });

  it("does not let stale provisioning overwrite newer state", async () => {
    const project = await createProject(lifecycleEnv, "user-1", input);
    await provisionProject(lifecycleEnv, project.id, async () => {
      await env.DB.prepare(
        "UPDATE project SET status = 'ready', updated_at = updated_at + 1000 WHERE id = ?",
      ).bind(project.id).run();
      throw new Error("old validation failed");
    });

    expect(await getProject(env.DB, "user-1", project.id)).toMatchObject({ status: "ready" });
  });

  it("refreshes existing agents after a successful restart", async () => {
    const project = await createProject(lifecycleEnv, "user-1", input);
    await registerProjectThread(
      env.DB,
      project.id,
      "a".repeat(64),
      crypto.randomUUID(),
      `${project.id}--agent`,
    );
    const agent = { purge: vi.fn(), refresh: vi.fn() };

    await restartProject(
      lifecycleEnv,
      project.id,
      async () => ({ openapi: "3.1.0" }),
      async () => agent,
    );

    expect(agent.refresh).toHaveBeenCalledOnce();
  });

  it("purges every durable conversation before deleting metadata", async () => {
    const project = await createProject(lifecycleEnv, "user-1", input);
    await registerProjectThread(
      env.DB,
      project.id,
      "b".repeat(64),
      crypto.randomUUID(),
      `${project.id}--agent`,
    );
    const agent = { purge: vi.fn(), refresh: vi.fn() };

    await destroyProject(lifecycleEnv, "user-1", project.id, async () => agent);

    expect(agent.purge).toHaveBeenCalledOnce();
    expect(await getProject(env.DB, "user-1", project.id)).toBeNull();
  });

  it("keeps project metadata when durable data cannot be purged", async () => {
    const project = await createProject(lifecycleEnv, "user-1", input);
    await registerProjectThread(
      env.DB,
      project.id,
      "c".repeat(64),
      crypto.randomUUID(),
      `${project.id}--agent`,
    );
    const agent = {
      purge: vi.fn(async () => { throw new Error("purge failed"); }),
      refresh: vi.fn(),
    };

    await destroyProject(lifecycleEnv, "user-1", project.id, async () => agent);

    expect(await getProject(env.DB, "user-1", project.id)).toMatchObject({
      status: "error",
      lastError: "The runtime data could not be deleted",
    });
  });
});
