import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

import { createControlMcpServer } from "../src/worker/control-mcp";

describe("control MCP", () => {
  it("publishes project tools and delegates calls to the control API", async () => {
    const call = vi.fn(async () => [{ id: "project-1" }]);
    const server = createControlMcpServer(call);
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map(({ name }) => name)).toContain("create_project");
    expect(tools.tools.map(({ name }) => name)).toContain("add_external_mcp");
    expect(tools.tools.map(({ name }) => name)).toContain("configure_model_provider");
    const response = await client.callTool({ name: "list_projects", arguments: {} });

    expect(call).toHaveBeenCalledWith("/api/projects");
    expect(response.content).toEqual([{ type: "text", text: JSON.stringify([{ id: "project-1" }], null, 2) }]);
    await client.close();
    await server.close();
  });

  it("requires explicit confirmation for destructive tools", async () => {
    const server = createControlMcpServer(async () => ({ ok: true }));
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const response = await client.callTool({
      name: "delete_project",
      arguments: { projectId: crypto.randomUUID(), confirmed: false },
    });
    expect(response.isError).toBe(true);
    await client.close();
    await server.close();
  });

  it("only exposes the scoped project's permitted tools", async () => {
    const projectId = crypto.randomUUID();
    const server = createControlMcpServer(async () => ({ ok: true }), {
      permission: "read",
      projectId,
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const names = (await client.listTools()).tools.map(({ name }) => name);
    expect(names).toEqual(["get_project", "list_external_mcps"]);
    expect((await client.callTool({
      name: "get_project",
      arguments: { projectId },
    })).isError).not.toBe(true);
    expect((await client.callTool({
      name: "get_project",
      arguments: { projectId: crypto.randomUUID() },
    })).isError).toBe(true);
    await client.close();
    await server.close();
  });
});
