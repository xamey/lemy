---
name: manage-lemy
description: Manage Lemy Cloud projects through its authenticated MCP. Use when creating, inspecting, updating, restarting, or deleting Lemy projects; configuring OpenAPI URLs, managed models, CORS origins, inline agent skills, or external MCP servers; or checking Lemy credit and model availability.
---

# Manage Lemy

Use the configured `lemy` MCP server for control-plane work. If it is unavailable, ask the user to create a token from **Automation MCP** in Lemy Cloud and configure:

```json
{
  "mcpServers": {
    "lemy": {
      "url": "https://YOUR_LEMY_ORIGIN/control/mcp",
      "headers": { "Authorization": "Bearer YOUR_LEMY_AGENT_TOKEN" }
    }
  }
}
```

Never print, persist, or forward the token to a project, customer API, or external MCP.

## Workflow

1. Call `get_billing` before creating or restarting a project. Select only a returned provider and model.
2. Call `list_projects` before creating one to avoid duplicates. Call `get_project` before updating so unchanged fields are preserved.
3. Require the OpenAPI schema URL, bearer validation URL, and at least one exact React-app origin. Explain that managed production URLs must use public HTTPS.
4. Keep `allowMutations` false unless the user explicitly wants write operations. Lemy's runtime HITL policy remains separate from this setting.
5. Treat inline skills as instructions, never as secret storage.
6. Use `list_external_mcps` before adding a server. For OAuth, return the authorization URL from `connect_external_mcp` and ask the user to open it. For Bearer, request the credential only when connecting it and do not repeat it.
7. Obtain explicit confirmation immediately before restart, disconnect, or deletion tools. Set `confirmed` only after that confirmation.
8. Report the project status and runtime path after a successful change. Provisioning and restart operations are asynchronous.

Do not claim that a project is ready until `get_project` returns `ready`.
