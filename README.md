![Lemy](logo.png)

# Lemy

Lemy is a small, self-hosted stack that turns an OpenAPI API into an authenticated conversational agent for React applications.

```mermaid
flowchart LR
  UI["React client"] -->|"AG-UI + Bearer"| Runtime["CopilotKit Runtime"]
  Runtime --> Agent["LangGraph agent"]
  Agent -->|"MCP + Bearer"| CodeMode["Cloudflare Code Mode"]
  CodeMode -->|"OpenAPI request + Bearer"| API["Your API"]
  Agent --> LLM["OpenAI, Anthropic, or compatible LLM"]
  Agent --> Postgres[("PostgreSQL checkpoints")]
```

The client supplies a runtime URL and the current user's bearer. The same authorization reaches the declared API operation without entering the model prompt, Code Mode sandbox, or persisted graph state.

## Quick start

Requirements: Docker with Compose and a supported model provider API key.

```bash
cp .env.example .env
```

Set these values in `.env`:

```dotenv
OPENAPI_SCHEMA_URL=https://api.example.com/openapi.json
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_MODEL=gpt-5-mini
DATABASE_URL=postgresql://user:password@host:5432/harness
BEARER_VALIDATION_URL=https://api.example.com/me
```

Then start the complete stack:

```bash
docker compose up --build
```

- CopilotKit Runtime: http://localhost:4000/api/copilotkit
- Code Mode MCP: http://localhost:8787/mcp

Compose starts the harness services only. In your application, the runtime requires a Bearer credential, validates it through `BEARER_VALIDATION_URL`, and forwards the same credential to your API. Your API remains responsible for enforcing operation-level permissions.

For local development with the bundled Postgres container, leave `DATABASE_URL` empty and set the individual parts:

```dotenv
POSTGRES_USER=postgres
POSTGRES_PASSWORD=choose-a-password
POSTGRES_DB=harness
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
```

Then include the Postgres override:

```bash
docker compose -f compose.yaml -f compose.postgres.yaml up --build
```

To run the animated request-cycle demo separately:

```bash
npm ci
npm run dev --workspace @lemy/request-cycle-demo
```

The demo is intentionally illustrative: it demonstrates the complete request cycle without accepting credentials or acting as the consumer integration test app.

The project landing page is a separate workspace:

```bash
npm run dev --workspace @lemy/landing
npm run build --workspace @lemy/landing
```

For GitHub Pages, publish the generated `landing/dist` directory.

## Add it to a React app

The reusable package is in [`packages/react`](packages/react). It exports a provider and a ready-made sidebar.

```tsx
import { OpenApiAgentSidebar } from "@lemy/react";
import "@lemy/react/styles.css";

export function ApiAgent({ bearer }: { bearer: string }) {
  return (
    <OpenApiAgentSidebar
      bearerToken={bearer}
      runtimeUrl="https://agent.example.com/api/copilotkit"
    />
  );
}
```

By default, `OpenApiAgentSidebar` shows a "New conversation" button. Clicking it starts a fresh client thread ID, which gives the agent a clean checkpoint context for the next conversation. To control threads from the host app, pass `threadId` and update it when Lemy requests a new one:

```tsx
import { useState } from "react";
import { createLemyThreadId, OpenApiAgentSidebar } from "@lemy/react";

const [threadId, setThreadId] = useState(createLemyThreadId);

<OpenApiAgentSidebar
  bearerToken={bearer}
  runtimeUrl="https://agent.example.com/api/copilotkit"
  threadId={threadId}
  onThreadIdChange={setThreadId}
/>
```

Use `OpenApiAgentProvider` instead when the application supplies its own CopilotKit UI. Pass the credential from authenticated application state; do not put it in a build-time environment variable.

### Consumer Integration Checklist

In the Lemy deployment, configure:

```dotenv
OPENAPI_SCHEMA_URL=https://api.example.com/openapi.json
BEARER_VALIDATION_URL=https://api.example.com/me
CORS_ORIGINS=https://app.example.com
```

In the React app, pass:

```tsx
<OpenApiAgentSidebar
  bearerToken={currentUserBearer}
  runtimeUrl="https://lemy.example.com/api/copilotkit"
/>
```

