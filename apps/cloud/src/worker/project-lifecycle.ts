import { getAgentByName } from "agents";

import { loadOpenApiSpec } from "../../../../services/codemode/src/server";
import type { Env } from "./env";
import { listProjectAgentNames } from "./project-threads";
import { deleteProject, getProjectById, setProjectStatus } from "./projects";

interface ProjectAgentStub {
  purge(): Promise<void>;
  refresh(): Promise<void>;
}

type AgentFor = (env: Env, name: string) => Promise<ProjectAgentStub>;
type OpenApiLoader = (schemaUrl: string) => Promise<Record<string, unknown>>;

const loadFreshOpenApi: OpenApiLoader = (schemaUrl) => loadOpenApiSpec(schemaUrl, true);

const projectAgent: AgentFor = async (env, name) => {
  if (!env.LEMY_AGENT) throw new Error("LEMY_AGENT binding is unavailable");
  return getAgentByName(env.LEMY_AGENT, name);
};

export async function provisionProject(
  env: Env,
  projectId: string,
  loader: OpenApiLoader = loadFreshOpenApi,
): Promise<void> {
  const project = await getProjectById(env.DB, projectId);
  if (!project || project.status === "deleting") return;
  try {
    await loader(project.openapiSchemaUrl);
    const current = await getProjectById(env.DB, projectId);
    if (
      current
      && current.status !== "deleting"
      && current.updatedAt === project.updatedAt
    ) await setProjectStatus(env.DB, projectId, "ready");
  } catch {
    const current = await getProjectById(env.DB, projectId);
    if (
      current
      && current.status !== "deleting"
      && current.updatedAt === project.updatedAt
    ) await setProjectStatus(env.DB, projectId, "error", "The OpenAPI schema is unavailable");
  }
}

export async function restartProject(
  env: Env,
  projectId: string,
  loader: OpenApiLoader = loadFreshOpenApi,
  agentFor: AgentFor = projectAgent,
): Promise<void> {
  await provisionProject(env, projectId, loader);
  const project = await getProjectById(env.DB, projectId);
  if (project?.status !== "ready") return;
  for (const name of await listProjectAgentNames(env.DB, projectId)) {
    await (await agentFor(env, name)).refresh();
  }
}

export async function destroyProject(
  env: Env,
  ownerId: string,
  projectId: string,
  agentFor: AgentFor = projectAgent,
): Promise<void> {
  const project = await getProjectById(env.DB, projectId);
  if (!project || project.ownerId !== ownerId) return;
  try {
    for (const name of await listProjectAgentNames(env.DB, projectId)) {
      await (await agentFor(env, name)).purge();
    }
    await deleteProject(env.DB, ownerId, projectId);
  } catch {
    await setProjectStatus(env.DB, projectId, "error", "The runtime data could not be deleted");
  }
}
