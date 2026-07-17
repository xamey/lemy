import { useEffect, useState } from "react";

import lemyLogo from "../../../logo.png";

const tasks = [
  { title: "Map the OpenAPI schema", done: true },
  { title: "Review bearer forwarding", done: false },
  { title: "Ship the Lemy demo", done: false },
];

const prompts = [
  {
    text: "What tasks are still open?",
    request: "GET /tasks?done=false",
    response: "You have 2 open tasks: Review bearer forwarding and Ship the Lemy demo.",
  },
  {
    text: "Summarize task progress",
    request: "GET /tasks",
    response: "1 of 3 tasks is complete. The OpenAPI schema is mapped; 2 tasks remain.",
  },
];

type Prompt = (typeof prompts)[number];

export function App() {
  const [run, setRun] = useState<{ id: number; prompt: Prompt } | null>(null);
  const [completedSteps, setCompletedSteps] = useState(0);
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    if (!run) return;

    setCompletedSteps(0);
    setAnswered(false);

    const timers = [1, 2, 3, 4].map((step) =>
      window.setTimeout(() => setCompletedSteps(step), step * 420),
    );
    timers.push(window.setTimeout(() => setAnswered(true), 2_050));

    return () => timers.forEach(window.clearTimeout);
  }, [run]);

  const executionSteps = run
    ? [
        ["Auth", "Bearer attached"],
        ["Agent", "Calls MCP execute"],
        ["MCP", run.prompt.request],
        ["API", "200 OK"],
      ]
    : [];

  function runPrompt(prompt: Prompt) {
    setRun({ id: Date.now(), prompt });
  }

  return (
    <main className="page-shell">
      <nav>
        <div className="brand">
          <img className="brand-logo" src={lemyLogo} alt="" />
          <strong>Lemy</strong>
        </div>
        <span className="status"><i /> Open source · self-hosted</span>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <h1>Allow users to<br /><span>chat with your<br />React app</span></h1>
          <p className="lead">
            Add a lightweight harness that lets your users communicate with your API in natural language. Your API only needs an OpenAPI schema.
          </p>
          <div className="provider-row" aria-label="Supported model providers">
            <span>OpenAI</span>
            <span>Anthropic</span>
            <span>Compatible endpoints</span>
          </div>
        </div>

        <div className="demo-card" aria-label="Interactive Lemy example">
          <div className="product-bar">
            <div className="window-dots" aria-hidden="true"><i /><i /><i /></div>
            <strong>Demo application</strong>
            <span><i /> Agent ready</span>
          </div>

          <div className="product-shell">
            <section className="tasks-pane" aria-label="Tiny Tasks application">
              <div className="pane-heading">
                <div>
                  <small>Tiny Tasks</small>
                  <strong>Tasks</strong>
                </div>
                <span>3 total</span>
              </div>

              <div className="api-status"><i /> API connected</div>

              <ul className="task-list">
                {tasks.map((task) => (
                  <li key={task.title}>
                    <span className={task.done ? "task-check done" : "task-check"}>
                      {task.done ? "✓" : ""}
                    </span>
                    <div>
                      <strong>{task.title}</strong>
                      <small>{task.done ? "Done" : "Open"}</small>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="task-summary"><b>1</b> done <span /> <b>2</b> open</div>
            </section>

            <section className="chat-pane" aria-label="Lemy chat">
              <div className="chat-heading">
                <div className="chat-avatar">L</div>
                <div>
                  <strong>Lemy</strong>
                  <span><i /> Ready</span>
                </div>
              </div>

              <div className="chat-body" aria-live="polite">
                {!run ? (
                  <div className="chat-empty">
                    <strong>Ask your API</strong>
                    <p>Choose a prompt to see the authenticated request execute.</p>
                  </div>
                ) : (
                  <>
                    <div className="chat-message user">{run.prompt.text}</div>
                    <div className="execution" role="status" aria-label="Request progress">
                      {executionSteps.map(([label, value], index) => {
                        const complete = index < completedSteps;
                        const active = index === completedSteps && completedSteps < executionSteps.length;

                        return (
                          <div className={`execution-row${complete ? " complete" : ""}${active ? " active" : ""}`} key={label}>
                            <b>{label}</b>
                            <code>{value}</code>
                            <span>{complete ? "✓" : ""}</span>
                          </div>
                        );
                      })}
                    </div>
                    {answered && <div className="chat-message assistant">{run.prompt.response}</div>}
                  </>
                )}
              </div>

              <div className="suggestions">
                <span>Suggested prompts</span>
                <div>
                  {prompts.map((prompt) => (
                    <button
                      className={run?.prompt === prompt ? "selected" : ""}
                      key={prompt.text}
                      onClick={() => runPrompt(prompt)}
                      type="button"
                    >
                      {prompt.text}<b>↗</b>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
