# Follow-Through integration API

Stateless backend-for-frontend and cross-service handoff layer. It gives the UI
one safe HTTP surface while keeping the Agentic application bearer token on the
server.

It owns no patient, thread, task, approval, or transcript state. The Agentic/MCP
backend remains authoritative for the ledger, and the Corti pipeline remains
authoritative for Ambient, Dictation, Text Generation, and Medical Coding.

## Current endpoints

- `GET /healthz`: process liveness without contacting upstream services.
- `GET /readyz`: aggregate Agentic and pipeline reachability and report whether
  live Corti calls are configured.
- `POST /api/candidates/investigate`: validate a normalized pipeline candidate
  and retain it as one idempotent Agentic signal.
- `GET /api/patients/:patientId/overview`: return authoritative threads and
  tasks from the Agentic backend.
- `POST /api/tasks/:taskId/:command`: validate and forward the documented task
  commands with actor attribution. Supported commands are `approve`, `correct`,
  `dismiss`, `reopen`, `accept`, `decline`, `complete`, and `verify`.

Every response includes `x-correlation-id`. Browser requests are allowed only
from configured origins. The service binds to loopback by default.

## Local run

```bash
cp .env.example .env
npm install
npm test
npm run dev
```

Use the same `AGENTIC_APP_BEARER_TOKEN` configured by the Agentic/MCP backend.
Never expose that token to the browser or commit `.env`.

## Deferred until contracts freeze

- SSE proxying and resume semantics.
- Post-approval Text Generation and Medical Coding orchestration. The current
  approval response does not expose a stable approval identifier in every
  success mode, so this service must not guess or parse one from proof material.
- UI-specific projections beyond the authoritative patient overview.
