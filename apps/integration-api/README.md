# Follow-Through integration API

Stateless backend-for-frontend and cross-service handoff layer. It gives the UI
one safe HTTP surface while keeping the Agentic application bearer token on the
server.

It owns no patient, thread, task, approval, or transcript state. The Agentic/MCP
backend remains authoritative for the ledger, and the Corti pipeline remains
authoritative for Ambient, Dictation, Text Generation, and Medical Coding.

## Current endpoints

- `GET /healthz`: process liveness without contacting upstream services.
- `GET /openapi.json`: machine-readable OpenAPI 3.1 contract for consumers.
- `GET /readyz`: aggregate Agentic and pipeline reachability and report whether
  live Corti calls are configured.
- `POST /api/candidates/investigate`: validate a normalized pipeline candidate
  and retain it as one idempotent Agentic signal. Each validated evidence item
  is forwarded with its generated reference, exact quote, timestamps, and
  optional speaker ID so the Agentic backend can register grounded evidence.
- `POST /api/corti/...`: explicit allow-listed proxy for the seven existing
  pipeline endpoints, preserving their request and response contracts.
- `GET /api/patients/:patientId/overview`: return authoritative threads and
  tasks from the Agentic backend.
- `GET /api/patients/:patientId/companion`: map those authoritative records
  into the current Ward Companion `Thread` read model without coupling the
  backend to the UI component tree.
- `GET /api/events/stream`: proxy the Agentic SSE stream while keeping the
  application bearer token server-side; supports `Last-Event-ID` resume.
- `POST /api/tasks/:taskId/:command`: validate and forward the documented task
  commands with actor attribution. Supported commands are `approve`, `correct`,
  `dismiss`, `reopen`, `accept`, `decline`, `complete`, and `verify`.

Every response includes `x-correlation-id`. Browser requests are allowed only
from configured origins. The service binds to loopback by default.

Synthetic consumer examples live in [`fixtures/`](fixtures/). UI work can build
against those examples and replace only its adapter when the live services are
available.

## Ward Companion boundary

The companion projection matches the existing UI fields (`id`, `title`,
`status`, `heard`, `matters`, `suggestion`, `assignee`, `candidates`, `due`, and
`activity`) and adds a `backend` object containing canonical Agentic IDs,
versions, states, evidence references, and currently valid commands.

The projection is intentionally conservative:

- `completed` remains `tracking` until an independent `verify` command succeeds;
- dismissed records are omitted instead of being presented as verified;
- team availability is not invented, so `candidates` remains empty until an
  authoritative roster endpoint exists;
- patient demographics, beds, bays, schedules, staff rosters, and case notes
  remain EHR/UI inputs rather than synthetic backend state.

## Local run

```bash
cp .env.example .env
npm install
npm test
npm run dev
```

Use the same `AGENTIC_APP_BEARER_TOKEN` configured by the Agentic/MCP backend.
Never expose that token to the browser or commit `.env`.

Both `http://127.0.0.1:5173` and `http://localhost:5173` are accepted as local
UI origins by default. Add the deployed or Lovable preview origin explicitly to
`UI_ORIGINS`; wildcard origins are intentionally unsupported.

## Deferred until contracts freeze

- Post-approval Text Generation and Medical Coding orchestration. The current
  approval response does not expose a stable approval identifier in every
  success mode, so this service must not guess or parse one from proof material.
- Mutations for manually created tasks, free-form activity, and case notes.
  Their Agentic/EHR ownership and audit contracts must be defined before the UI
  sends them to a backend.