`BEARER_VALIDATION_URL` should be a cheap authentication endpoint, such as `/me`, `/session`, or `/auth/validate`. It only needs to confirm that the bearer is valid for the current user; operation-level permission checks still belong to the OpenAPI API endpoints that the agent calls.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAPI_SCHEMA_URL` | required | Public OpenAPI 3.x JSON document |
| `OPENAPI_BASE_URL` | schema `servers[0]` | Override when the document has no usable server URL |
| `API_NAME` | `openapi-api` | MCP server name |
| `ALLOW_MUTATIONS` | `false` | Allow POST, PUT, PATCH, and DELETE operations |
| `LLM_PROVIDER` | `openai` | `openai`, `anthropic`, or `openai-compatible` |
| `LLM_API_KEY` | required | Server-side model provider credential |
| `LLM_MODEL` | `gpt-5-mini` | Provider model name |
| `LLM_BASE_URL` | none | Required for `openai-compatible` |
| `SYSTEM_PROMPT` | built in | Agent policy override |
| `DATABASE_URL` | none | Preferred full checkpoint database URL |
| `POSTGRES_USER` | `postgres` | Checkpoint database user when `DATABASE_URL` is not set |
| `POSTGRES_PASSWORD` | required without `DATABASE_URL` | Checkpoint database password when `DATABASE_URL` is not set |
| `POSTGRES_DB` | `harness` | Checkpoint database name when `DATABASE_URL` is not set |
| `POSTGRES_HOST` / `POSTGRES_PORT` | `postgres` / `5432` | Checkpoint database address when `DATABASE_URL` is not set |
| `MCP_URL` | `http://codemode:8787/mcp` | External/deployed Code Mode MCP override |
| `AGENT_URL` | `http://agent:8000/agent` | AG-UI agent URL used by the runtime |
| `BEARER_VALIDATION_URL` | required | Endpoint the runtime calls with the same bearer before each agent request |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed web origins |
| `COPILOTKIT_TELEMETRY_DISABLED` | `true` | Disable CopilotKit telemetry |
| `BIND_ADDRESS` | `127.0.0.1` | Address used for Compose-published ports |
| `RUNTIME_PORT` / `MCP_PORT` | `4000` / `8787` | Published Compose ports |

### Model providers

OpenAI is the default. For Anthropic:

```dotenv
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-6
```

For an OpenAI Chat Completions-compatible endpoint:

```dotenv
LLM_PROVIDER=openai-compatible
LLM_API_KEY=provider-key
LLM_MODEL=provider-model-name
LLM_BASE_URL=https://models.example.com/v1
```

Compatible models must support tool calling because the agent binds the MCP operations as LangChain tools.

## Services

- `services/codemode`: Cloudflare Worker exposing `search` and `execute` MCP tools over the OpenAPI document.
- `services/agent`: FastAPI AG-UI endpoint, LangGraph workflow, request-scoped MCP client, and PostgreSQL checkpointer.
- `services/runtime`: CopilotKit Runtime proxy that forwards only the `Authorization` header to the agent.
- `packages/react`: reusable CopilotKit provider/sidebar with bearer forwarding.
- `examples/request-cycle-demo`: optional animated demo showing the full request cycle.
- `landing`: project landing page source, suitable for GitHub Pages.

## Security defaults

- Mutating operations are disabled unless `ALLOW_MUTATIONS=true`.
- Code Mode rejects undeclared methods and paths, traversal attempts, and non-HTTP API origins.
- The runtime sends `GET BEARER_VALIDATION_URL` with the user's `Authorization` header and rejects the agent request unless the response is successful.
- The bearer stays in request-local context and trusted host callbacks. It is not checkpointed or exposed to sandboxed code.
- Internal checkpoint thread IDs use a one-way token hash so identical client thread IDs remain isolated between users without changing LangGraph subgraph semantics.
- Compose binds published ports to loopback by default. In production, put the runtime and MCP behind HTTPS and keep `BEARER_VALIDATION_URL` on an endpoint backed by your real auth system.
- Restrict `CORS_ORIGINS`, keep the LLM and PostgreSQL credentials server-side, and set `OPENAPI_BASE_URL` to pin the API origin when the schema is not fully trusted.

Cloudflare Code Mode currently transports path, query, and body arguments to the host callback, but not OpenAPI header or cookie parameters. APIs requiring those parameters need an adapter until Code Mode exposes them. When mutations are enabled, confirmation is agent policy rather than a host-enforced approval step.

Code Mode is still experimental. Pin dependencies and test the operations your API exposes before production rollout.

## Deploy Code Mode to Cloudflare

Compose runs the Worker locally with `workerd`. To deploy it to Cloudflare instead:

```bash
cd services/codemode
npx wrangler deploy \
  --var OPENAPI_SCHEMA_URL:https://api.example.com/openapi.json \
  --var API_NAME:my-api \
  --var ALLOW_MUTATIONS:false
```

Set `MCP_URL` to the deployed `/mcp` URL. Add `OPENAPI_BASE_URL` as another Worker variable when the schema does not provide the correct base URL.

## Development

```bash
npm ci
npm run check

cd services/agent
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run pytest
```

Validate Compose without starting it:

```bash
OPENAPI_SCHEMA_URL=https://example.com/openapi.json \
LLM_API_KEY=test \
DATABASE_URL=postgresql://user:password@host:5432/db \
BEARER_VALIDATION_URL=https://api.example.com/me \
docker compose config --quiet
```

## License

Apache-2.0. See [LICENCE.md](LICENCE.md).
