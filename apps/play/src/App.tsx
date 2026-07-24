import { FormEvent, useEffect, useState } from "react";
import { OpenApiAgentSidebar } from "@xameyz/lemy-react";

import lemyLogo from "../../../logo.png";

interface Task {
  id: string;
  status: "open" | "done";
  title: string;
}

const bearerToken = "demo-token";

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runtimeUrl, setRuntimeUrl] = useState(() => localStorage.getItem("lemy-play-runtime") ?? "");
  const [draftRuntimeUrl, setDraftRuntimeUrl] = useState(runtimeUrl);
  const [error, setError] = useState("");

  async function loadTasks() {
    const response = await fetch("/tasks", {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    setTasks(await response.json() as Task[]);
  }

  useEffect(() => {
    void loadTasks().catch(() => setError("Could not load tasks."));
  }, []);

  function connect(event: FormEvent) {
    event.preventDefault();
    const value = draftRuntimeUrl.trim().replace(/\/+$/, "");
    setRuntimeUrl(value);
    localStorage.setItem("lemy-play-runtime", value);
  }

  async function complete(id: string) {
    const response = await fetch(`/tasks/${id}/complete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    if (!response.ok) return setError("Could not complete the task.");
    await loadTasks();
  }

  async function reset() {
    await fetch("/tasks/reset", {
      method: "POST",
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    await loadTasks();
  }

  return (
    <main>
      <nav>
        <img src={lemyLogo} alt="Lemy" />
        <span>Playground</span>
        <a href="https://cloud.lemy.online" rel="noreferrer" target="_blank">Lemy Cloud ↗</a>
      </nav>
      <div className="layout">
        <section className="tasks">
          <header>
            <div><span>Demo workspace</span><h1>Tasks</h1></div>
            <b>{tasks.filter(({ status }) => status === "open").length} open</b>
          </header>
          <div className="task-list">
            {tasks.map((task) => (
              <article key={task.id}>
                <button aria-label={`Complete ${task.title}`} disabled={task.status === "done"} onClick={() => void complete(task.id)}>{task.status === "done" ? "✓" : ""}</button>
                <div><strong>{task.title}</strong><small>{task.status}</small></div>
              </article>
            ))}
          </div>
          {error && <p className="error">{error}</p>}
          <footer>
            <div>
              <strong>Lemy project configuration</strong>
              <span>
                {runtimeUrl && <button onClick={() => setRuntimeUrl("")}>Change runtime</button>}
                <button onClick={() => void reset()}>Reset demo</button>
              </span>
            </div>
            <span>Project name: <code>Lemy playground</code></span>
            <span>OpenAPI schema: <a href="/openapi.json">https://play.lemy.online/openapi.json</a></span>
            <span>API base URL: <code>https://play.lemy.online</code></span>
            <span>Bearer validation URL: <code>https://play.lemy.online/auth/validate</code></span>
            <span>Browser origins: <code>https://play.lemy.online</code></span>
            <span>Allow mutating tools: <strong>On</strong></span>
            <code>Bearer {bearerToken}</code>
          </footer>
        </section>
        <aside className="assistant">
          {runtimeUrl ? (
            <OpenApiAgentSidebar
              bearerToken={bearerToken}
              runtimeUrl={runtimeUrl}
            />
          ) : (
            <form className="setup" onSubmit={connect}>
              <span>Connect the live demo</span>
              <h2>Configure one Cloud project</h2>
              <p>In <a href="https://cloud.lemy.online" rel="noreferrer" target="_blank">Lemy Cloud</a>, add your model provider key, then create a project with these values.</p>
              <dl>
                <div><dt>Project name</dt><dd>Lemy playground</dd></div>
                <div><dt>OpenAPI schema URL</dt><dd><code>https://play.lemy.online/openapi.json</code></dd></div>
                <div><dt>API base URL</dt><dd><code>https://play.lemy.online</code></dd></div>
                <div><dt>Bearer validation URL</dt><dd><code>https://play.lemy.online/auth/validate</code></dd></div>
                <div><dt>Browser origins</dt><dd><code>https://play.lemy.online</code></dd></div>
                <div><dt>Allow mutating tools</dt><dd><strong>On</strong></dd></div>
              </dl>
              <div className="runtime-connect">
                <strong>Then paste the project runtime URL</strong>
                <input
                  aria-label="Lemy runtime URL"
                  onChange={(event) => setDraftRuntimeUrl(event.target.value)}
                  placeholder="https://cloud.lemy.online/runtime/…"
                  required
                  type="url"
                  value={draftRuntimeUrl}
                />
                <button>Connect Lemy</button>
                <small>This client sends <code>Bearer demo-token</code>. Choose any supported provider and model in your project.</small>
              </div>
            </form>
          )}
        </aside>
      </div>
    </main>
  );
}
