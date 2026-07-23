import { type FormEvent, useEffect, useState } from "react";

import githubMark from "./github-mark.svg";
import lemyLogo from "../../../logo.png";
import { accessRequestError } from "./access-request-error";
import { authClient } from "./auth-client";
import {
  formatSkillMarkdown,
  parseSkillMarkdown,
  type AgentSkill,
} from "./skill-file";

type ProjectStatus = "provisioning" | "ready" | "error" | "deleting";
type LlmProvider = "openai" | "anthropic";

interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  openapiSchemaUrl: string;
  openapiBaseUrl: string | null;
  bearerValidationUrl: string;
  corsOrigins: string[];
  allowMutations: boolean;
  llmProvider: LlmProvider;
  llmModel: string;
  skills: AgentSkill[];
  runtimePath: string;
  lastError: string | null;
  updatedAt: string;
}

interface ProjectDraft {
  name: string;
  openapiSchemaUrl: string;
  openapiBaseUrl: string;
  bearerValidationUrl: string;
  corsOrigins: string;
  allowMutations: boolean;
  llmProvider: LlmProvider;
  llmModel: string;
  skills: AgentSkill[];
}

interface ExternalMcp {
  id: string;
  projectId: string;
  name: string;
  url: string;
  authType: "oauth" | "bearer";
  connected: boolean;
}

interface SessionData {
  user: { name: string; email: string; image?: string | null };
  session: { id: string };
  access: { granted: boolean };
}

interface AccessRequest {
  id: string;
  email: string;
  status: "pending" | "granted";
  requestedAt: string;
}

interface ProviderConfiguration {
  provider: LlmProvider;
  configured: boolean;
  status: "not_configured" | "validated" | "invalid";
  validatedAt: string | null;
}

interface LlmModel {
  provider: LlmProvider;
  model: string;
  label: string;
}

interface ProviderCatalog {
  providers: ProviderConfiguration[];
  models: LlmModel[];
}

interface CloudUsage {
  used: number;
  limit: number;
  month: string;
}

