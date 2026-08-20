# Follow-Through demo runbook

This runbook brings up the Agentic/MCP backend, publishes its MCP endpoint,
provisions the Corti agent, and performs one controlled smoke request. Every
patient, quote, interaction, and task in this flow is synthetic.

## Safety and cost guardrails

- Use only `synthetic-karen`; never paste real patient or clinician data.
- Keep `.env` local. Never put application, MCP, Corti, HMAC, or ngrok secrets
  in Git, browser code, screenshots, logs, or chat.
- Run `npm run smoke:corti` exactly once after the configuration checks pass.
  It makes one `POST /api/signals` request, has no retry loop, and prints only
  `contextId`, `taskId`, `state`, and `credits`.
- The system tracks follow-through tasks; it does not make clinical decisions.
  **“No open tracked follow-through items” does not mean discharge readiness.**

## 1. Configure the Agentic/MCP backend

Work from the shared backend checkout:

```bash
cd /Users/solvisantos/.config/superpowers/worktrees/hackathon-kit/agentic-mcp
npm install
cp .env.example .env
```

Set every non-optional value in `.env`. Generate separate random values for
`APP_BEARER_TOKEN`, `MCP_BEARER_TOKEN`, and `APPROVAL_HMAC_SECRET`; the HMAC
secret must contain at least 32 characters. Set the Corti console values in
`CORTI_TENANT_NAME`, `CORTI_CLIENT_ID`, `CORTI_CLIENT_SECRET`, and
`CORTI_ENVIRONMENT`. Leave `CORTI_AGENT_ID` empty for the first start. Keep
`DEMO_MODE=true`, `PORT=3000`, and the synthetic SQLite database path for the
demo. Set `NGROK_AUTHTOKEN` locally.

Build before using any paid service:

```bash
npm run build
npm test
```

## 2. Start the backend and public MCP endpoint

In terminal A:

```bash
cd /Users/solvisantos/.config/superpowers/worktrees/hackathon-kit/agentic-mcp
npm run dev
```

Confirm `http://127.0.0.1:3000/healthz` returns `{"ok":true}`. In terminal B:

```bash
cd /Users/solvisantos/.config/superpowers/worktrees/hackathon-kit/agentic-mcp
npm run tunnel
```

The tunnel command prints one value such as `https://example.ngrok.app/mcp`.
Copy that exact HTTPS URL into `MCP_PUBLIC_URL` in `.env`. Leave terminals A
and B running. The `/mcp` endpoint still requires `MCP_BEARER_TOKEN`.

## 3. Provision, restart, then smoke exactly once

In terminal C, provision the Corti agent once:

```bash
cd /Users/solvisantos/.config/superpowers/worktrees/hackathon-kit/agentic-mcp
npm run agent:provision
```

Copy the returned `agentId` into `CORTI_AGENT_ID` in `.env`. Stop terminal A
with Ctrl-C and restart it so the backend constructs the live Corti gateway:

```bash
cd /Users/solvisantos/.config/superpowers/worktrees/hackathon-kit/agentic-mcp
npm run dev
```

After `/healthz` is healthy, make the single paid smoke trigger from terminal C:

```bash
cd /Users/solvisantos/.config/superpowers/worktrees/hackathon-kit/agentic-mcp
npm run smoke:corti
```

Do not rerun automatically on failure. Record the HTTP status and inspect the
backend/Corti console before deciding whether the remaining credit justifies a
manual retry. A successful result contains only the Corti context/task state
and reported credits; inspect the local task ledger through the integration API.

## 4. Pipeline, integration API, and UI handoff

The browser must talk to the integration API, never directly to the Agentic
backend with `APP_BEARER_TOKEN`. Configure and start the two server-side apps:

```bash
cd /Users/solvisantos/.config/superpowers/worktrees/hackathon-kit/agentic-mcp/apps/corti-pipeline
cp .env.example .env
npm install
npm run dev
```

```bash
cd /Users/solvisantos/.config/superpowers/worktrees/hackathon-kit/agentic-mcp/apps/integration-api
cp .env.example .env
npm install
npm run dev
```

In `apps/integration-api/.env`, keep `AGENTIC_BASE_URL=http://127.0.0.1:3000`,
`PIPELINE_BASE_URL=http://127.0.0.1:8787`, and set
`AGENTIC_APP_BEARER_TOKEN` to the backend's `APP_BEARER_TOKEN`. Add the actual
Lovable preview origin to `UI_ORIGINS`; do not use a wildcard.

The UI checkout is
`/Users/solvisantos/corti-hackathon-2026-research/ward-companion`. Its adapter
should read `GET http://127.0.0.1:8790/api/patients/synthetic-karen/companion`,
send task commands to `POST /api/tasks/:taskId/:command`, and refresh from
`GET /api/events/stream`. It must render the empty state as **“No open tracked
follow-through items”**, never “clear for discharge” or “ready for discharge.”

## Reset and recovery

- Stop the tunnel with Ctrl-C as soon as the demo is over.
- If provisioning succeeded but the agent configuration needs changing, keep
  the same `CORTI_AGENT_ID` and rerun `npm run agent:provision`; the script
  updates rather than duplicates it.
- If a signal fails after retention, use the documented manual-task recovery
  path. Never invent evidence or substitute the signal summary for a quote.
