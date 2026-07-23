# Lemy Cloud

The complete Lemy control plane and Cloudflare Think runtime.

## Architecture

- Hono serves authentication, workspace provider configuration, projects, MCP connections, runtime sessions, and the control MCP.
- D1 stores users, projects, encrypted provider and external MCP credentials, project-scoped agent tokens, thread metadata, and recent run metadata.
- One named Think Durable Object stores each project + principal + thread conversation in SQLite.
- Code Mode exposes the project's OpenAPI operations and connected MCP tools to the agent through one sandboxed `execute` tool.
- Worker Loaders execute generated Code Mode programs.
- OpenAI and Anthropic calls run directly inside the Think agent.

No project containers or PostgreSQL service are required.

## Local development

```bash
cp .dev.vars.example .dev.vars
npm run dev
```

- dashboard: http://localhost:3001
- admin backoffice: http://localhost:3001/admin
- Worker API: http://127.0.0.1:8788

`dev:setup` applies every migration to local D1. Open the dashboard and activate OpenAI or Anthropic with a real API key. Local variables bypass login, rate limiting, and public-URL restrictions for loopback targets.

## Deploy

```bash
npx wrangler d1 create lemy-cloud
# Put the returned ID in wrangler.jsonc.
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put PROJECT_SECRETS_KEY
npx wrangler secret put ADMIN_LOGIN
npx wrangler secret put ADMIN_PASSWORD
# Optional access approval emails:
npx wrangler secret put RESEND_API_KEY
npm run deploy
```

`PROJECT_SECRETS_KEY` must be a base64-encoded 32-byte key. Generate it with `openssl rand -base64 32`.

Also configure:

- `BETTER_AUTH_URL` and `PUBLIC_APP_URL` with the deployed HTTPS origin;
- GitHub and Google OAuth client IDs and secrets;
- the GitHub and Google OAuth client secrets;
- `ACCESS_REQUEST_ORIGINS`, as the comma-separated landing-page origins allowed to submit requests.
- `ACCESS_APPROVAL_EMAIL_FROM`, when using Resend approval emails.

Visitors request access with an email on the landing page, limited to three submissions per IP per minute. Sign in to `/admin` with `ADMIN_LOGIN` and `ADMIN_PASSWORD` to accept or revoke that email. When `RESEND_API_KEY` and `ACCESS_APPROVAL_EMAIL_FROM` are configured, accepted users receive the Cloud sign-in link. The Google or GitHub account returning that exact, verified email can then enter Lemy Cloud. Admin credentials are checked only by the Worker and the backoffice keeps them in memory for the current page. Failed credentials are limited to three attempts per IP every five minutes. Serve the deployed app over HTTPS because browser Basic authentication sends the credentials with each backoffice request.

After approval, users add and validate their own OpenAI or Anthropic key in the dashboard. `LEMY_MODEL_CATALOG_JSON` can override the model choices without moving provider credentials into Worker configuration.

## Runtime contract

The public project URL is `/runtime/:projectId`.

1. The React client sends its customer bearer to `POST /runtime/:projectId/session` with a UUID thread ID and approval preferences.
2. The Worker validates the bearer through the project's mandatory validation URL.
3. The Worker returns an encrypted five-minute token and the Think WebSocket path.
4. Every turn reopens the token, reloads project policy and the current workspace provider key, and applies project/principal rate limits.
5. OpenAPI calls reuse the validated customer bearer. External MCP calls use only credentials decrypted inside the proxy.

The browser never receives provider keys, external MCP credentials, or internal control-plane secrets. Provider keys are scoped to their owner, validated against the provider before storage, and encrypted with the same AES-GCM root key used for other project secrets.

Each project includes a dashboard console for a real bearer-authenticated test turn and the latest run status, model, token counts, tool calls, and errors. Prompts, responses, and bearer values are not copied into D1 activity records.

See the repository [README](../../README.md) for the full configuration and client guide.
