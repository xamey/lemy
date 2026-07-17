import {
  CopilotKit,
  CopilotSidebar,
  type CopilotSidebarProps,
} from "@copilotkit/react-core/v2";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { toAuthorizationHeader } from "./auth.js";
import "./styles.css";

export { toAuthorizationHeader } from "./auth.js";

export interface OpenApiAgentProviderProps {
  bearerToken: string;
  runtimeUrl: string;
  children: ReactNode;
  agentId?: string;
  threadId?: string;
}

export function OpenApiAgentProvider({
  agentId = "default",
  bearerToken,
  children,
  runtimeUrl,
  threadId,
}: OpenApiAgentProviderProps) {
  const headers = useMemo(
    () => ({ Authorization: toAuthorizationHeader(bearerToken) }),
    [bearerToken],
  );
  if (!runtimeUrl.trim()) throw new Error("runtimeUrl is required");

  return (
    <CopilotKit
      agent={agentId}
      enableInspector={false}
      headers={headers}
      runtimeUrl={runtimeUrl}
      showDevConsole={false}
      threadId={threadId}
      useSingleEndpoint={false}
    >
      {children}
    </CopilotKit>
  );
}

export interface OpenApiAgentSidebarProps
  extends Omit<OpenApiAgentProviderProps, "children">,
    Omit<CopilotSidebarProps, "agentId" | "threadId"> {
  newConversationLabel?: string;
  onThreadIdChange?: (threadId: string) => void;
  showNewConversationButton?: boolean;
}

export function createLemyThreadId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `lemy-${crypto.randomUUID()}`;
  }
  return `lemy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function OpenApiAgentSidebar({
  agentId = "default",
  bearerToken,
  labels,
  newConversationLabel = "New conversation",
  onThreadIdChange,
  runtimeUrl,
  showNewConversationButton = true,
  threadId,
  ...sidebarProps
}: OpenApiAgentSidebarProps) {
  const { header, ...copilotSidebarProps } = sidebarProps;
  const [internalThreadId, setInternalThreadId] = useState(() => threadId ?? createLemyThreadId());
  const activeThreadId = threadId ?? internalThreadId;

  useEffect(() => {
    if (threadId) setInternalThreadId(threadId);
  }, [threadId]);

  function startNewConversation() {
    const nextThreadId = createLemyThreadId();
    if (!threadId) setInternalThreadId(nextThreadId);
    onThreadIdChange?.(nextThreadId);
  }

  return (
    <OpenApiAgentProvider
      agentId={agentId}
      bearerToken={bearerToken}
      key={activeThreadId}
      runtimeUrl={runtimeUrl}
      threadId={activeThreadId}
    >
      <CopilotSidebar
        agentId={agentId}
        header={
          header ??
          (showNewConversationButton
            ? {
                children: ({ closeButton, drawerLauncher, titleContent }) => (
                  <>
                    <div className="lemySidebarTitle">
                      {drawerLauncher}
                      {titleContent}
                    </div>
                    <div className="lemySidebarActions">
                      <button
                        className="lemyNewConversationButton"
                        onClick={startNewConversation}
                        type="button"
                      >
                        {newConversationLabel}
                      </button>
                      {closeButton}
                    </div>
                  </>
                ),
              }
            : undefined)
        }
        labels={{
          chatDisclaimerText: "Lemy can make mistakes. Verify important actions.",
          chatInputPlaceholder: "Ask Lemy...",
          modalHeaderTitle: "Lemy",
          welcomeMessageText: "What would you like to do?",
          ...labels,
        }}
        threadId={activeThreadId}
        {...copilotSidebarProps}
      />
    </OpenApiAgentProvider>
  );
}
