# Follow-Through demo runbook

This runbook brings up the Agentic/MCP backend, publishes its MCP endpoints,
provisions the Corti agents, and performs controlled smoke requests. Every
patient, quote, interaction, and task in this flow is synthetic.

## Safety and cost guardrails

- Use only `synthetic-karen`; never paste real patient or clinician data.
- Keep `.env` local. Never put application, MCP, Corti, HMAC, or ngrok secrets
  in Git, browser code, screenshots, logs, or chat.
- Run `npm run smoke:corti` exactly once after the configuration checks pass.
  It makes one `POST /api/signals` request, has no retry loop, and prints only
  `contextId`, `taskId`, `state`, and `credits`.
- Run `npm run smoke:handover` exactly once after all three handover services
  are healthy. It makes one public handover POST, has no retry loop, and prints
  only `handoverId`, `patientId`, `status`, and `sourceSnapshotHash`.
- Agent provisioning and either live smoke request consume Corti resources.
  Automated tests never provision agents and never make live Corti calls.
- The system tracks follow-through tasks; it does not make clinical decisions.
  **“No open tracked follow-through items” does not mean discharge readiness.**

## 0. Install and verify locally without Corti calls

Run the complete offline gate before provisioning or sending a live request:

```bash
npm install
npm --prefix apps/corti-pipeline install
npm --prefix apps/integration-api install
npm run check
npm --prefix apps/corti-pipeline run typecheck
npm --prefix apps/corti-pipeline test
npm --prefix apps/integration-api run typecheck
npm --prefix apps/integration-api test
```

These commands use only local fakes and synthetic fixtures. They must not need
Corti credentials or spend project credit.

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
`CORTI_ENVIRONMENT`. Leave both `CORTI_AGENT_ID` and
`CORTI_HANDOVER_AGENT_ID` empty for the first start. Keep `DEMO_MODE=true`,
`PORT=3000`, and the synthetic SQLite database path for the demo. Set
`NGROK_AUTHTOKEN` locally.

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
Copy that exact HTTPS URL into `MCP_PUBLIC_URL` in `.env`. The same tunnel also
exposes the dedicated handover MCP at
`https://example.ngrok.app/mcp/handover`. Leave `HANDOVER_MCP_PUBLIC_URL` empty
to derive that URL automatically, or set it explicitly to the handover URL.
Leave terminals A and B running. Both `/mcp` and `/mcp/handover` require the
same server-side `MCP_BEARER_TOKEN`.

## 3. Provision, restart, then smoke exactly once

In terminal C, provision the Corti agent once:

```bash
cd /Users/solvisantos/.config/superpowers/worktrees/hackathon-kit/agentic-mcp
npm run agent:provision
```

The command creates or updates both dedicated agents in one manual operation.
Copy the returned task-agent ID into `CORTI_AGENT_ID` and the returned handover
agent ID into `CORTI_HANDOVER_AGENT_ID` in the untracked `.env`. Do not rerun
provisioning automatically. Stop terminal A with Ctrl-C and restart it so the
backend constructs both live Corti gateways:

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

## 4. Pipeline, profile, mock EHR, integration API, and UI handoff

The browser must talk to the integration API, never directly to the Agentic
backend with `APP_BEARER_TOKEN`. Configure and start the four server-side apps:

```bash
cd /Users/solvisantos/.config/superpowers/worktrees/hackathon-kit/agentic-mcp/apps/corti-pipeline
cp .env.example .env
npm install
npm run dev
```

```bash
cd /Users/solvisantos/.config/superpowers/worktrees/hackathon-kit/agentic-mcp/apps/patient-profile
cp .env.example .env
npm install
npm run dev
```

```bash
cd /Users/solvisantos/.config/superpowers/worktrees/hackathon-kit/agentic-mcp/apps/downstream-gateway
cp .env.example .env
npm install
npm run dev
```

