import { createCloudApp } from "./app";
import { cleanExpiredData } from "./retention";

export { CodemodeRuntime } from "@cloudflare/codemode";
export { LemyProjectAgent } from "./project-agent";

const app = createCloudApp();

export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, env: Cloudflare.Env, ctx: ExecutionContext) {
    ctx.waitUntil(cleanExpiredData(env));
  },
};
