import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from "../src/worker/projects";

const input = {
  name: "Tasks API",
  openapiSchemaUrl: "https://api.example.com/openapi.json",
  openapiBaseUrl: "https://api.example.com",
  bearerValidationUrl: "https://api.example.com/me",
  corsOrigins: ["https://app.example.com"],
  allowMutations: false,
  llmProvider: "anthropic" as const,
  llmModel: "claude-sonnet-5",
  skills: [{
    name: "task-triage",
    description: "Use when prioritizing tasks.",
    instructions: "Check overdue tasks first.",
  }],
};

describe("projects", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM project WHERE owner_id IN ('user-1', 'user-2')").run();
    const now = Date.now();
    await env.DB.batch(
      ["user-1", "user-2"].map((id) =>
        env.DB
          .prepare(
            "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
          )
          .bind(id, id, `${id}@example.com`, now, now),
      ),
    );
  });

  it("keeps reads scoped to the owner", async () => {
    const project = await createProject(env, "user-1", input);

    expect(await getProject(env.DB, "user-1", project.id)).toMatchObject({ id: project.id });
    expect(project.skills).toEqual(input.skills);
    expect(await getProject(env.DB, "user-2", project.id)).toBeNull();
    expect(await listProjects(env.DB, "user-2")).toEqual([]);
  });

  it("does not allow another owner to delete a project", async () => {
    const project = await createProject(env, "user-1", input);

    expect(await deleteProject(env.DB, "user-2", project.id)).toBe(false);
    expect(await getProject(env.DB, "user-1", project.id)).not.toBeNull();
  });

  it("does not update a project once deletion has begun", async () => {
    const project = await createProject(env, "user-1", input);
    await env.DB.prepare("UPDATE project SET status = 'deleting' WHERE id = ?")
      .bind(project.id)
      .run();

    expect(
      await updateProject(env, "user-1", project.id, { ...input, name: "Renamed" }),
    ).toBeNull();
    expect(await getProject(env.DB, "user-1", project.id)).toMatchObject({
      name: "Tasks API",
      status: "deleting",
    });
  });

  it("atomically caps projects per owner", async () => {
    await Promise.all([
      createProject(env, "user-1", { ...input, name: "One" }),
      createProject(env, "user-1", { ...input, name: "Two" }),
      createProject(env, "user-1", { ...input, name: "Three" }),
    ]);

    await expect(createProject(env, "user-1", { ...input, name: "Four" }))
      .rejects.toThrow("Project limit reached (3)");
    expect(await listProjects(env.DB, "user-1")).toHaveLength(3);
  });
});
