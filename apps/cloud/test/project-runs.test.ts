import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { listProjectRuns, recordProjectRun } from "../src/worker/project-runs";
import { createProject } from "../src/worker/projects";

describe("project runs", () => {
  let projectId: string;

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM project WHERE owner_id IN ('runs-user', 'other-runs-user')").run();
    const now = Date.now();
    await env.DB.batch(["runs-user", "other-runs-user"].map((id) => env.DB.prepare(
      "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    ).bind(id, id, `${id}@example.com`, now, now)));
    projectId = (await createProject(env, "runs-user", {
      name: "Tasks",
      openapiSchemaUrl: "https://api.example.com/openapi.json",
      openapiBaseUrl: "https://api.example.com",
      bearerValidationUrl: "https://api.example.com/me",
      corsOrigins: ["https://app.example.com"],
      allowMutations: false,
      llmProvider: "openai",
      llmModel: "gpt-5.6-luna",
      skills: [],
    })).id;
  });

  it("stores metadata without prompts and keeps reads owner-scoped", async () => {
    await recordProjectRun(env.DB, {
      id: crypto.randomUUID(),
      projectId,
      threadId: crypto.randomUUID(),
      source: "playground",
      status: "completed",
      model: "gpt-5.6-luna",
      inputTokens: 120,
      outputTokens: 42,
      toolCalls: 2,
      error: null,
      startedAt: Date.now() - 500,
      completedAt: Date.now(),
    });

    expect(await listProjectRuns(env.DB, "runs-user", projectId)).toEqual([
      expect.objectContaining({
        inputTokens: 120,
        outputTokens: 42,
        source: "playground",
        status: "completed",
        toolCalls: 2,
      }),
    ]);
    expect(await listProjectRuns(env.DB, "other-runs-user", projectId)).toEqual([]);
  });

  it("keeps only the latest 100 runs per project", async () => {
    for (let index = 0; index < 101; index += 1) {
      await recordProjectRun(env.DB, {
        id: crypto.randomUUID(),
        projectId,
        threadId: crypto.randomUUID(),
        source: "runtime",
        status: "completed",
        model: "gpt-5.6-luna",
        inputTokens: 1,
        outputTokens: 1,
        toolCalls: 0,
        error: null,
        startedAt: index,
        completedAt: index,
      });
    }
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM project_run WHERE project_id = ?",
    ).bind(projectId).first<{ count: number }>();

    expect(count?.count).toBe(100);
  });
});
