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
        <a href="https://cloud.lemy.online">Lemy Cloud ↗</a>
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
            <div><strong>Test credentials</strong><button onClick={() => void reset()}>Reset demo</button></div>
            <code>Bearer {bearerToken}</code>
            <span>Schema: <a href="/openapi.json">/openapi.json</a></span>
            <span>Validation: <code>/auth/validate</code></span>
          </footer>
        </section>
        <aside className="assistant">
          {runtimeUrl ? (
            <>
              <button className="change-runtime" onClick={() => setRuntimeUrl("")}>Change runtime</button>
              <OpenApiAgentSidebar
                bearerToken={bearerToken}
                runtimeUrl={runtimeUrl}
              />
            </>
          ) : (
            <form onSubmit={connect}>
              <span>One last connection</span>
              <h2>Paste your Lemy runtime URL</h2>
              <p>Create a project in Lemy Cloud with this playground’s schema, base URL, and validation endpoint.</p>
              <input
                aria-label="Lemy runtime URL"
                onChange={(event) => setDraftRuntimeUrl(event.target.value)}
                placeholder="https://cloud.lemy.online/runtime/…"
                required
                type="url"
                value={draftRuntimeUrl}
              />
              <button>Connect Lemy</button>
              <small>Use <code>https://play.lemy.online</code> for both the API base and allowed origin.</small>
            </form>
          )}
        </aside>
      </div>
    </main>
  );
}
