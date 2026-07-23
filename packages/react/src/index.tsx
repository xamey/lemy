import { useAgentChat } from "@cloudflare/think/react";
import { useAgent } from "agents/react";
import {
  createContext,
  FormEvent,
  ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { normalizeApprovedTools, type ToolApprovalMode } from "./approval.js";
import { toAuthorizationHeader } from "./auth.js";
import {
  createRuntimeSession,
  parseRuntimeUrl,
  runtimeAgentPath,
  type RuntimeSession,
} from "./runtime.js";
import "./styles.css";

export { type ToolApprovalMode } from "./approval.js";
export { toAuthorizationHeader } from "./auth.js";
export { createRuntimeSession, parseRuntimeUrl, runtimeAgentPath } from "./runtime.js";

interface PendingAction {
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
    const pending = await agent.call<PendingAction[]>("pendingExecutions");
    setPendingActions(pending);
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
  fallback = <div className="lemyLoading">Connecting to Lemy…</div>,
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

function messageText(message: { parts?: Array<Record<string, unknown>> }) {
  return (message.parts ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("");
}

function ApprovalCard({ executionId, actions }: { executionId: string; actions: PendingAction[] }) {
  const { approveExecution, rejectExecution } = useLemyChat();
  const [submitting, setSubmitting] = useState(false);

  async function decide(action: "approve" | "always" | "reject") {
    setSubmitting(true);
    try {
      if (action === "reject") await rejectExecution(executionId);
      else await approveExecution(executionId, action === "always");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="lemyApproval" aria-label="Tool approval required">
      <span>Approval required</span>
      {actions.map((action) => (
        <div key={`${action.executionId}-${action.seq}`}>
          <strong>{action.connector}.{action.method}</strong>
          <pre>{JSON.stringify(action.args, null, 2)}</pre>
        </div>
      ))}
      <footer>
        <button disabled={submitting} onClick={() => void decide("approve")} type="button">Approve once</button>
        <button disabled={submitting} onClick={() => void decide("always")} type="button">Always allow</button>
        <button className="lemyReject" disabled={submitting} onClick={() => void decide("reject")} type="button">Reject</button>
      </footer>
    </section>
  );
}

function ChatPanel({ labels, onNewConversation }: {
  labels: Required<OpenApiAgentSidebarLabels>;
  onNewConversation: () => void;
}) {
  const { chat, pendingActions } = useLemyChat();
  const [input, setInput] = useState("");
  const pendingByExecution = pendingActions.reduce((groups, action) => {
    const actions = groups.get(action.executionId) ?? [];
    actions.push(action);
    groups.set(action.executionId, actions);
    return groups;
  }, new Map<string, PendingAction[]>());

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || chat.isStreaming) return;
    setInput("");
    await chat.sendMessage({ text });
  }

  return (
    <div className="lemyPanel">
      <header className="lemyHeader">
        <div><i /><strong>{labels.title}</strong></div>
        <button onClick={onNewConversation} type="button">{labels.newConversation}</button>
      </header>
      <div className="lemyMessages" aria-live="polite">
        {!chat.messages.length && (
          <div className="lemyWelcome"><i>✦</i><strong>{labels.welcome}</strong><span>{labels.welcomeHint}</span></div>
        )}
        {chat.messages.map((message) => {
          const text = messageText(message as { parts?: Array<Record<string, unknown>> });
          return text ? <div className={`lemyMessage lemyMessage--${message.role}`} key={message.id}>{text}</div> : null;
        })}
        {[...pendingByExecution].map(([executionId, actions]) => (
          <ApprovalCard actions={actions} executionId={executionId} key={executionId} />
        ))}
        {(chat.isStreaming || chat.isRecovering) && <div className="lemyThinking"><i /><i /><i /></div>}
        {chat.error && <div className="lemyError">{chat.error.message}</div>}
      </div>
      <form className="lemyComposer" onSubmit={(event) => void submit(event)}>
        <textarea
          aria-label={labels.inputPlaceholder}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={labels.inputPlaceholder}
          rows={2}
          value={input}
        />
        <button disabled={!input.trim() || chat.isStreaming} type="submit" aria-label="Send message">↑</button>
      </form>
      <p className="lemyDisclaimer">{labels.disclaimer}</p>
    </div>
  );
}

export interface OpenApiAgentSidebarLabels {
  disclaimer?: string;
  inputPlaceholder?: string;
  newConversation?: string;
  title?: string;
  welcome?: string;
  welcomeHint?: string;
}

export interface OpenApiAgentSidebarProps
  extends Omit<OpenApiAgentProviderProps, "children" | "fallback" | "threadId"> {
  className?: string;
  labels?: OpenApiAgentSidebarLabels;
  onThreadIdChange?: (threadId: string) => void;
  threadId?: string;
}

export function createLemyThreadId(): string {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("createLemyThreadId requires crypto.randomUUID");
  }
  return crypto.randomUUID();
}

export function OpenApiAgentSidebar({
  approvedTools,
  bearerToken,
  className = "",
  labels,
  onApprovedToolsChange,
  onThreadIdChange,
  runtimeUrl,
  threadId,
  toolApprovalMode = "ask",
}: OpenApiAgentSidebarProps) {
  const [internalThreadId, setInternalThreadId] = useState(() => threadId ?? createLemyThreadId());
  const activeThreadId = threadId ?? internalThreadId;
  const resolvedLabels = {
    disclaimer: "Lemy can make mistakes. Verify important actions.",
    inputPlaceholder: "Ask Lemy…",
    newConversation: "New chat",
    title: "Lemy",
    welcome: "How can I help?",
    welcomeHint: "Ask about your app or tell me what to do.",
    ...labels,
  };

  useEffect(() => {
    if (threadId) setInternalThreadId(threadId);
  }, [threadId]);

  function startNewConversation() {
    const next = createLemyThreadId();
    if (!threadId) setInternalThreadId(next);
    onThreadIdChange?.(next);
  }

  return (
    <aside className={`lemySidebar ${className}`.trim()}>
      <OpenApiAgentProvider
        approvedTools={approvedTools}
        bearerToken={bearerToken}
        key={activeThreadId}
        onApprovedToolsChange={onApprovedToolsChange}
        runtimeUrl={runtimeUrl}
        threadId={activeThreadId}
        toolApprovalMode={toolApprovalMode}
      >
        <ChatPanel labels={resolvedLabels} onNewConversation={startNewConversation} />
      </OpenApiAgentProvider>
    </aside>
  );
}

export type { RuntimeSession };
