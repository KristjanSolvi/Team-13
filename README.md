# Ward Threads

Ward Threads connects the Lovable ward overlay to a source-grounded Corti
pipeline and an authoritative Agentic/MCP follow-through ledger. The current
checkpoint is one integrated demo system; fixture EHR data and external task
destinations remain explicitly simulated.

## System boundary

```text
Lovable Ward UI (8080)
  -> Integration API / BFF (8790)
      -> Corti pipeline (8787)
          Ambient + Dictation + Text Generation + Medical Coding
      -> Agentic/MCP service (3000)
          evidence registry + approval proof + task/thread ledger
      -> Patient profile service (8791)
          versioned manual details + immutable referral snapshots
```

The pipeline may propose one source-grounded candidate. It does not assign a
team, create a task, or claim that work happened. Clinician approval and all
task lifecycle mutations belong to the Agentic ledger. Generated documents and
codes run only on approved clinical text and remain drafts for human review.

## First-time configuration

Use Node.js 22 or newer. Install dependencies in the repository root and in
each app directory. Copy each example environment file to its ignored `.env`:

```bash
cp .env.example .env
cp apps/corti-pipeline/.env.example apps/corti-pipeline/.env
cp apps/integration-api/.env.example apps/integration-api/.env
cp apps/patient-profile/.env.example apps/patient-profile/.env
cp apps/ward-companion/.env.example apps/ward-companion/.env
```

- Put the Corti tenant/client credentials in the root and pipeline `.env`
  files. Never place them in the UI environment.
- Make `apps/integration-api/.env` `AGENTIC_APP_BEARER_TOKEN` exactly match the
  root `.env` `APP_BEARER_TOKEN`.
- Use a separate private bearer for `apps/patient-profile/.env`; it must never
  be exposed in a `VITE_*` variable.
- Use long, independent random values for the application bearer, MCP bearer,
  and approval HMAC secret.
- Keep `DEMO_MODE=true` only for the synthetic hackathon demo.

## Run the integrated stack

Start these in separate terminals, in order:

```bash
# 1. Agentic ledger and MCP
npm run dev

# 2. Corti pipeline
cd apps/corti-pipeline
npm run dev

# 3. Patient profile and referral snapshot service
cd apps/patient-profile
npm run dev

# 4. Browser-facing integration API
cd apps/integration-api
npm run dev

# 5. Lovable Ward Threads UI
cd apps/ward-companion
npm run dev
```

Open `http://localhost:8080`, select **Activity**, and confirm the live strip
says **Integration ready**. The service-level readiness check is
`http://127.0.0.1:8790/readyz`; `liveCortiReady` should be `true`.

The focused microphone and model evaluation is documented in
[`apps/corti-pipeline/docs/testing.md`](apps/corti-pipeline/docs/testing.md).

## Verification

Run the suites from their owning directories:

```bash
# Agentic/MCP
npm test
npm run lint

# Corti pipeline
cd apps/corti-pipeline
npm test
npm run typecheck
npm run build

# Integration API
cd apps/integration-api
npm test
npm run typecheck
npm run build

# Patient profiles and referral snapshots
cd apps/patient-profile
npm test
npm run typecheck
npm run build

# Ward UI
cd apps/ward-companion
npm run typecheck
npm run lint
npm run build
```

## Railway deployment

The repository contains Railway configuration for all five services. Deploy
the Lovable Ward UI and browser-facing integration API publicly, keep the Corti
pipeline and patient-profile service on Railway's private network, and expose
only the Agentic `/mcp` service required by Corti. Attach separate persistent
volumes to the Agentic and patient-profile services for their SQLite databases.

Follow [`docs/deployment/railway.md`](docs/deployment/railway.md) for the exact
service roots, variables, bring-up order, and health checks. Do not add
Supabase during the hackathon: the Agentic service owns task/thread state and
the patient-profile service owns its version/audit and referral snapshots.
