export type LlmProvider = "openai" | "anthropic";

export interface LlmModel {
  provider: LlmProvider;
  model: string;
  label: string;
}

export const DEFAULT_MODELS: LlmModel[] = [
  { provider: "openai", model: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { provider: "openai", model: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { provider: "openai", model: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { provider: "anthropic", model: "claude-fable-5", label: "Claude Fable 5" },
  { provider: "anthropic", model: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { provider: "anthropic", model: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { provider: "anthropic", model: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

export function modelCatalog(override?: string): LlmModel[] {
  if (!override?.trim()) return DEFAULT_MODELS;
  let value: unknown;
  try {
    value = JSON.parse(override);
  } catch {
    throw new Error("LEMY_MODEL_CATALOG_JSON must be valid JSON");
  }
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
    throw new Error("LEMY_MODEL_CATALOG_JSON must contain at least one model and at most 50");
  }
  const models = value.map((entry): LlmModel => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Model catalog entries must be objects");
    }
    const model = entry as Record<string, unknown>;
    if (model.provider !== "openai" && model.provider !== "anthropic") {
      throw new Error("Model catalog provider must be openai or anthropic");
    }
    if (typeof model.model !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(model.model)) {
      throw new Error("Model catalog ID is invalid");
    }
    if (typeof model.label !== "string" || !model.label.trim() || model.label.length > 80) {
      throw new Error("Model catalog label is invalid");
    }
    return { provider: model.provider, model: model.model, label: model.label.trim() };
  });
  if (new Set(models.map(({ provider, model }) => `${provider}:${model}`)).size !== models.length) {
    throw new Error("Model catalog contains duplicates");
  }
  return models;
}
