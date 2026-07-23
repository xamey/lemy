import type { Env } from "./env";

export type RateLimitResult = "allowed" | "limited" | "unavailable";

const ADMIN_LOGIN_ATTEMPT_LIMIT = 3;
const ADMIN_LOGIN_WINDOW_MS = 5 * 60 * 1_000;

async function key(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function checkRateLimit(
  env: Env,
  limiter: RateLimit | undefined,
  identity: string,
): Promise<RateLimitResult> {
  if (env.RATE_LIMITS_DISABLED === "true") return "allowed";
  if (!limiter) return "unavailable";
  try {
    return (await limiter.limit({ key: await key(identity) })).success
      ? "allowed"
      : "limited";
  } catch {
    return "unavailable";
  }
}

export async function recordFailedAdminLogin(
  env: Env,
  identity: string,
): Promise<RateLimitResult> {
  if (env.RATE_LIMITS_DISABLED === "true") return "allowed";
  const now = Date.now();
  try {
    const results = await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM admin_login_attempt WHERE window_started_at <= ?",
      ).bind(now - ADMIN_LOGIN_WINDOW_MS),
      env.DB.prepare(
        `INSERT INTO admin_login_attempt (identity_hash, window_started_at, attempts)
          VALUES (?, ?, 1)
          ON CONFLICT(identity_hash) DO UPDATE SET
            attempts = min(admin_login_attempt.attempts + 1, ?)
          RETURNING attempts`,
      ).bind(await key(identity), now, ADMIN_LOGIN_ATTEMPT_LIMIT + 1),
    ]);
    const row = results[1]?.results[0] as { attempts?: unknown } | undefined;
    if (typeof row?.attempts !== "number") return "unavailable";
    return row.attempts <= ADMIN_LOGIN_ATTEMPT_LIMIT ? "allowed" : "limited";
  } catch {
    return "unavailable";
  }
}
