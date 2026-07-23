import { describe, expect, it } from "vitest";

import { parseProjectInput } from "../src/worker/project-input";

const input = {
  name: "Tasks API",
  openapiSchemaUrl: "https://api.example.com/openapi.json",
  openapiBaseUrl: "https://api.example.com",
  bearerValidationUrl: "https://api.example.com/me",
  corsOrigins: ["https://app.example.com"],
  allowMutations: false,
  llmProvider: "openai",
  llmModel: "gpt-5.6-luna",
  skills: [],
};

describe("project input", () => {
  it("normalizes browser CORS origins without a trailing slash", () => {
    expect(parseProjectInput(input).corsOrigins).toEqual(["https://app.example.com"]);
  });

  it.each([
    "https://app.example.com/path",
    "https://app.example.com?tenant=one",
    "https://app.example.com#fragment",
  ])("rejects a CORS value that is not an origin: %s", (origin) => {
    expect(() => parseProjectInput({ ...input, corsOrigins: [origin] })).toThrow(
      "CORS origin must not contain",
    );
  });

  it("rejects credentials embedded in configured URLs", () => {
    expect(() =>
      parseProjectInput({
        ...input,
        bearerValidationUrl: "https://user:password@api.example.com/me",
      }),
    ).toThrow("public HTTPS");
  });

  it.each([
    "http://api.example.com/openapi.json",
    "https://127.0.0.1/openapi.json",
    "https://10.0.0.1/openapi.json",
    "https://169.254.169.254/openapi.json",
    "https://service.internal/openapi.json",
    "https://[::ffff:127.0.0.1]/openapi.json",
  ])("rejects a non-public managed project URL: %s", (openapiSchemaUrl) => {
    expect(() => parseProjectInput({ ...input, openapiSchemaUrl })).toThrow("public HTTPS");
  });

  it("allows loopback HTTP only for explicit local development", () => {
    expect(parseProjectInput({
      ...input,
      openapiSchemaUrl: "http://127.0.0.1:4010/openapi.json",
      openapiBaseUrl: "http://localhost:4010",
      bearerValidationUrl: "http://127.0.0.1:4010/me",
    }, undefined, true)).toMatchObject({
      openapiSchemaUrl: "http://127.0.0.1:4010/openapi.json",
    });
  });

  it("accepts only models in the configured catalog", () => {
    expect(() => parseProjectInput({ ...input, llmModel: "unknown" })).toThrow(
      "not available",
    );
    expect(() => parseProjectInput({
      ...input,
      llmProvider: "openai-compatible",
      llmModel: "custom",
    })).toThrow("Unsupported LLM provider");
  });

  it("normalizes Agent Skills metadata and instructions", () => {
    expect(parseProjectInput({
      ...input,
      skills: [{
        name: "task-triage",
        description: "  Use when prioritizing tasks.  ",
        instructions: "  Check overdue tasks before assigning priority.  ",
      }],
    }).skills).toEqual([{
      name: "task-triage",
      description: "Use when prioritizing tasks.",
      instructions: "Check overdue tasks before assigning priority.",
    }]);
  });

  it.each(["Task-Triage", "-task", "task--triage", "task_"])(
    "rejects an invalid Agent Skill name: %s",
    (name) => {
      expect(() => parseProjectInput({
        ...input,
        skills: [{ name, description: "Use for task triage.", instructions: "Triage tasks." }],
      })).toThrow("skill name");
    },
  );

  it("rejects duplicate Agent Skill names", () => {
    const skill = {
      name: "task-triage",
      description: "Use for task triage.",
      instructions: "Triage tasks.",
    };
    expect(() => parseProjectInput({ ...input, skills: [skill, skill] })).toThrow(
      "unique",
    );
  });
});