interface AgentToken {
  id: string;
  name: string;
  permission: "read" | "write";
  projectId: string;
  token?: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface ProjectRun {
  id: string;
  source: "runtime" | "playground";
  status: "completed" | "error" | "aborted";
  model: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  error: string | null;
  completedAt: string;
}

interface PlaygroundResult {
  answer: string;
  pendingTools: string[];
  status: string;
}

const emptyDraft: ProjectDraft = {
  name: "",
  openapiSchemaUrl: "",
  openapiBaseUrl: "",
  bearerValidationUrl: "",
  corsOrigins: "",
  allowMutations: false,
  llmProvider: "openai",
  llmModel: "gpt-5.6-luna",
  skills: [],
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(result.error ?? "Request failed");
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

function Login() {
  const [busy, setBusy] = useState<"github" | "google" | null>(null);
  const [email, setEmail] = useState("");
  const [accessState, setAccessState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [accessError, setAccessError] = useState("");

  async function signIn(provider: "github" | "google") {
    setBusy(provider);
    await authClient.signIn.social({ provider, callbackURL: window.location.origin });
    setBusy(null);
  }

  async function requestAccess(event: FormEvent) {
    event.preventDefault();
    setAccessState("sending");
    setAccessError("");
    try {
      await api("/api/access-requests", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setAccessState("sent");
    } catch (cause) {
      setAccessState("error");
      setAccessError(accessRequestError(cause));
    }
  }

  return (
    <main
      className="login-page"
      onPointerMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty("--orb-x", `${((event.clientX - bounds.left) / bounds.width - .5) * 34}px`);
        event.currentTarget.style.setProperty("--orb-y", `${((event.clientY - bounds.top) / bounds.height - .5) * 24}px`);
      }}
      onPointerLeave={(event) => {
        event.currentTarget.style.removeProperty("--orb-x");
        event.currentTarget.style.removeProperty("--orb-y");
      }}
    >
      <section className="login-copy">
        <div className="login-orb" aria-hidden="true" />
        <img src={lemyLogo} alt="Lemy" />
        <span className="eyebrow">Managed agent infrastructure</span>
        <h1>Give your API<br /><em>an agent.</em></h1>
        <p>Connect an OpenAPI schema. Configure its model, tools and policies. Ship one secure runtime URL.</p>
        <div className="login-points">
          <span><i>1</i> Your identity and API permissions stay yours</span>
          <span><i>2</i> MCPs, human approval and skills are built in</span>
          <span><i>3</i> Every project runs in an isolated environment</span>
        </div>
      </section>
      <section className="login-card">
        <div className="login-heading">
          <span className="invite-badge">Invite-only beta</span>
          <h2>Login to Lemy Cloud</h2>
          <p>Request access with your email. Once approved, sign in with the matching Google or GitHub account.</p>
        </div>
        <form className="login-access" onSubmit={requestAccess}>
          <label htmlFor="access-email">Email</label>
          <div><input id="access-email" type="email" autoComplete="email" required placeholder="you@company.com" value={email} onChange={(event) => { setEmail(event.target.value); setAccessState("idle"); setAccessError(""); }} /><button disabled={accessState === "sending" || accessState === "sent"}>{accessState === "sending" ? "Sending…" : accessState === "sent" ? "Requested" : "Request access"}</button></div>
          <small className={accessState === "error" ? "access-error" : ""} aria-live="polite">{accessState === "sent" ? "Request received. Sign in with this email after approval." : accessState === "error" ? accessError : "Join the Lemy Cloud waitlist."}</small>
        </form>
        <div className="login-divider"><span>Already approved?</span></div>
        <button onClick={() => signIn("github")} disabled={busy !== null}>
          <img src={githubMark} alt="" aria-hidden="true" />{busy === "github" ? "Opening GitHub…" : "Continue with GitHub"}
        </button>
        <button onClick={() => signIn("google")} disabled={busy !== null}>
          <img src="https://developers.google.com/static/identity/images/g-logo.png" alt="" aria-hidden="true" />{busy === "google" ? "Opening Google…" : "Continue with Google"}
        </button>
        <small className="login-note">Use the Google or GitHub account matching your approved email.</small>
        <small className="login-privacy">See how Lemy uses your account information in the <a href="/privacy">privacy notice</a>.</small>
      </section>
    </main>
  );
}

function Privacy() {
  return (
    <main className="privacy-page">
      <article>
        <img src={lemyLogo} alt="Lemy" />
        <span className="eyebrow">Privacy</span>
        <h1>Your data stays yours.</h1>
        <p>Lemy Cloud stores the email you submit for access. If you sign in, Google or GitHub also provides your name, email and profile image so Lemy can authenticate you and operate your workspace.</p>
        <h2>Workspace data</h2>
        <p>Project configuration, encrypted provider credentials, agent conversations and usage records are stored only as needed to run Lemy Cloud.</p>
        <h2>Connected services</h2>
        <p>Requests may be sent to the LLM providers and external MCPs you choose. Their own privacy terms apply. Self-hosted Lemy data stays in the infrastructure you control.</p>
        <a href="/">← Back to Lemy Cloud</a>
      </article>
    </main>
  );
}

function PendingAccess({ user }: { user: SessionData["user"] }) {
  return (
    <main className="access-pending">
      <section>
        <img src={lemyLogo} alt="Lemy" />
        <span className="eyebrow">Invite-only access</span>
        <h1>Access not granted.</h1>
        <p>Request access from the Lemy landing page, then return with the same Google or GitHub email. You signed in as <b>{user.email}</b>.</p>
        <button className="secondary-button" onClick={async () => {
          await authClient.signOut();
          window.location.reload();
        }}>Sign out</button>
      </section>
    </main>
  );
}

function Status({ value }: { value: ProjectStatus }) {
  return <span className={`project-status ${value}`}><i />{value}</span>;
}

function ProjectAutomation({ project, onClose }: { project: Project; onClose(): void }) {
  const [tokens, setTokens] = useState<AgentToken[]>([]);
  const [created, setCreated] = useState<AgentToken | null>(null);
  const [name, setName] = useState("My agent");
  const [permission, setPermission] = useState<AgentToken["permission"]>("read");
  const [error, setError] = useState("");

  async function load() {
    try {
      setTokens(await api<AgentToken[]>(`/api/projects/${project.id}/agent-tokens`));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load agent tokens");
    }
  }

  useEffect(() => { void load(); }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      const token = await api<AgentToken>(`/api/projects/${project.id}/agent-tokens`, {
        method: "POST",
        body: JSON.stringify({ name, permission }),
      });
      setCreated(token);
      setTokens((current) => [token, ...current]);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create token");
    }
  }

  async function revoke(token: AgentToken) {
    if (!window.confirm(`Revoke ${token.name}? Connected agents will stop working.`)) return;
    await api(`/api/projects/${project.id}/agent-tokens/${token.id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="project-drawer agent-access">
        <header><div><small>{project.name}</small><h2>Agent access</h2></div><button className="icon-button" onClick={onClose} aria-label="Close">×</button></header>
        <div className="agent-access-body">
          <p>Create a revocable token for this project, then connect your coding agent to <code>{window.location.origin}/control/mcp</code>.</p>
          <form onSubmit={create}>
            <label>Token name<input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label>Permission<select value={permission} onChange={(event) => setPermission(event.target.value as AgentToken["permission"])}><option value="read">Read configuration</option><option value="write">Manage project</option></select></label>
            <button className="primary-button">Create token</button>
          </form>
          {created?.token && <div className="token-secret"><b>Copy this token now</b><code>{created.token}</code><button onClick={() => navigator.clipboard.writeText(created.token!)}>Copy token</button><small>It cannot be shown again.</small></div>}
          {error && <p className="page-error">{error}</p>}
          <section className="token-list">
            {tokens.map((token) => <article key={token.id}><div><b>{token.name}</b><small>{token.permission === "write" ? "Can manage project" : "Read-only"} · {token.lastUsedAt ? `Used ${new Date(token.lastUsedAt).toLocaleDateString()}` : "Never used"}</small></div><button className="danger" onClick={() => revoke(token)}>Revoke</button></article>)}
          </section>
        </div>
      </aside>
    </div>
  );
}

function ProjectConsole({ project, onClose }: { project: Project; onClose(): void }) {
  const [runs, setRuns] = useState<ProjectRun[]>([]);
  const [bearer, setBearer] = useState("");
  const [prompt, setPrompt] = useState("What tasks are still open?");
  const [toolApprovalMode, setToolApprovalMode] = useState<"auto" | "ask">("ask");
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadRuns() {
    setRuns(await api<ProjectRun[]>(`/api/projects/${project.id}/runs`));
  }

  useEffect(() => {
    void loadRuns().catch((cause) =>
      setError(cause instanceof Error ? cause.message : "Could not load activity"));
  }, []);

  async function run(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(await api<PlaygroundResult>(`/api/projects/${project.id}/playground`, {
        method: "POST",
        body: JSON.stringify({ bearer, prompt, toolApprovalMode }),
      }));
      await loadRuns();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not run the agent");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="project-drawer project-console">
        <header><div><small>{project.name}</small><h2>Test & activity</h2></div><button className="icon-button" onClick={onClose} aria-label="Close">×</button></header>
        <div className="console-body">
          <section className="playground">
            <header><div><span className="eyebrow">Live playground</span><h3>Try a real request</h3></div><p>The bearer is validated and forwarded exactly like it is from your app.</p></header>
            <form onSubmit={run}>
              <label>Customer bearer<input type="password" autoComplete="off" required maxLength={8192} value={bearer} onChange={(event) => setBearer(event.target.value)} placeholder="Bearer token" /></label>
              <label>Tool approvals<select value={toolApprovalMode} onChange={(event) => setToolApprovalMode(event.target.value as "auto" | "ask")}><option value="ask">Ask before tools</option><option value="auto">Approve tools automatically</option></select></label>
              <label>Prompt<textarea required maxLength={4000} rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>
              <button className="primary-button" disabled={busy || project.status !== "ready"}>{busy ? "Running…" : "Run agent"}</button>
            </form>
            {result && <div className="playground-result"><small>{result.pendingTools.length ? "Approval required" : result.status}</small><p>{result.answer || (result.pendingTools.length ? `Waiting for ${result.pendingTools.join(", ")}` : "The agent returned no text.")}</p></div>}
            {error && <p className="page-error">{error}</p>}
          </section>
          <section className="run-activity">
            <header><div><span className="eyebrow">Recent activity</span><h3>Agent runs</h3></div><button onClick={() => void loadRuns()}>Refresh</button></header>
            {runs.length === 0 ? <p className="runs-empty">No agent runs yet.</p> : runs.map((run) => (
              <article key={run.id}>
                <i className={run.status} />
                <div><b>{run.source === "playground" ? "Playground" : "Runtime"} · {run.model}</b><small>{new Date(run.completedAt).toLocaleString()}</small>{run.error && <span>{run.error}</span>}</div>
                <dl><div><dt>Tokens</dt><dd>{run.inputTokens + run.outputTokens}</dd></div><div><dt>Tools</dt><dd>{run.toolCalls}</dd></div></dl>
              </article>
            ))}
          </section>
        </div>
      </aside>
    </div>
  );
}

function AdminBackoffice() {
  const [authorization, setAuthorization] = useState("");
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");

  async function authenticate(event: FormEvent) {
    event.preventDefault();
    try {
      const nextAuthorization = `Basic ${btoa(`${login}:${password}`)}`;
      setRequests(await api<AccessRequest[]>("/api/admin/access-requests", {
        headers: { authorization: nextAuthorization },
      }));
      setAuthorization(nextAuthorization);
      setPassword("");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Login failed");
    }
  }

  async function changeAccess(request: AccessRequest, action: "grant" | "revoke") {
    const rejecting = action === "revoke" && request.status === "pending";
    if (action === "revoke" && !window.confirm(
      `${rejecting ? "Reject the request from" : "Revoke access for"} ${request.email}?`,
    )) return;
    try {
      setBusy(request.id);
      const result = await api<{ emailSent?: boolean }>(`/api/admin/access-requests/${request.id}/${action}`, {
        method: "POST",
        headers: { authorization },
      });
      setRequests(await api<AccessRequest[]>("/api/admin/access-requests", {
        headers: { authorization },
      }));
      setError("");
      setNotice(action === "grant"
        ? result.emailSent
          ? `Access granted and ${request.email} was notified.`
          : `Access granted. Configure Resend to notify ${request.email} by email.`
        : `${rejecting ? "Request rejected" : "Access revoked"} for ${request.email}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change access");
    } finally {
      setBusy(null);
    }
  }

  if (!authorization) return (
    <main className="admin-login">
      <form onSubmit={authenticate}>
        <img src={lemyLogo} alt="Lemy" />
        <span className="eyebrow">Private backoffice</span>
        <h1>Admin login</h1>
        <label>Login<input autoComplete="username" required value={login} onChange={(event) => setLogin(event.target.value)} /></label>
        <label>Password<input autoComplete="current-password" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p className="page-error">{error}</p>}
        <button className="primary-button">Sign in</button>
      </form>
    </main>
  );

