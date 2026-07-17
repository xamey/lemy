import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime } from "@copilotkit/runtime/v2";
import { createCopilotExpressHandler } from "@copilotkit/runtime/v2/express";
import express, { type Express } from "express";

import {
  BearerScopedAgentRunner,
  runWithBearerScope,
} from "./bearer-scoped-agent-runner.js";

export interface RuntimeSettings {
  agentUrl: string;
  corsOrigins: string[];
  bearerValidationUrl: string;
}

export function isBearerAuthorization(
  value: string | null | undefined,
): value is string {
  return Boolean(value && /^Bearer\s+\S+$/i.test(value));
}

export async function validateBearer(
  authorization: string,
  validationUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(validationUrl, {
      headers: { Authorization: authorization },
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new Response(JSON.stringify({ error: "Bearer validation failed" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (response.status === 401 || response.status === 403) {
    throw new Response(JSON.stringify({ error: "Bearer token rejected" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!response.ok) {
    throw new Response(JSON.stringify({ error: "Bearer validation failed" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export function createApp(settings: RuntimeSettings): Express {
  const runtime = new CopilotRuntime({
    agents: {
      default: new HttpAgent({
        agentId: "default",
        description: "Agent for the configured OpenAPI service",
        url: settings.agentUrl,
      }),
    },
    forwardHeaders: { allow: ["authorization"] },
    runner: new BearerScopedAgentRunner(),
  });

  const app = express();
  app.disable("x-powered-by");
  app.get("/health", (_request, response) => response.json({ status: "ok" }));
  app.use("/api/copilotkit", (request, _response, next) => {
    const authorization = request.header("authorization");
    if (request.method === "OPTIONS" || !isBearerAuthorization(authorization)) {
      next();
      return;
    }
    runWithBearerScope(authorization, next);
  });
  app.use(
    createCopilotExpressHandler({
      runtime,
      basePath: "/api/copilotkit",
      cors: { origin: settings.corsOrigins },
      hooks: {
        onRequest: async ({ request }) => {
          if (request.method === "OPTIONS") return;
          const authorization = request.headers.get("authorization");
          if (!isBearerAuthorization(authorization)) {
            throw new Response(JSON.stringify({ error: "Bearer token required" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }
          await validateBearer(authorization, settings.bearerValidationUrl);
        },
      },
    }),
  );
  return app;
}
