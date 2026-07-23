const DEFAULT_MAX_DYNAMIC_WORKERS_PER_MONTH = 5_000;
const MAX_DYNAMIC_WORKERS_PER_OWNER = 500;

function month(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

function monthlyLimit(value: string | undefined): number {
  if (!value) return DEFAULT_MAX_DYNAMIC_WORKERS_PER_MONTH;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("MAX_DYNAMIC_WORKERS_PER_MONTH must be a positive integer");
  }
  return limit;
}

export async function getCloudBudgetUsage(
  env: Pick<Cloudflare.Env, "DB" | "MAX_DYNAMIC_WORKERS_PER_MONTH">,
  ownerId: string,
  now = Date.now(),
) {
  const used = await env.DB.prepare(
    "SELECT used FROM cloud_budget WHERE bucket = ?",
  ).bind(`owner:${ownerId}:${month(now)}`).first<number>("used");
  return {
    used: used ?? 0,
    limit: MAX_DYNAMIC_WORKERS_PER_OWNER,
    month: month(now),
  };
}

async function consume(db: D1Database, bucket: string, limit: number, now: number) {
  const result = await db.prepare(
    `INSERT INTO cloud_budget (bucket, used, updated_at)
      VALUES (?, 1, ?)
      ON CONFLICT(bucket) DO UPDATE SET
        used = cloud_budget.used + 1,
        updated_at = excluded.updated_at
      WHERE cloud_budget.used < ?
      RETURNING used`,
  ).bind(bucket, now, limit).run();
  const row = result.results[0] as { used?: unknown } | undefined;
  if (typeof row?.used !== "number") throw new Error("Monthly Code Mode budget reached");
  return row.used;
}

export async function consumeDynamicWorkerBudget(
  env: Pick<Cloudflare.Env, "DB" | "MAX_DYNAMIC_WORKERS_PER_MONTH">,
  ownerId: string,
  now = Date.now(),
): Promise<number> {
  const period = month(now);
  const ownerUsage = await consume(
    env.DB,
    `owner:${ownerId}:${period}`,
    MAX_DYNAMIC_WORKERS_PER_OWNER,
    now,
  );
  await consume(
    env.DB,
    `global:${period}`,
    monthlyLimit(env.MAX_DYNAMIC_WORKERS_PER_MONTH),
    now,
  );
  return ownerUsage;
}
