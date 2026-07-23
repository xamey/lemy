import { describe, expect, it } from "vitest";

import { DEFAULT_MODELS, modelCatalog } from "../src/worker/model-catalog";

describe("model catalog", () => {
  it("offers both supported providers by default", () => {
    expect(DEFAULT_MODELS.some(({ provider }) => provider === "openai")).toBe(true);
    expect(DEFAULT_MODELS.some(({ provider }) => provider === "anthropic")).toBe(true);
  });

  it("accepts a valid override and rejects duplicates", () => {
    expect(modelCatalog(JSON.stringify([
      { provider: "openai", model: "custom-model", label: "Custom model" },
    ]))).toEqual([
      { provider: "openai", model: "custom-model", label: "Custom model" },
    ]);
    expect(() => modelCatalog(JSON.stringify([
      { provider: "openai", model: "same", label: "One" },
      { provider: "openai", model: "same", label: "Two" },
    ]))).toThrow("duplicates");
  });
});
