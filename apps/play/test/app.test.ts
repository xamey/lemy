import { describe, expect, it } from "vitest";

import { createPlayApp } from "../src/worker/app";

describe("playground API", () => {
  it("publishes its schema and protects task access with the demo bearer", async () => {
    const app = createPlayApp();
    expect((await app.request("/openapi.json")).status).toBe(200);
    expect((await app.request("/tasks")).status).toBe(401);

    const validation = await app.request("/auth/validate", {
      headers: { authorization: "Bearer demo-token" },
    });
    expect(await validation.json()).toMatchObject({
      active: true,
      sub: "playground-user",
      tenant: "lemy-playground",
    });
  });
});
