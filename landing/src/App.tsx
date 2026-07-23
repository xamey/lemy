import { type FormEvent, useEffect, useState } from "react";

const tasks = [
  { title: "Map the OpenAPI schema", done: true },
  { title: "Review bearer forwarding", done: false },
  { title: "Ship the Lemy demo", done: false },
];

const linearLogo = "https://cdn.simpleicons.org/linear/5E6AD2";
const datadogLogo = "https://cdn.simpleicons.org/datadog/632CA6";
const configuredCloudUrl = (import.meta.env.VITE_LEMY_CLOUD_URL || "").replace(/\/$/, "");
const cloudApiUrl = configuredCloudUrl || "https://cloud.lemy.online";
const cloudAppUrl = configuredCloudUrl || "https://cloud.lemy.online";

interface Prompt {
  text: string;
  request: string;
  response: string;
  approval: string;
  mcp: string;
  logo?: string;
}

const prompts: readonly Prompt[] = [
  {
    text: "What tasks are still open?",
    request: "GET /tasks?done=false",
    response: "You have 2 open tasks: Review bearer forwarding and Ship the Lemy demo.",
    approval: "Read allowed",
    mcp: "Tasks · OpenAPI",
  },
  {
    text: "Create an issue for the launch blockers",
    request: "mcp__linear__create_issue",
    response: "Created issue ENG-142: Resolve launch blockers.",
    approval: "Approved once",
    mcp: "Linear · OAuth",
    logo: linearLogo,
  },
  {
    text: "Investigate the checkout latency spike",
    request: "mcp__datadog__search_logs",
    response: "The spike comes from checkout-api, with p95 latency at 1.8s.",
    approval: "Read allowed",
    mcp: "Datadog · OAuth",
    logo: datadogLogo,
  },
];

