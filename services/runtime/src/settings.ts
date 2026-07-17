import type { RuntimeSettings } from "./app.js";

export interface ServerSettings extends RuntimeSettings {
  port: number;
}

export function readSettings(env: NodeJS.ProcessEnv = process.env): ServerSettings {
  const port = Number(env.PORT ?? "4000");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be a valid TCP port");
  }

  const corsOrigins = (env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (corsOrigins.length === 0) throw new Error("CORS_ORIGINS must contain at least one origin");

  const bearerValidationUrl = env.BEARER_VALIDATION_URL?.trim();
  if (!bearerValidationUrl) {
    throw new Error("BEARER_VALIDATION_URL is required");
  }
  const parsedUrl = new URL(bearerValidationUrl);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("BEARER_VALIDATION_URL must be an HTTP or HTTPS URL");
  }

  return {
    agentUrl: env.AGENT_URL ?? "http://agent:8000/agent",
    bearerValidationUrl,
    corsOrigins,
    port,
  };
}
