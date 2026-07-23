import {
  DEFAULT_MODELS,
  type LlmModel,
  type LlmProvider,
} from "./model-catalog";
import { publicHttpsUrl } from "./outbound-url";

export interface AgentSkill {
  name: string;
  description: string;
  instructions: string;
}

export interface ProjectInput {
  name: string;
  openapiSchemaUrl: string;
  openapiBaseUrl: string | null;
  bearerValidationUrl: string;
  corsOrigins: string[];
  allowMutations: boolean;
  llmProvider: LlmProvider;
  llmModel: string;
  skills: AgentSkill[];
}

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SKILLS = 16;
const MAX_SKILL_INSTRUCTIONS = 20_000;
const MAX_SKILLS_SIZE = 60_000;

function parseSkills(value: unknown): AgentSkill[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_SKILLS) {
    throw new Error(`Skills must be an array with at most ${MAX_SKILLS} entries`);
  }

  const names = new Set<string>();
  const skills = value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Each skill must be an object");
    }
    const skill = candidate as Record<string, unknown>;
    const name = typeof skill.name === "string" ? skill.name.trim() : "";
    const description = typeof skill.description === "string" ? skill.description.trim() : "";
    const instructions = typeof skill.instructions === "string" ? skill.instructions.trim() : "";

    if (name.length > 64 || !SKILL_NAME.test(name)) {
      throw new Error("Agent skill name must use 1 to 64 lowercase letters, numbers, or single hyphens");
    }
    if (!description || description.length > 1_024) {
      throw new Error("Agent skill description must contain 1 to 1024 characters");
    }
    if (!instructions || instructions.length > MAX_SKILL_INSTRUCTIONS) {
      throw new Error(`Agent skill instructions must contain 1 to ${MAX_SKILL_INSTRUCTIONS} characters`);
    }
    if (names.has(name)) throw new Error("Agent skill names must be unique");
    names.add(name);
    return { name, description, instructions };
  });

  if (skills.reduce((size, skill) => size + skill.name.length + skill.description.length + skill.instructions.length, 0) > MAX_SKILLS_SIZE) {
    throw new Error(`Agent skills must not exceed ${MAX_SKILLS_SIZE} characters in total`);
  }
  return skills;
}

function projectUrl(
  value: unknown,
  name: string,
  optional: boolean,
  allowLocal: boolean,
): string | null {
  if (optional && (value === null || value === undefined || value === "")) return null;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  try {
    return publicHttpsUrl(value.trim(), allowLocal).toString();
  } catch {
    throw new Error(`${name} must be a public HTTPS URL`);
  }
}

function httpOrigin(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("CORS origin is required");
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("CORS origin must use HTTP or HTTPS without credentials");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("CORS origin must not contain a path, query, or fragment");
  }
  return url.origin;
}

export function parseProjectInput(
  value: unknown,
  models: LlmModel[] = DEFAULT_MODELS,
  allowLocal = false,
): ProjectInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Project configuration must be an object");
  }
  const input = value as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const llmModel = typeof input.llmModel === "string" ? input.llmModel.trim() : "";
  const llmProvider = input.llmProvider;
  const corsOrigins = Array.isArray(input.corsOrigins)
    ? input.corsOrigins.map(httpOrigin)
    : [];

  if (!name || name.length > 80) throw new Error("Name must contain 1 to 80 characters");
  if (llmProvider !== "openai" && llmProvider !== "anthropic") {
    throw new Error("Unsupported LLM provider");
  }
  if (!llmModel) throw new Error("LLM model is required");
  if (corsOrigins.length === 0) throw new Error("At least one CORS origin is required");
  if (!models.some((model) => model.provider === llmProvider && model.model === llmModel)) {
    throw new Error("The selected model is not available in this Lemy instance");
  }

  return {
    name,
    openapiSchemaUrl: projectUrl(input.openapiSchemaUrl, "OpenAPI schema URL", false, allowLocal)!,
    openapiBaseUrl: projectUrl(input.openapiBaseUrl, "OpenAPI base URL", true, allowLocal),
    bearerValidationUrl: projectUrl(
      input.bearerValidationUrl,
      "Bearer validation URL",
      false,
      allowLocal,
    )!,
    corsOrigins,
    allowMutations: input.allowMutations === true,
    llmProvider,
    llmModel,
    skills: parseSkills(input.skills),
  };
}
