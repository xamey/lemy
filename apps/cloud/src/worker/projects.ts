import type { Env } from "./env";
import type { ProjectInput } from "./project-input";
import { encryptSecret, type EncryptedSecret } from "./secrets";

export type ProjectStatus = "provisioning" | "ready" | "error" | "deleting";
export const MAX_PROJECTS_PER_OWNER = 3;

export interface StoredProject {
  id: string;
  ownerId: string;
  name: string;
  status: ProjectStatus;
  openapiSchemaUrl: string;
  openapiBaseUrl: string | null;
  bearerValidationUrl: string;
  corsOrigins: string[];
  allowMutations: boolean;
  llmProvider: ProjectInput["llmProvider"];
  llmModel: string;
  llmBaseUrl: string | null;
  llmManaged: boolean;
  llmApiKey: EncryptedSecret;
  skills: ProjectInput["skills"];
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PublicProject = Omit<
  StoredProject,
  "ownerId" | "llmApiKey" | "llmBaseUrl" | "llmManaged"
> & {
  runtimePath: string;
};

interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  status: ProjectStatus;
  openapi_schema_url: string;
  openapi_base_url: string | null;
  bearer_validation_url: string;
  cors_origins: string;
  allow_mutations: number;
  llm_provider: ProjectInput["llmProvider"];
  llm_model: string;
  llm_base_url: string | null;
  llm_api_key_ciphertext: string;
  llm_api_key_iv: string;
  llm_managed: number;
  skills: string;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

const SELECT_COLUMNS = `id, owner_id, name, status, openapi_schema_url, openapi_base_url,
  bearer_validation_url, cors_origins, allow_mutations, llm_provider, llm_model,
  llm_base_url, llm_api_key_ciphertext, llm_api_key_iv, llm_managed, last_error,
  skills, created_at, updated_at`;

function fromRow(row: ProjectRow): StoredProject {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    status: row.status,
    openapiSchemaUrl: row.openapi_schema_url,
    openapiBaseUrl: row.openapi_base_url,
    bearerValidationUrl: row.bearer_validation_url,
    corsOrigins: JSON.parse(row.cors_origins) as string[],
    allowMutations: Boolean(row.allow_mutations),
    llmProvider: row.llm_provider,
    llmModel: row.llm_model,
    llmBaseUrl: row.llm_base_url,
    llmManaged: Boolean(row.llm_managed),
    llmApiKey: {
      ciphertext: row.llm_api_key_ciphertext,
      iv: row.llm_api_key_iv,
    },
    skills: JSON.parse(row.skills) as ProjectInput["skills"],
    lastError: row.last_error,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function toPublicProject(project: StoredProject): PublicProject {
  const {
    ownerId: _ownerId,
    llmApiKey: _llmApiKey,
    llmBaseUrl: _llmBaseUrl,
    llmManaged: _llmManaged,
    ...safe
  } = project;
  return { ...safe, runtimePath: `/runtime/${project.id}` };
}

export async function createProject(
  env: Env,
  ownerId: string,
  input: ProjectInput,
): Promise<PublicProject> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const encrypted = await encryptSecret("", env.PROJECT_SECRETS_KEY, `${ownerId}:${id}`);

  const result = await env.DB.prepare(
    `INSERT INTO project (
      id, owner_id, name, status, openapi_schema_url, openapi_base_url,
      bearer_validation_url, cors_origins, allow_mutations, llm_provider, llm_model,
      llm_base_url, llm_api_key_ciphertext, llm_api_key_iv, llm_managed, last_error,
      skills, created_at, updated_at
    ) SELECT ?, ?, ?, 'provisioning', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, NULL, ?, ?, ?
      WHERE (SELECT COUNT(*) FROM project WHERE owner_id = ?) < ?`,
  )
    .bind(
      id,
      ownerId,
      input.name,
      input.openapiSchemaUrl,
      input.openapiBaseUrl,
      input.bearerValidationUrl,
      JSON.stringify(input.corsOrigins),
      Number(input.allowMutations),
      input.llmProvider,
      input.llmModel,
      encrypted.ciphertext,
      encrypted.iv,
      JSON.stringify(input.skills),
      now,
      now,
      ownerId,
      MAX_PROJECTS_PER_OWNER,
    )
    .run();
  if (!result.meta.changes) throw new Error(`Project limit reached (${MAX_PROJECTS_PER_OWNER})`);

  const project = await getProject(env.DB, ownerId, id);
  if (!project) throw new Error("Project creation failed");
  return toPublicProject(project);
}

export async function listProjects(db: D1Database, ownerId: string): Promise<PublicProject[]> {
  const result = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM project WHERE owner_id = ? ORDER BY created_at DESC`)
    .bind(ownerId)
    .all<ProjectRow>();
  return result.results.map(fromRow).map(toPublicProject);
}

export async function getProject(
  db: D1Database,
  ownerId: string,
  id: string,
): Promise<StoredProject | null> {
  const row = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM project WHERE id = ? AND owner_id = ?`)
    .bind(id, ownerId)
    .first<ProjectRow>();
  return row ? fromRow(row) : null;
}

export async function getProjectById(db: D1Database, id: string): Promise<StoredProject | null> {
  const row = await db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM project WHERE id = ?`)
    .bind(id)
    .first<ProjectRow>();
  return row ? fromRow(row) : null;
}

export async function updateProject(
  env: Env,
  ownerId: string,
  id: string,
  input: ProjectInput,
): Promise<PublicProject | null> {
  const current = await getProject(env.DB, ownerId, id);
  if (!current) return null;
  const result = await env.DB.prepare(
    `UPDATE project SET name = ?, status = 'provisioning', openapi_schema_url = ?,
      openapi_base_url = ?, bearer_validation_url = ?, cors_origins = ?, allow_mutations = ?,
      llm_provider = ?, llm_model = ?, llm_base_url = NULL, skills = ?, last_error = NULL, updated_at = ?
      WHERE id = ? AND owner_id = ? AND status != 'deleting'`,
  )
    .bind(
      input.name,
      input.openapiSchemaUrl,
      input.openapiBaseUrl,
      input.bearerValidationUrl,
      JSON.stringify(input.corsOrigins),
      Number(input.allowMutations),
      input.llmProvider,
      input.llmModel,
      JSON.stringify(input.skills),
      Date.now(),
      id,
      ownerId,
    )
    .run();
  if (!result.meta.changes) return null;
  return toPublicProject((await getProject(env.DB, ownerId, id))!);
}

export async function setProjectStatus(
  db: D1Database,
  id: string,
  status: ProjectStatus,
  lastError: string | null = null,
): Promise<void> {
  await db
    .prepare("UPDATE project SET status = ?, last_error = ?, updated_at = ? WHERE id = ?")
    .bind(status, lastError, Date.now(), id)
    .run();
}

export async function deleteProject(db: D1Database, ownerId: string, id: string): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM project WHERE id = ? AND owner_id = ?")
    .bind(id, ownerId)
    .run();
  return Boolean(result.meta.changes);
}
