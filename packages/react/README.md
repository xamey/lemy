# @xameyz/lemy-react

Drop-in React chat for a Lemy project running on Cloudflare Think.

## Install

```bash
npm install @xameyz/lemy-react @cloudflare/think agents ai
```

React 19 is required.

For React Native, use `@xameyz/lemy-react-native`.

## Use the sidebar

```tsx
import { OpenApiAgentSidebar } from "@xameyz/lemy-react";
import "@xameyz/lemy-react/styles.css";

export function Assistant({ bearer }: { bearer: string }) {
  return (
    <OpenApiAgentSidebar
      bearerToken={bearer}
      runtimeUrl="https://lemy.example.com/runtime/YOUR_PROJECT_ID"
    />
  );
}
```

The browser sends the bearer once to the project's HTTPS session endpoint. Lemy validates it, returns a short-lived opaque credential, and uses that credential for the Think WebSocket. The customer bearer is never placed in the WebSocket URL.

## Threads

The included **New chat** button creates a fresh Durable Object conversation. Control the thread from your app when you need routing or persistence:

```tsx
import { createLemyThreadId, OpenApiAgentSidebar } from "@xameyz/lemy-react";
import { useState } from "react";

const [threadId, setThreadId] = useState(createLemyThreadId);

<OpenApiAgentSidebar
  bearerToken={bearer}
  runtimeUrl={project.runtimeUrl}
  threadId={threadId}
  onThreadIdChange={setThreadId}
/>
```

## Human approval

`toolApprovalMode="ask"` is the default. Mutating OpenAPI operations and external MCP tools pause durably before execution. The sidebar supports **Approve once**, **Always allow**, and **Reject**.

```tsx
const [approvedTools, setApprovedTools] = useState<string[]>([]);

<OpenApiAgentSidebar
  approvedTools={approvedTools}
  bearerToken={bearer}
  onApprovedToolsChange={setApprovedTools}
  runtimeUrl={project.runtimeUrl}
  toolApprovalMode="ask"
/>
```

Persist `approvedTools` per authenticated user and Lemy project. Use `toolApprovalMode="auto"` only when every configured tool may run without confirmation.

## Custom UI

`OpenApiAgentProvider` establishes the authenticated Think connection. Build any UI on top of `useLemyChat()`:

```tsx
function MyChat() {
  const { chat, pendingActions, approveExecution, rejectExecution } = useLemyChat();
  // Render chat.messages and call chat.sendMessage({ text }).
}

<OpenApiAgentProvider
  bearerToken={bearer}
  runtimeUrl={project.runtimeUrl}
  threadId={threadId}
>
  <MyChat />
</OpenApiAgentProvider>
```

`useLemyChat()` exposes the native Think chat, connection, durable pending actions, and approval methods. No CopilotKit, LangGraph, PostgreSQL, or AG-UI bridge is involved.