```bash
cd /Users/solvisantos/.config/superpowers/worktrees/hackathon-kit/agentic-mcp/apps/mock-ehr
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
`PIPELINE_BASE_URL=http://127.0.0.1:8787`,
`PATIENT_PROFILE_BASE_URL=http://127.0.0.1:8791`, and
`DOWNSTREAM_BASE_URL=http://127.0.0.1:8792`, and
`MOCK_EHR_BASE_URL=http://127.0.0.1:8793`. Set `AGENTIC_APP_BEARER_TOKEN` to
the backend's `APP_BEARER_TOKEN`, and set the profile/downstream/mock-EHR bearer
values to their matching private service tokens. Generate a separate
`INTEGRATION_API_BEARER_TOKEN` of at least eight characters for callers of the
public handover endpoint; never reuse `AGENTIC_APP_BEARER_TOKEN`. Add the actual
Lovable preview origin to `UI_ORIGINS`; do not use a wildcard.

Keep `UPSTREAM_TIMEOUT_MS=8000` for ordinary service calls and
`HANDOVER_UPSTREAM_TIMEOUT_MS=600000` for live handover generation. A draft may
run two Corti agent phases, and each phase allows up to 60 seconds for the SDK
send plus 180 seconds for polling (480 seconds total worst case). The ten-minute
integration timeout leaves headroom for that work and the Corti Text Generation
render; handover finalization still uses the ordinary timeout.

Confirm the handover path is ready before spending credit:

```bash
curl --fail http://127.0.0.1:3000/healthz
curl --fail http://127.0.0.1:8787/health
curl --fail http://127.0.0.1:8791/healthz
curl --fail http://127.0.0.1:8792/healthz
curl --fail http://127.0.0.1:8793/healthz
curl --fail http://127.0.0.1:8790/readyz
```

The pipeline health response must report `cortiConfigured: true`, and the
integration readiness response must report `liveCortiReady: true`. Then make
exactly one attributed public request:

```bash
HANDOVER_PATIENT_ID=synthetic-karen \
HANDOVER_ACTOR_ID=clinician:demo \
INTEGRATION_API_BASE_URL=http://127.0.0.1:8790 \
INTEGRATION_API_BEARER_TOKEN=replace-with-public-handover-token \
npm run smoke:handover
```

The helper sends exactly one
`POST /api/patients/synthetic-karen/handovers`. It prints only four identifiers
and status fields; it never prints the canonical packet, patient prose,
prompts, tokens, or the full HTTP response. It refuses to run without the
dedicated inbound bearer and has no retry loop. If the call
fails, note the HTTP status, inspect the three server logs and Corti console,
and decide manually whether to use a new idempotency key. Do not rerun the
command blindly.

The UI checkout is
`/Users/solvisantos/corti-hackathon-2026-research/ward-companion`. Its adapter
should read `GET http://127.0.0.1:8790/api/patients/synthetic-karen/companion`,
send task commands to `POST /api/tasks/:taskId/:command`, and refresh from
`GET /api/events/stream`. It must render the empty state as **“No open tracked
follow-through items”**, never “clear for discharge” or “ready for discharge.”

For the Nervecentre surface, read `GET /api/ehr/patients/:patientId`, apply
patient edits through `PATCH /api/ehr/patients/:patientId/profile`, and use the
`/api/ehr/documents/*` draft/revise/file routes. Create immutable referral
snapshots through the Integration API and include `referralSnapshotId` when
approving the matching referral task. Read delivery state from
`GET /api/tasks/:taskId/deliveries`. Do not call profile, downstream, or mock-EHR
services directly from the browser.

## Reset and recovery

- Stop the tunnel with Ctrl-C as soon as the demo is over.
- If provisioning succeeded but the agent configuration needs changing, keep
  the same `CORTI_AGENT_ID` and `CORTI_HANDOVER_AGENT_ID`. Rerun
  `npm run agent:provision`; the script updates rather than duplicates them.
- If a signal fails after retention, use the documented manual-task recovery
  path. Never invent evidence or substitute the signal summary for a quote.
