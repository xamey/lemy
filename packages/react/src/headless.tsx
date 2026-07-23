import { useAgentChat } from "@cloudflare/think/react";
import { useAgent } from "agents/react";
import {
  createContext,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { normalizeApprovedTools, type ToolApprovalMode } from "./approval.js";
import {
  createRuntimeSession,
  parseRuntimeUrl,
  runtimeAgentPath,
} from "./runtime.js";

export interface PendingAction {
  args: unknown;
  connector: string;
  executionId: string;
  method: string;
  seq: number;
}

type LemyAgentClient = ReturnType<typeof useAgent<unknown>>;

interface LemyContextValue {
  agent: LemyAgentClient;
  approveExecution(executionId: string, remember?: boolean): Promise<void>;
  chat: ReturnType<typeof useAgentChat>;
  pendingActions: PendingAction[];
  rejectExecution(executionId: string): Promise<void>;
  refreshApprovals(): Promise<void>;
}

const LemyContext = createContext<LemyContextValue | null>(null);

export function useLemyChat() {
  const value = useContext(LemyContext);
  if (!value) throw new Error("useLemyChat must be used inside OpenApiAgentProvider");
  return value;
}

export interface OpenApiAgentProviderProps {
  approvedTools?: readonly string[];
  bearerToken: string;
  children: ReactNode;
  fallback?: ReactNode;
  onApprovedToolsChange?: (approvedTools: string[]) => void;
  runtimeUrl: string;
  threadId: string;
  toolApprovalMode?: ToolApprovalMode;
}

function useApprovedTools(
  scope: string,
  approvedTools: readonly string[] | undefined,
  onApprovedToolsChange: ((approvedTools: string[]) => void) | undefined,
) {
  const [remembered, setRemembered] = useState({ scope, tools: [] as string[] });
  const active = normalizeApprovedTools(
    approvedTools ?? (remembered.scope === scope ? remembered.tools : []),
  );

  return [active, (toolNames: string[]) => {
    const next = normalizeApprovedTools([...active, ...toolNames]);
    if (approvedTools === undefined) setRemembered({ scope, tools: next });
    onApprovedToolsChange?.(next);
  }] as const;
}

function LemyConnection({
  approvedTools,
  bearerToken,
  children,
  onRemember,
  runtimeUrl,
  threadId,
  toolApprovalMode,
}: Omit<OpenApiAgentProviderProps, "approvedTools" | "fallback" | "onApprovedToolsChange"> & {
  approvedTools: string[];
  onRemember: (toolNames: string[]) => void;
}) {
  const parsedRuntime = useMemo(() => parseRuntimeUrl(runtimeUrl), [runtimeUrl]);
  const approvedKey = approvedTools.join(",");
  const query = useCallback(async () => {
    const session = await createRuntimeSession({
      approvedTools,
      bearerToken,
      runtimeUrl,
      threadId,
      toolApprovalMode,
    });
    return { token: session.token };
  }, [approvedKey, bearerToken, runtimeUrl, threadId, toolApprovalMode]);
  const agent = useAgent({
    agent: "lemy-project-agent",
    basePath: runtimeAgentPath(runtimeUrl, threadId),
    cacheTtl: 240_000,
    host: parsedRuntime.origin,
    query,
    queryDeps: [approvedKey, bearerToken, runtimeUrl, threadId, toolApprovalMode],
  });
  const chat = useAgentChat({ agent });
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);

  const refreshApprovals = useCallback(async () => {
    await agent.ready;
    setPendingActions(await agent.call<PendingAction[]>("pendingExecutions"));
  }, [agent]);

  useEffect(() => {
    void refreshApprovals().catch(() => undefined);
  }, [chat.messages, chat.status, refreshApprovals]);

  const approveExecution = useCallback(async (executionId: string, remember = false) => {
    const actions = pendingActions.filter((action) => action.executionId === executionId);
    await agent.call("approveExecution", [executionId]);
    if (remember) onRemember(actions.map(({ connector, method }) => `${connector}.${method}`));
    await refreshApprovals();
  }, [agent, onRemember, pendingActions, refreshApprovals]);

  const rejectExecution = useCallback(async (executionId: string) => {
    await agent.call("rejectExecution", [executionId, "Rejected by the user"]);
    await refreshApprovals();
  }, [agent, refreshApprovals]);

  return (
    <LemyContext.Provider value={{
      agent,
      approveExecution,
      chat,
      pendingActions,
      refreshApprovals,
      rejectExecution,
    }}>
      {children}
    </LemyContext.Provider>
  );
}

export function OpenApiAgentProvider({
  approvedTools,
  bearerToken,
  children,
  fallback = null,
  onApprovedToolsChange,
  runtimeUrl,
  threadId,
  toolApprovalMode = "ask",
}: OpenApiAgentProviderProps) {
  const [activeApprovedTools, rememberTools] = useApprovedTools(
    `${runtimeUrl}\n${bearerToken}`,
    approvedTools,
    onApprovedToolsChange,
  );
  return (
    <Suspense fallback={fallback}>
      <LemyConnection
        approvedTools={activeApprovedTools}
        bearerToken={bearerToken}
        onRemember={rememberTools}
        runtimeUrl={runtimeUrl}
        threadId={threadId}
        toolApprovalMode={toolApprovalMode}
      >
        {children}
      </LemyConnection>
    </Suspense>
  );
}