export function App() {
  const [run, setRun] = useState<{ prompt: Prompt } | null>({ prompt: prompts[1] });
  const [completedSteps, setCompletedSteps] = useState(0);
  const [answered, setAnswered] = useState(false);
  const [email, setEmail] = useState("");
  const [accessState, setAccessState] = useState<"idle" | "sending" | "sent" | "limited" | "error">("idle");

  async function requestAccess(event: FormEvent) {
    event.preventDefault();
    setAccessState("sending");
    try {
      const response = await fetch(`${cloudApiUrl}/api/access-requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (response.status === 429) {
        setAccessState("limited");
        return;
      }
      if (!response.ok) throw new Error("Request failed");
      setAccessState("sent");
    } catch {
      setAccessState("error");
    }
  }

  useEffect(() => {
    if (!run) return;
    setCompletedSteps(0);
    setAnswered(false);
    const timers = [1, 2, 3, 4, 5].map((step) =>
      window.setTimeout(() => setCompletedSteps(step), step * 330),
    );
    timers.push(window.setTimeout(() => setAnswered(true), 1_900));
    return () => timers.forEach(window.clearTimeout);
  }, [run]);

  useEffect(() => {
    if (accessState !== "sent") return;
    const timer = window.setTimeout(() => setAccessState("idle"), 4_000);
    return () => window.clearTimeout(timer);
  }, [accessState]);

  const doneCount = tasks.filter(({ done }) => done).length;
  const executionSteps = run ? [
    ["Identity", "Bearer verified"],
    ["Skill", "task-ops loaded"],
    ["Connector", run.prompt.mcp],
    ["Policy", run.prompt.approval],
    ["Tool", run.prompt.request],
  ] : [];

  return (
    <main className="site-shell">
      <nav className="site-nav">
        <a className="site-brand" href="#top" aria-label="Lemy home"><span className="brand-mark" aria-hidden="true">Lemy</span></a>
        <div className="nav-links">
          <a href="#product">Product</a>
          <a href="#deploy">Deploy</a>
          <a href="https://github.com/xamey/lemy" rel="noreferrer" target="_blank">GitHub <span>↗</span></a>
        </div>
        <div className="nav-actions">
          <a className="nav-request" href="#access">Request access</a>
          <a className="nav-sign-in" href={cloudAppUrl}>Sign in</a>
        </div>
      </nav>

      <section
        className="hero"
        id="top"
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          event.currentTarget.style.setProperty("--orb-x", `${((event.clientX - bounds.left) / bounds.width - .5) * 10}px`);
          event.currentTarget.style.setProperty("--orb-y", `${((event.clientY - bounds.top) / bounds.height - .5) * 24}px`);
        }}
        onPointerLeave={(event) => {
          event.currentTarget.style.removeProperty("--orb-x");
          event.currentTarget.style.removeProperty("--orb-y");
        }}
      >
        <div className="hero-orb" aria-hidden="true" />
        <div className="hero-copy">
          <span className="overline"><i /> Source-available agent infrastructure</span>
          <h1>Give your webapp<br /><em>an agent.</em></h1>
          <p>Lemy turns your OpenAPI backend and external MCPs into one secure, stateful agent — managed by Lemy or deployed to your Cloudflare account.</p>
          <div className="hero-actions">
            <a className="button button-dark" href="https://github.com/xamey/lemy" rel="noreferrer" target="_blank">Explore on GitHub <span>↗</span></a>
            <a className="button button-light" href="#product">See the runtime <span>↓</span></a>
          </div>
          <form className="access-form" id="access" onSubmit={requestAccess}>
            <label htmlFor="access-email">Request Lemy Cloud access</label>
            <div><input id="access-email" type="email" required placeholder="you@company.com" value={email} onChange={(event) => { setEmail(event.target.value); setAccessState("idle"); }} /><button disabled={accessState === "sending"}>{accessState === "sending" ? "Sending…" : "Join waitlist"}</button></div>
            <small aria-live="polite">{accessState === "limited" ? "Too many requests. Try again in a minute." : accessState === "error" ? "Could not send your request. Try again." : "Already approved? Use this email with Google or GitHub."}</small>
          </form>
        </div>

        <div className="demo-wrap" aria-label="Interactive Lemy product demonstration">
          <div className="demo-glow" />
          <div className="demo-window">
            <div className="window-bar">
              <div className="window-controls"><i /><i /><i /></div>
              <code>tasks.acme.test</code>
              <span><i /> Agent online</span>
            </div>
            <div className="product-shell">
              <section className="tasks-pane">
                <header><div><small>Workspace</small><strong>Product launch</strong></div><span aria-hidden="true">+</span></header>
                <div className="task-filter"><span>All tasks</span><b>{tasks.length}</b></div>
                <ul>
                  {tasks.map((task) => <li key={task.title} className={task.done ? "done" : ""}>
                    <span>{task.done ? "✓" : ""}</span><div><strong>{task.title}</strong><small>{task.done ? "Completed" : "Open"}</small></div>
                  </li>)}
                </ul>
                <div className="pane-mcps">
                  <div className="floating-card float-skill"><span>EXTERNAL MCP</span><strong><img src={datadogLogo} alt="" /> Datadog connected</strong><i>OAuth 2.1</i></div>
                  <div className="floating-card float-auth"><span>EXTERNAL MCP</span><strong><img src={linearLogo} alt="" /> Linear connected</strong><i>OAuth 2.1</i></div>
                </div>
                <footer><span><b>{doneCount}</b> completed</span><span><b>{tasks.length - doneCount}</b> open</span></footer>
              </section>

              <section className="chat-pane">
                <header><div className="agent-mark">L</div><div><strong>Ask Lemy</strong><small><i /><img src={linearLogo} alt="" /><img src={datadogLogo} alt="" /> Linear + Datadog connected</small></div></header>
                <div className="chat-body" aria-live="polite">
                  {!run ? <div className="chat-empty"><span>✦</span><strong>Your API, conversational.</strong><p>Choose a prompt to watch an authenticated agent run.</p></div> : <>
                    <div className="message user-message"><span>{run.prompt.text}</span></div>
                    <div className="execution-card">
                      <div className="execution-title"><span>Request in flight</span><code>{completedSteps}/5</code></div>
                      {executionSteps.map(([label, value], index) => {
                        const complete = index < completedSteps;
                        const active = index === completedSteps && completedSteps < executionSteps.length;
                        return <div className={`execution-row${complete ? " complete" : ""}${active ? " active" : ""}`} key={label}>
                          <span>{complete ? "✓" : index + 1}</span><b>{label}</b><div className="execution-value">{label === "Connector" && run.prompt.logo && <img src={run.prompt.logo} alt="" />}<code>{value}</code></div>
                        </div>;
                      })}
                    </div>
                    {answered && <div className="message agent-message"><span>✦</span><p>{run.prompt.response}</p></div>}
                  </>}
                </div>
                <div className="prompt-tray"><span>Try a request</span>{prompts.map((prompt) => <button className={run?.prompt === prompt ? "selected" : ""} key={prompt.text} onClick={() => setRun({ prompt })}><span className="prompt-label">{prompt.logo && <img src={prompt.logo} alt="" />}<span>{prompt.text}</span></span><b>↗</b></button>)}</div>
              </section>
            </div>
          </div>
        </div>
      </section>

      <section className="capability-section" id="product">
        <article className="capability-feature"><span className="overline">Built for real products</span><h2>Agentic, without giving up control.</h2><p>Lemy is infrastructure, not a chatbot wrapper. Every run is scoped to a project, user and thread in its own Durable Object.</p><div className="mini-terminal"><header><i /><i /><i /><span>agent run</span></header><code><b>✓</b> principal verified<br /><b>✓</b> skill: task-triage<br /><b>✓</b> external MCP connected<br /><em>?</em> approval requested</code></div></article>
        <div className="capability-grid">
          <article><span>01</span><h3>Identity stays yours</h3><p>Validate the client bearer against your own endpoint, then forward it to every API tool call.</p></article>
          <article><span>02</span><h3>Any MCP, connected</h3><p>Connect issue trackers, observability tools or any remote MCP with OAuth or bearer authentication.</p></article>
          <article><span>03</span><h3>HITL by policy</h3><p>Approve everything, ask every time, or remember approval for a specific tool.</p></article>
          <article><span>04</span><h3>Skills that travel</h3><p>Import and export standard SKILL.md files. Load instructions only when the request needs them.</p></article>
        </div>
      </section>

      <section className="deploy-section" id="deploy">
        <header className="section-heading"><span className="overline">Choose your path</span><h2>Cloud convenience.<br />Self-hosted control.</h2><p>The same Lemy runtime, wherever you want to operate it.</p></header>
        <div className="deploy-grid">
          <article className="deploy-card cloud-card"><div className="deploy-card-heading"><span>Managed</span><i>Lemy Cloud</i></div><h3>Connect an API.<br />Receive a runtime URL.</h3><p>Connect your OpenAI or Anthropic key once, choose a model per project, add external MCPs and ship. Keys stay encrypted and usage is billed directly by your provider.</p><div className="cloud-preview"><header><span>tasks-production</span><i>Ready</i></header><div><small>RUNTIME URL</small><code>/runtime/p_91k…</code><span>Copy</span></div></div></article>
          <article className="deploy-card host-card"><div className="deploy-card-heading"><span>Source available</span><i>Self-hosted</i></div><h3>Your keys.<br />Your Cloudflare account.</h3><p>Deploy the same Worker to your account with Durable Objects and D1 included. Each workspace connects its own OpenAI or Anthropic provider.</p><div className="code-window"><header><span><i /><i /><i /></span><code>terminal</code></header><pre><em>$</em> cp apps/cloud/.dev.vars.example .dev.vars{"\n"}<em>$</em> npm run dev --workspace @lemy/cloud{"\n"}<b>✓</b> Think runtime ready :8788</pre></div></article>
        </div>
      </section>

      <section className="integration-section">
        <div><span className="overline">Native Think client</span><h2>Drop one component into React.</h2><p>The Lemy React package handles secure session exchange, persistent threads, streaming and durable approvals. Build a custom interface with the same Think hooks whenever you need it.</p><a href="https://github.com/xamey/lemy" rel="noreferrer" target="_blank">Read the integration guide <span>↗</span></a></div>
        <div className="code-card"><header><span>App.tsx</span><i>React</i></header><pre><b>import</b> &#123; OpenApiAgentSidebar &#125; <b>from</b>{"\n"}  <em>"@xameyz/lemy-react"</em>;{"\n\n"}<span>&lt;OpenApiAgentSidebar</span>{"\n"}  runtimeUrl=&#123;LEMY_RUNTIME_URL&#125;{"\n"}  bearerToken=&#123;session.token&#125;{"\n"}<span>/&gt;</span></pre></div>
      </section>

      <footer className="site-footer"><a href="https://github.com/xamey/lemy" rel="noreferrer" target="_blank">GitHub <span>↗</span></a></footer>
      {accessState === "sent" && <div className="snackbar" role="status"><span>✓</span><div><strong>You're on the waitlist.</strong><small>We’ll let you know when your access is ready.</small></div></div>}
    </main>
  );
}
