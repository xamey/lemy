import {
  FormEvent,
  useEffect,
  useState,
} from "react";

import {
  OpenApiAgentProvider as HeadlessOpenApiAgentProvider,
  type OpenApiAgentProviderProps,
  type PendingAction,
  useLemyChat,
} from "./headless.js";
import { createLemyThreadId } from "./runtime.js";
import "./styles.css";

export * from "./core.js";
export {
  type OpenApiAgentProviderProps,
  type PendingAction,
  useLemyChat,
} from "./headless.js";

export function OpenApiAgentProvider(props: OpenApiAgentProviderProps) {
  return <HeadlessOpenApiAgentProvider {...props} fallback={props.fallback ?? <div className="lemyLoading">Connecting to Lemy…</div>} />;
}

function messageText(message: { parts?: Array<Record<string, unknown>> }) {
  return (message.parts ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("")
    .replaceAll("**", "");
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
  const busy = chat.isStreaming || chat.isRecovering;
  const pendingByExecution = pendingActions.reduce((groups, action) => {
    const actions = groups.get(action.executionId) ?? [];
    actions.push(action);
    groups.set(action.executionId, actions);
    return groups;
  }, new Map<string, PendingAction[]>());

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
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
        <button
          aria-label={busy ? "Stop response" : "Send message"}
          disabled={!busy && !input.trim()}
          onClick={busy ? () => void chat.stop() : undefined}
          type={busy ? "button" : "submit"}
        >{busy ? "■" : "↑"}</button>
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

export function OpenApiAgentSidebar({
  approvedTools,
  bearerToken,
  className = "",
  labels,
  onApprovedToolsChange,
  onThreadIdChange,
  runtimeUrl,
  threadId,
  toolApprovalMode = "mutations",
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
