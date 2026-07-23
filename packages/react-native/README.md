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
  const { chat } = useLemyChat();

  return (
    <View>
      {chat.messages.map((message) => (
        <Text key={message.id}>{message.role}</Text>
      ))}
      <Button
        title="Ask Lemy"
        onPress={() => chat.sendMessage({ text: "What tasks are open?" })}
      />
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
    >
      <Chat />
    </OpenApiAgentProvider>
  );
}
```

Generate and persist `threadId` as a UUID in the app. Replace it to start a new
conversation. `useLemyChat()` also exposes pending actions,
`approveExecution()`, and `rejectExecution()` for native approval controls.
