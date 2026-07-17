# @xameyz/lemy-react

React sidebar for Lemy, an OpenAPI agent harness.

Lemy lets users talk to your API in natural language while keeping your existing API, OpenAPI schema, and bearer authentication flow.

## Install

```bash
npm install @xameyz/lemy-react @copilotkit/react-core
```

`react` and `react-dom` are peer dependencies.

## Usage

```tsx
import { OpenApiAgentSidebar } from "@xameyz/lemy-react";
import "@xameyz/lemy-react/styles.css";

export function ApiAssistant({ bearer }: { bearer: string }) {
  return (
    <OpenApiAgentSidebar
      bearerToken={bearer}
      runtimeUrl="https://lemy.example.com/api/copilotkit"
    />
  );
}
```

`bearerToken` should come from your authenticated app session. Lemy forwards it to the runtime, validates it with your configured validation URL, and uses the same authorization when the agent calls your OpenAPI API.

## Threads

The sidebar includes a **New conversation** button by default. It starts a fresh thread so the next conversation has clean agent context.

If your app wants to own thread state:

```tsx
import { useState } from "react";
import { createLemyThreadId, OpenApiAgentSidebar } from "@xameyz/lemy-react";
import "@xameyz/lemy-react/styles.css";

export function ApiAssistant({ bearer }: { bearer: string }) {
  const [threadId, setThreadId] = useState(createLemyThreadId);

  return (
    <OpenApiAgentSidebar
      bearerToken={bearer}
      runtimeUrl="https://lemy.example.com/api/copilotkit"
      threadId={threadId}
      onThreadIdChange={setThreadId}
    />
  );
}
```

## API

### `OpenApiAgentSidebar`

Ready-made CopilotKit sidebar.

Required props:

- `bearerToken`: current user bearer token.
- `runtimeUrl`: Lemy runtime CopilotKit endpoint.

Useful optional props:

- `agentId`: Copilot/LangGraph agent id. Defaults to `default`.
- `threadId`: controlled conversation thread id.
- `onThreadIdChange`: called when the user starts a new conversation.
- `showNewConversationButton`: defaults to `true`.
- `newConversationLabel`: defaults to `New conversation`.

Other CopilotKit sidebar props are forwarded.

### `OpenApiAgentProvider`

Use this if you want to provide your own CopilotKit UI.

### `createLemyThreadId`

Creates a client-side thread id suitable for Lemy conversations.

### `toAuthorizationHeader`

Normalizes a raw token into a `Bearer ...` authorization header value.

## Runtime requirements

This package expects a Lemy runtime deployment configured with:

- `OPENAPI_SCHEMA_URL`
- `BEARER_VALIDATION_URL`
- `CORS_ORIGINS`
- an LLM provider/API key
- PostgreSQL checkpointer config

See the Lemy repository README for the Docker Compose runtime.
