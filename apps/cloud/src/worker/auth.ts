import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/d1";

import { authSchema } from "./db-schema";
import { grantCloudAccessByEmail } from "./access";
import type { Env } from "./env";
import { getAgentAccessTokenSession } from "./agent-access-tokens";

export function createAuth(env: Env) {
  const database = drizzle(env.DB, { schema: authSchema });

  return betterAuth({
    appName: "Lemy Cloud",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.PUBLIC_APP_URL],
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema: authSchema,
    }),
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      },
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
  });
}

export type AuthSession = Awaited<ReturnType<ReturnType<typeof createAuth>["api"]["getSession"]>>;

export function localDevelopmentEnabled(env: Env, request: Request): boolean {
  if (env.LOCAL_DEV_MODE !== "true") return false;
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

async function localDevelopmentSession(env: Env): Promise<NonNullable<AuthSession>> {
  const now = new Date();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
  )
    .bind("local-dev", "Local developer", "local@lemy.dev", now.getTime(), now.getTime())
    .run();
  await grantCloudAccessByEmail(env.DB, "local@lemy.dev");

  return {
    user: {
      id: "local-dev",
      name: "Local developer",
      email: "local@lemy.dev",
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: "local-dev-session",
      userId: "local-dev",
      token: "local-dev-session",
      expiresAt: new Date(now.getTime() + 86_400_000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
  };
}

export async function getAuthSession(env: Env, request: Request): Promise<AuthSession> {
  if (localDevelopmentEnabled(env, request)) return localDevelopmentSession(env);
  return await getAgentAccessTokenSession(env.DB, request.headers.get("authorization"))
    ?? createAuth(env).api.getSession({ headers: request.headers });
}
