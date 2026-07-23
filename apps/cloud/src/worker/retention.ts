import { getAgentByName } from "agents";

import type { Env } from "./env";

const DAY = 86_400_000;

export async function cleanExpiredData(
  env: Env,
  now = Date.now(),
  purge = async (name: string) => {
    if (!env.LEMY_AGENT) throw new Error("LEMY_AGENT binding is unavailable");
    await (await getAgentByName(env.LEMY_AGENT, name)).purge();
  },
): Promise<void> {
  const stale = await env.DB.prepare(
    "SELECT agent_name FROM project_thread WHERE updated_at < ? ORDER BY updated_at LIMIT 50",
  ).bind(now - 30 * DAY).all<{ agent_name: string }>();
  for (const { agent_name: name } of stale.results) {
    await purge(name);
    await env.DB.prepare("DELETE FROM project_thread WHERE agent_name = ?").bind(name).run();
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM runtime_session_lease WHERE expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM session WHERE expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM verification WHERE expires_at <= ?").bind(now),
    env.DB.prepare(
      "DELETE FROM access_request WHERE status = 'pending' AND updated_at < ?",
    ).bind(now - 90 * DAY),
    env.DB.prepare(
      "DELETE FROM access_request WHERE status = 'revoked' AND updated_at < ?",
    ).bind(now - 30 * DAY),
  ]);
}