  const pending = requests.filter(({ status }) => status === "pending");
  const granted = requests.filter(({ status }) => status === "granted");
  return (
    <main className="admin-page">
      <nav><div className="cloud-brand"><img src={lemyLogo} alt="Lemy" /><span>Admin</span></div><button onClick={() => setAuthorization("")}>Sign out</button></nav>
      <section>
        <header><span className="eyebrow">Invite-only Cloud</span><h1>Access</h1><p>Approve requested emails before their matching Google or GitHub account can enter Lemy Cloud.</p></header>
        {notice && <p className="page-success">{notice}</p>}
        {error && <p className="page-error">{error}</p>}
        <div className="admin-columns">
          <div><h2>Pending <span>{pending.length}</span></h2>{pending.length === 0 ? <p className="admin-empty">No pending requests.</p> : pending.map((request) => <article key={request.id}><div><b>{request.email}</b><small>Requested {new Date(request.requestedAt).toLocaleDateString()}</small></div><span className="admin-actions"><button className="danger" disabled={busy !== null} onClick={() => changeAccess(request, "revoke")}>Reject</button><button className="primary-button" disabled={busy !== null} onClick={() => changeAccess(request, "grant")}>{busy === request.id ? "Saving…" : "Accept"}</button></span></article>)}</div>
          <div><h2>Granted <span>{granted.length}</span></h2>{granted.length === 0 ? <p className="admin-empty">No granted access.</p> : granted.map((request) => <article key={request.id}><div><b>{request.email}</b><small>Cloud access active</small></div><button className="danger" disabled={busy !== null} onClick={() => changeAccess(request, "revoke")}>{busy === request.id ? "Saving…" : "Revoke"}</button></article>)}</div>
        </div>
      </section>
    </main>
  );
}

