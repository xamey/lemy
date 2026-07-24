# @xameyz/lemy-react-native

Headless React Native client for a Lemy project. It handles the authenticated
Think connection, messages, threads, and human approval while your app owns the
native UI.

## Install

```bash
npm install @xameyz/lemy-react-native @cloudflare/think agents ai
```

React Native 0.78+ and React 19 are required.

## Use

```tsx
import {
  OpenApiAgentProvider,
  useLemyChat,
} from "@xameyz/lemy-react-native";
import { Button, Text, View } from "react-native";

function Chat() {
  const { chat, pendingActions, approveExecution, rejectExecution } = useLemyChat();

  return (
    <View>
      {chat.messages.map((message) => (
        <Text key={message.id}>{message.role}</Text>
      ))}
      <Button
        title="Ask Lemy"
        onPress={() => chat.sendMessage({ text: "What tasks are open?" })}
      />
      {chat.isStreaming && <Button title="Stop" onPress={() => chat.stop()} />}
      {pendingActions.map((action) => (
        <View key={`${action.executionId}-${action.seq}`}>
          <Text>{action.connector}.{action.method}</Text>
          <Button title="Approve once" onPress={() => approveExecution(action.executionId)} />
          <Button title="Always allow" onPress={() => approveExecution(action.executionId, true)} />
          <Button title="Reject" onPress={() => rejectExecution(action.executionId)} />
        </View>
      ))}
    </View>
  );
}

export function Assistant({
  bearer,
  runtimeUrl,
  threadId,
}: {
  bearer: string;
  runtimeUrl: string;
  threadId: string;
}) {
  return (
    <OpenApiAgentProvider
      bearerToken={bearer}
      runtimeUrl={runtimeUrl}
      threadId={threadId}
      toolApprovalMode="mutations"
    >
      <Chat />
    </OpenApiAgentProvider>
  );
}
```

Generate and persist `threadId` with
`createLemyThreadId()` from `@xameyz/lemy-react-native`. Replace it to start a
new conversation.

`toolApprovalMode` accepts `"auto"` (never ask), `"mutations"` (default), or
`"always"`. OpenAPI and external MCP calls use the same durable HITL flow.
`useLemyChat()` exposes messages, `chat.stop()`, pending actions,
`approveExecution()`, and `rejectExecution()` for native controls.
