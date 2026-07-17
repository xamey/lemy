import {
  CopilotKit,
  CopilotSidebar,
  type CopilotSidebarProps,
} from "@copilotkit/react-core/v2";
import { useMemo, type ReactNode } from "react";

import { toAuthorizationHeader } from "./auth.js";
import "./styles.css";

export { toAuthorizationHeader } from "./auth.js";

export interface OpenApiAgentProviderProps {
  bearerToken: string;
  runtimeUrl: string;
  children: ReactNode;
  agentId?: string;
}

export function OpenApiAgentProvider({
  agentId = "default",
  bearerToken,
  children,
  runtimeUrl,
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
      useSingleEndpoint={false}
    >
      {children}
    </CopilotKit>
  );
}

export interface OpenApiAgentSidebarProps
  extends Omit<OpenApiAgentProviderProps, "children">,
    Omit<CopilotSidebarProps, "agentId"> {}

export function OpenApiAgentSidebar({
  agentId = "default",
  bearerToken,
  labels,
  runtimeUrl,
  ...sidebarProps
}: OpenApiAgentSidebarProps) {
  return (
    <OpenApiAgentProvider
      agentId={agentId}
      bearerToken={bearerToken}
      runtimeUrl={runtimeUrl}
    >
      <CopilotSidebar
        agentId={agentId}
        labels={{
          chatDisclaimerText: "Lemy can make mistakes. Verify important actions.",
          chatInputPlaceholder: "Ask Lemy...",
          modalHeaderTitle: "Lemy",
          welcomeMessageText: "What would you like to do?",
          ...labels,
        }}
        {...sidebarProps}
      />
    </OpenApiAgentProvider>
  );
}
