import { Hono, type MiddlewareHandler } from "hono";

import type { PlayTasks } from "./tasks";

type Bindings = { TASKS: DurableObjectNamespace<PlayTasks> };

const schema = {
  openapi: "3.1.0",
  info: { title: "Lemy Playground Tasks API", version: "1.0.0" },
  servers: [{ url: "https://play.lemy.online" }],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    schemas: {
      Task: {
        type: "object",
        required: ["id", "title", "status"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          status: { type: "string", enum: ["open", "done"] },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/tasks": {
      get: {
        operationId: "listTasks",
        summary: "List tasks",
        responses: {
          "200": {
            description: "Task list",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Task" } },
              },
            },
          },
        },
      },
      post: {
        operationId: "createTask",
        summary: "Create a task",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["title"],
                properties: { title: { type: "string", minLength: 1, maxLength: 120 } },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Created task",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Task" } },
            },
          },
        },
      },
    },
    "/tasks/{id}/complete": {
      post: {
        operationId: "completeTask",
        summary: "Complete a task",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Completed task",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Task" } },
            },
          },
          "404": { description: "Task not found" },
        },
      },
    },
  },
} as const;

export function createPlayApp() {
  const app = new Hono<{ Bindings: Bindings }>();

  app.get("/openapi.json", (c) => c.json(schema));
  app.use("/auth/validate", bearer);
  app.use("/tasks", bearer);
  app.use("/tasks/*", bearer);
  app.get("/auth/validate", (c) => c.json({
    active: true,
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: "playground-user",
    tenant: "lemy-playground",
  }));
  app.get("/tasks", async (c) => c.json(await tasks(c).list()));
  app.post("/tasks", async (c) => {
    const value = await c.req.json().catch(() => null) as { title?: unknown } | null;
    const title = typeof value?.title === "string" ? value.title.trim() : "";
    if (!title || title.length > 120) return c.json({ error: "Title must contain 1 to 120 characters" }, 400);
    try {
      return c.json(await tasks(c).create(title), 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Could not create task" }, 409);
    }
  });
  app.post("/tasks/reset", async (c) => c.json(await tasks(c).reset()));
  app.post("/tasks/:id/complete", async (c) => {
    const task = await tasks(c).complete(c.req.param("id"));
    return task ? c.json(task) : c.json({ error: "Task not found" }, 404);
  });

  return app;
}

const bearer: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  if (c.req.header("authorization") !== "Bearer demo-token") {
    return c.json({ error: "Bearer token is invalid" }, 401);
  }
  await next();
};

function tasks(c: { env: Bindings }) {
  return c.env.TASKS.getByName("shared");
}