function ProjectForm({
  models,
  project,
  onClose,
  onSaved,
}: {
  models: LlmModel[];
  project: Project | null;
  onClose(): void;
  onSaved(project: Project): void;
}) {
  const [draft, setDraft] = useState<ProjectDraft>(() =>
    project
      ? {
          name: project.name,
          openapiSchemaUrl: project.openapiSchemaUrl,
          openapiBaseUrl: project.openapiBaseUrl ?? "",
          bearerValidationUrl: project.bearerValidationUrl,
          corsOrigins: project.corsOrigins.join(", "),
          allowMutations: project.allowMutations,
          llmProvider: models.some(({ provider }) => provider === project.llmProvider)
            ? project.llmProvider
            : models[0]?.provider ?? "openai",
          llmModel: models.some(({ provider, model }) =>
            provider === project.llmProvider && model === project.llmModel)
            ? project.llmModel
            : models[0]?.model ?? "",
          skills: project.skills,
        }
      : {
          ...emptyDraft,
          llmProvider: models[0]?.provider ?? "openai",
          llmModel: models[0]?.model ?? "",
        },
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const providers = [...new Set(models.map(({ provider }) => provider))];

  function change<K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function changeProvider(provider: LlmProvider) {
    setDraft((current) => ({
      ...current,
      llmProvider: provider,
      llmModel: models.find((model) => model.provider === provider)?.model ?? "",
    }));
  }

  function addSkill() {
    change("skills", [...draft.skills, { name: "", description: "", instructions: "" }]);
  }

  function changeSkill(index: number, key: keyof AgentSkill, value: string) {
    change("skills", draft.skills.map((skill, current) => current === index ? { ...skill, [key]: value } : skill));
  }

  function removeSkill(index: number) {
    change("skills", draft.skills.filter((_, current) => current !== index));
  }

  async function importSkills(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    try {
      const imported = await Promise.all([...files].map(async (file) => {
        try {
          return parseSkillMarkdown(await file.text());
        } catch (cause) {
          throw new Error(`${file.name}: ${cause instanceof Error ? cause.message : "Invalid SKILL.md"}`);
        }
      }));
      const nextSkills = [...draft.skills, ...imported];
      if (nextSkills.length > 16) throw new Error("A project can contain at most 16 skills");
      if (new Set(nextSkills.map(({ name }) => name)).size !== nextSkills.length) {
        throw new Error("Skill names must be unique");
      }
      change("skills", nextSkills);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import SKILL.md");
    }
  }

  function exportSkill(skill: AgentSkill) {
    setError("");
    try {
      const url = URL.createObjectURL(new Blob([formatSkillMarkdown(skill)], { type: "text/markdown" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "SKILL.md";
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export SKILL.md");
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const saved = await api<Project>(project ? `/api/projects/${project.id}` : "/api/projects", {
        method: project ? "PUT" : "POST",
        body: JSON.stringify({
          ...draft,
          corsOrigins: draft.corsOrigins.split(",").map((origin) => origin.trim()).filter(Boolean),
          openapiBaseUrl: draft.openapiBaseUrl || null,
        }),
      });
      onSaved(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save project");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="project-drawer" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><small>{project ? "Project settings" : "New project"}</small><h2>{project ? project.name : "Connect an API"}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <form onSubmit={save}>
          <fieldset>
            <legend>API</legend>
            <label>Project name<input required maxLength={80} value={draft.name} onChange={(event) => change("name", event.target.value)} placeholder="Tasks production" /></label>
            <label>OpenAPI schema URL<input required type="url" value={draft.openapiSchemaUrl} onChange={(event) => change("openapiSchemaUrl", event.target.value)} placeholder="https://api.example.com/openapi.json" /></label>
            <label>API base URL <span>optional when declared by the schema</span><input type="url" value={draft.openapiBaseUrl} onChange={(event) => change("openapiBaseUrl", event.target.value)} placeholder="https://api.example.com" /></label>
            <label>Bearer validation URL<input required type="url" value={draft.bearerValidationUrl} onChange={(event) => change("bearerValidationUrl", event.target.value)} placeholder="https://api.example.com/me" /></label>
            <label>Allowed app origins <span>comma-separated</span><input required value={draft.corsOrigins} onChange={(event) => change("corsOrigins", event.target.value)} placeholder="https://app.example.com" /></label>
            <label className="check-label"><input type="checkbox" checked={draft.allowMutations} onChange={(event) => change("allowMutations", event.target.checked)} /><span><b>Allow mutations</b><small>Let the agent use POST, PUT, PATCH and DELETE operations.</small></span></label>
          </fieldset>
          <fieldset>
            <legend>Model</legend>
            <label>Provider<select required value={draft.llmProvider} onChange={(event) => changeProvider(event.target.value as LlmProvider)}>{providers.map((provider) => <option key={provider} value={provider}>{provider === "openai" ? "OpenAI" : "Anthropic"}</option>)}</select></label>
            <label>Model<select required value={draft.llmModel} onChange={(event) => change("llmModel", event.target.value)}>{models.filter((model) => model.provider === draft.llmProvider).map((model) => <option key={model.model} value={model.model}>{model.label}</option>)}</select></label>
            <small>{models.length
              ? "Only models from validated workspace providers are available."
              : "Validate an OpenAI or Anthropic key before configuring a project."}</small>
          </fieldset>
          <fieldset className="skills-fieldset">
            <legend>Agent skills</legend>
            <div className="skills-heading">
              <p>Portable instructions loaded only when a request matches. Import a standard Agent Skills file or write one here.</p>
              <div className="skills-actions">
                <label className="secondary-button file-button">Import SKILL.md<input aria-label="Import SKILL.md" type="file" accept=".md,text/markdown" multiple onChange={(event) => { void importSkills(event.target.files); event.target.value = ""; }} /></label>
                <button type="button" className="secondary-button" onClick={addSkill} disabled={draft.skills.length >= 16}>New skill</button>
              </div>
            </div>
            <div className="skills-list">
              {draft.skills.length === 0 ? <p className="skills-empty">No project skills configured.</p> : draft.skills.map((skill, index) => (
                <article className="skill-editor" key={index}>
                  <header><strong>{skill.name || `Skill ${index + 1}`}</strong><div>{skill.name && skill.description && skill.instructions && <button type="button" onClick={() => exportSkill(skill)}>Export</button>}<button className="danger" type="button" onClick={() => removeSkill(index)} aria-label={`Remove ${skill.name || `skill ${index + 1}`}`}>Remove</button></div></header>
                  <label>Name <span>lowercase letters, numbers, and hyphens</span><input required maxLength={64} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={skill.name} onChange={(event) => changeSkill(index, "name", event.target.value)} placeholder="task-triage" /></label>
                  <label>Description <span>what it does and when to use it</span><textarea required maxLength={1024} rows={3} value={skill.description} onChange={(event) => changeSkill(index, "description", event.target.value)} placeholder="Use when reviewing or prioritizing tasks." /></label>
                  <label>Instructions <span>Markdown, loaded on demand</span><textarea required maxLength={20000} rows={7} value={skill.instructions} onChange={(event) => changeSkill(index, "instructions", event.target.value)} placeholder="Check overdue tasks first, then…" /></label>
                </article>
              ))}
            </div>
          </fieldset>
          {error && <p className="form-error">{error}</p>}
          <footer><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving || models.length === 0}>{saving ? "Saving…" : project ? "Save & restart" : "Create project"}</button></footer>
        </form>
      </aside>
    </div>
  );
}

function McpManager({ project, onClose, onChanged }: {
  project: Project;
  onClose(): void;
  onChanged(): void;
}) {
  const [mcps, setMcps] = useState<ExternalMcp[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState<ExternalMcp["authType"]>("oauth");
  const [bearers, setBearers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setMcps(await api<ExternalMcp[]>(`/api/projects/${project.id}/mcps`));
  }

  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load MCPs")); }, []);

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy("new");
    setError("");
    try {
      const mcp = await api<ExternalMcp>(`/api/projects/${project.id}/mcps`, {
        method: "POST",
        body: JSON.stringify({ name, url, authType }),
      });
      setMcps((current) => [...current, mcp]);
      setName("");
      setUrl("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add MCP");
    } finally {
      setBusy(null);
    }
  }

  async function connect(mcp: ExternalMcp) {
    setBusy(mcp.id);
    setError("");
    try {
      const result = await api<ExternalMcp | { authorizationUrl: string }>(
        `/api/projects/${project.id}/mcps/${mcp.id}/connect`,
        {
          method: "POST",
          body: JSON.stringify(mcp.authType === "bearer" ? { bearer: bearers[mcp.id] ?? "" } : {}),
        },
      );
      if ("authorizationUrl" in result) {
        window.location.assign(result.authorizationUrl);
        return;
      }
      setMcps((current) => current.map((item) => item.id === result.id ? result : item));
      setBearers((current) => ({ ...current, [mcp.id]: "" }));
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not connect MCP");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(mcp: ExternalMcp) {
    setBusy(mcp.id);
    setError("");
    try {
      const result = await api<ExternalMcp>(`/api/projects/${project.id}/mcps/${mcp.id}/disconnect`, { method: "POST" });
      setMcps((current) => current.map((item) => item.id === result.id ? result : item));
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disconnect MCP");
    } finally {
      setBusy(null);
    }
  }

  async function remove(mcp: ExternalMcp) {
    setBusy(mcp.id);
    setError("");
    try {
      await api(`/api/projects/${project.id}/mcps/${mcp.id}`, { method: "DELETE" });
      setMcps((current) => current.filter(({ id }) => id !== mcp.id));
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete MCP");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="project-drawer mcp-drawer" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><small>Project tools</small><h2>External MCPs</h2></div><button className="icon-button" onClick={onClose} aria-label="Close">×</button></header>
        <div className="mcp-content">
          <form className="mcp-add" onSubmit={add}>
            <fieldset>
              <legend>Add a remote MCP</legend>
              <label>Name<input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="GitHub" /></label>
              <label>Authentication<select value={authType} onChange={(event) => setAuthType(event.target.value as ExternalMcp["authType"])}><option value="oauth">OAuth 2.1</option><option value="bearer">Bearer</option></select></label>
              <label>Streamable HTTP URL<input required type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://mcp.example.com/mcp" /></label>
              <button className="primary-button" disabled={busy !== null}>{busy === "new" ? "Adding…" : "Add MCP"}</button>
            </fieldset>
          </form>
          {error && <p className="form-error">{error}</p>}
          <section className="mcp-list">
            {mcps.length === 0 ? <p className="mcp-empty">No external MCPs configured.</p> : mcps.map((mcp) => (
              <article key={mcp.id}>
                <header><div><h3>{mcp.name}</h3><p>{new URL(mcp.url).hostname} · {mcp.authType === "oauth" ? "OAuth 2.1" : "Bearer"}</p></div><span className={`mcp-state ${mcp.connected ? "connected" : ""}`}>{mcp.connected ? "Connected" : "Disconnected"}</span></header>
                {!mcp.connected && mcp.authType === "bearer" && <input type="password" autoComplete="off" value={bearers[mcp.id] ?? ""} onChange={(event) => setBearers((current) => ({ ...current, [mcp.id]: event.target.value }))} placeholder="Bearer token" />}
                <footer>
                  {mcp.connected ? <button onClick={() => disconnect(mcp)} disabled={busy !== null}>Disconnect</button> : <button className="primary-button" onClick={() => connect(mcp)} disabled={busy !== null || (mcp.authType === "bearer" && !bearers[mcp.id])}>{mcp.authType === "oauth" ? "Connect with OAuth" : "Connect"}</button>}
                  <button className="danger" onClick={() => remove(mcp)} disabled={busy !== null}>Delete</button>
                </footer>
              </article>
            ))}
          </section>
        </div>
      </aside>
    </div>
  );
}

function ProviderSettings({ catalog, onChanged }: {
  catalog: ProviderCatalog;
  onChanged(): Promise<void> | void;
}) {
  const [keys, setKeys] = useState<Record<LlmProvider, string>>({ openai: "", anthropic: "" });
  const [busy, setBusy] = useState<LlmProvider | null>(null);
  const [error, setError] = useState("");

  async function configure(event: FormEvent, provider: LlmProvider) {
    event.preventDefault();
    setBusy(provider);
    setError("");
    try {
      await api(`/api/providers/${provider}`, {
        method: "PUT",
        body: JSON.stringify({ apiKey: keys[provider] }),
      });
      setKeys((current) => ({ ...current, [provider]: "" }));
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not validate the API key");
    } finally {
      setBusy(null);
    }
  }

  async function validate(provider: LlmProvider) {
    setBusy(provider);
    setError("");
    try {
      await api(`/api/providers/${provider}/validate`, { method: "POST" });
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not refresh validation");
      await onChanged();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="provider-settings">
      <header>
        <div><span className="eyebrow">Workspace models</span><h2>Your providers</h2></div>
        <p>Keys are validated with the provider, encrypted at rest, and shared across your projects.</p>
      </header>
      <div className="provider-grid">
        {catalog.providers.map((configuration) => {
          const name = configuration.provider === "openai" ? "OpenAI" : "Anthropic";
          return (
            <article className={`provider-card ${configuration.status}`} key={configuration.provider}>
              <header>
                <div className="provider-mark">{configuration.provider === "openai" ? "◎" : "A"}</div>
                <div><h3>{name}</h3><span>{configuration.status === "validated" ? "Available" : configuration.status === "invalid" ? "Needs attention" : "Not connected"}</span></div>
                <i />
              </header>
              <p>{configuration.status === "validated" && configuration.validatedAt
                ? `Validated ${new Date(configuration.validatedAt).toLocaleDateString()}`
                : configuration.status === "invalid"
                  ? "The saved key was rejected. Replace it to restore project access."
                  : `Add an ${name} API key to unlock its models.`}</p>
              <form onSubmit={(event) => configure(event, configuration.provider)}>
                <input
                  aria-label={`${name} API key`}
                  type="password"
                  autoComplete="new-password"
                  maxLength={512}
                  required
                  value={keys[configuration.provider]}
                  onChange={(event) => setKeys((current) => ({
                    ...current,
                    [configuration.provider]: event.target.value,
                  }))}
                  placeholder={configuration.configured ? "Paste a replacement key" : "Paste API key"}
                />
                <button className="primary-button" disabled={busy !== null}>
                  {busy === configuration.provider ? "Checking…" : configuration.configured ? "Replace" : "Activate"}
                </button>
              </form>
              {configuration.configured && <button className="provider-refresh" onClick={() => validate(configuration.provider)} disabled={busy !== null}>Refresh validation</button>}
            </article>
          );
        })}
      </div>
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}

function Dashboard({ user, local }: { user: SessionData["user"]; local: boolean }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [catalog, setCatalog] = useState<ProviderCatalog | null>(null);
  const [usage, setUsage] = useState<CloudUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<Project | "new" | null>(null);
  const [mcpProject, setMcpProject] = useState<Project | null>(null);
  const [automationProject, setAutomationProject] = useState<Project | null>(null);
  const [consoleProject, setConsoleProject] = useState<Project | null>(null);
  const [error, setError] = useState("");
  const [notice] = useState(() => new URLSearchParams(window.location.search));
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    try {
      const [nextProjects, nextCatalog, nextUsage] = await Promise.all([
        api<Project[]>("/api/projects"),
        api<ProviderCatalog>("/api/providers"),
        api<CloudUsage>("/api/usage"),
      ]);
      setProjects(nextProjects);
      setCatalog(nextCatalog);
      setUsage(nextUsage);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load projects");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    if (notice.size) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const hasProvisioningProject = projects.some(({ status }) => status === "provisioning");
  useEffect(() => {
    if (!hasProvisioningProject) return;
    const timer = window.setInterval(() => void load(), 2_000);
    return () => window.clearInterval(timer);
  }, [hasProvisioningProject]);

  async function remove(project: Project) {
    if (!window.confirm(`Delete ${project.name}? Its runtime and configuration will be removed.`)) return;
    try {
      await api(`/api/projects/${project.id}`, { method: "DELETE" });
      setProjects((current) => current.filter(({ id }) => id !== project.id));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete project");
    }
  }

  async function restart(project: Project) {
    try {
      const updated = await api<Project>(`/api/projects/${project.id}/restart`, { method: "POST" });
      setProjects((current) => current.map((item) => item.id === updated.id ? updated : item));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not restart project");
    }
  }

  async function copyRuntime(project: Project) {
    await navigator.clipboard.writeText(new URL(project.runtimePath, window.location.origin).toString());
    setCopied(project.id);
    window.setTimeout(() => setCopied(null), 1_500);
  }

  return (
    <main className="dashboard">
      <nav className="cloud-nav">
        <div className="cloud-brand"><img src={lemyLogo} alt="Lemy" /><span>Cloud</span></div>
        <div className="nav-context"><small>Workspace</small><b>Agent operations</b></div>
        <div className="account-menu"><div>{user.image ? <img src={user.image} alt="" /> : user.name.slice(0, 1).toUpperCase()}</div><span><b>{user.name}</b><small>{user.email}</small></span>{local ? <small>Local mode</small> : <button onClick={async () => { await authClient.signOut(); window.location.reload(); }}>Sign out</button>}</div>
      </nav>
      <section className="dashboard-body">
        <header className="dashboard-heading"><div><span className="eyebrow">Your workspace</span><h1>Agent runtimes</h1><p>Operate every API agent, model and tool connection from one place.</p></div><button className="primary-button" disabled={!catalog?.models.length} onClick={() => setEditor("new")}><b>+</b> Create project</button></header>
        {usage && <section className="cloud-usage"><div><span>Workspace Code Mode usage · {usage.month}</span><b>{usage.used.toLocaleString()} <small>/ {usage.limit.toLocaleString()}</small></b></div><progress value={usage.used} max={usage.limit} /><small>Resets monthly.</small></section>}
        <div className="architecture-strip"><span><i>01</i> Your app</span><b>→</b><span><i>02</i> Identity + agent</span><b>→</b><span><i>03</i> MCP tools</span><b>→</b><span><i>04</i> Your API</span></div>
        {catalog && <ProviderSettings catalog={catalog} onChanged={load} />}
        {notice.get("mcp") === "connected" && <p className="page-success">External MCP connected.</p>}
        {notice.get("mcp") === "error" && <p className="page-error">The external MCP OAuth connection failed.</p>}
        {error && <p className="page-error">{error}</p>}
        {loading ? <div className="empty-state">Loading your projects…</div> : projects.length === 0 ? (
          <div className="empty-state"><span>+</span><h2>Connect your first API</h2><p>{catalog?.models.length ? "Bring an OpenAPI URL and a bearer validation endpoint." : "Activate a model provider above, then connect your API."}</p><button className="primary-button" disabled={!catalog?.models.length} onClick={() => setEditor("new")}>Create a project</button></div>
        ) : (
          <div className="project-grid">
            {projects.map((project) => (
              <article className="project-card" key={project.id}>
                <header><div className="project-icon">{project.name.slice(0, 1).toUpperCase()}</div><div><h2>{project.name}</h2><Status value={project.status} /></div></header>
                <dl><div><dt>OpenAPI</dt><dd>{new URL(project.openapiSchemaUrl).hostname}</dd></div><div><dt>Model</dt><dd>{project.llmProvider} · {project.llmModel}</dd></div><div><dt>Skills</dt><dd>{project.skills.length || "None"}</dd></div></dl>
                {catalog?.providers.find(({ provider }) => provider === project.llmProvider)?.status !== "validated" && <p className="project-error">Reconnect {project.llmProvider === "openai" ? "OpenAI" : "Anthropic"} before this runtime can accept sessions.</p>}
                {project.lastError && <p className="project-error">{project.lastError}</p>}
                <div className="runtime-url"><span>Runtime URL</span><code>{project.runtimePath}</code><button onClick={() => copyRuntime(project)}>{copied === project.id ? "Copied" : "Copy"}</button></div>
                <footer><button className="project-action" disabled={project.status !== "ready"} onClick={() => setConsoleProject(project)}>Test & activity</button><button onClick={() => setMcpProject(project)}>MCPs</button><button onClick={() => setAutomationProject(project)}>Agent access</button><button onClick={() => restart(project)}>Restart</button><button onClick={() => setEditor(project)}>Settings</button><span>Updated {new Date(project.updatedAt).toLocaleDateString()}</span><button className="danger" onClick={() => remove(project)}>Delete</button></footer>
              </article>
            ))}
          </div>
        )}
      </section>
      {editor && <ProjectForm models={catalog?.models ?? []} project={editor === "new" ? null : editor} onClose={() => setEditor(null)} onSaved={(saved) => { setProjects((current) => { const exists = current.some(({ id }) => id === saved.id); return exists ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current]; }); setEditor(null); }} />}
      {mcpProject && <McpManager project={mcpProject} onClose={() => setMcpProject(null)} onChanged={() => void load()} />}
      {automationProject && <ProjectAutomation project={automationProject} onClose={() => setAutomationProject(null)} />}
      {consoleProject && <ProjectConsole project={consoleProject} onClose={() => setConsoleProject(null)} />}
    </main>
  );
}

function CloudApp() {
  const [data, setData] = useState<SessionData | null>();
  useEffect(() => {
    void api<SessionData | null>("/api/session").then(setData).catch(() => setData(null));
  }, []);
  if (data === undefined) return <main className="splash"><img src={lemyLogo} alt="Lemy" /></main>;
  if (!data?.user) return <Login />;
  if (!data.access.granted) return <PendingAccess user={data.user} />;
  return <Dashboard
    user={data.user}
    local={data.session.id === "local-dev-session"}
  />;
}

export function App() {
  if (window.location.pathname === "/admin") return <AdminBackoffice />;
  if (window.location.pathname === "/privacy") return <Privacy />;
  return <CloudApp />;
}
