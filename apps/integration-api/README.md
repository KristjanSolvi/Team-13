# Follow-Through integration API

Stateless backend-for-frontend and cross-service handoff layer. It gives the UI
one safe HTTP surface while keeping all private service bearer tokens on the
server.

It owns no patient, document, thread, task, approval, or transcript state. The
patient-profile service owns the mutable audited profile, the synthetic
mock-EHR service owns document versions, the Agentic/MCP backend owns the
ledger, and the Corti pipeline owns Ambient, Dictation, Text Generation, and
Medical Coding.

## Current endpoints

- `GET /healthz`: process liveness without contacting upstream services.
- `GET /openapi.json`: machine-readable OpenAPI 3.1 contract for consumers.
- `GET /readyz`: aggregate Agentic, pipeline, patient-profile, and mock-EHR
  reachability and report whether live Corti calls are configured.
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
- `POST /api/patients/:patientId/handovers`: generate or replay one grounded,
  attributable patient handover by coordinating the Agentic draft, dedicated
  Corti renderer, and snapshot-checked finalization.
- `GET /api/events/stream`: proxy the Agentic SSE stream while keeping the
  application bearer token server-side; supports `Last-Event-ID` resume.
- `POST /api/tasks/:taskId/:command`: validate and forward the documented task
  commands with actor attribution. Supported commands are `approve`, `correct`,
  `dismiss`, `reopen`, `accept`, `decline`, `complete`, and `verify`.
- `POST /api/demo/sessions`: create a meeting, discharge-coordination, or ward
  consultation audience session for solo or duo groups.
- `GET /api/demo/sessions/:sessionId`: refresh the host's current audience
  groups and task assignments.
- `POST /api/demo/join/:joinCode`: join from a QR code and receive a rotated,
  participant-scoped credential without exposing the Agentic bearer.
- `POST /api/demo/sessions/:sessionId/assign`: assign an already approved and
  published team task to one eligible participant in the selected group.
- `GET /api/demo/participants/me`: read only the assignments belonging to the
  participant identified by its Bearer token.
- `GET /api/ehr/patients/:patientId`: compose the current versioned profile and
  mock-EHR documents into one Nervecentre-facing record.
- `PATCH /api/ehr/patients/:patientId/profile`: apply an attributed profile
  update using the same optimistic version contract as Ward Companion.
- `POST /api/ehr/patients/:patientId/documents`: create an attributed document
  draft.
- `PATCH /api/ehr/documents/:documentId`: revise an unfiled draft.
- `POST /api/ehr/documents/:documentId/file`: explicitly file the reviewed
  version.
- `GET /api/ehr/documents/:documentId/history`: read immutable version history.

Every response includes `x-correlation-id`. Browser requests are allowed only
from configured origins. The participant credential returned by the join route
belongs in browser session storage and must not appear in URLs or logs. All
service credentials remain server-side. The service binds to loopback by
default.

Synthetic consumer examples live in [`fixtures/`](fixtures/). UI work can build
against those examples and replace only its adapter when the live services are
available.

Request an on-demand handover through the public integration boundary:

```bash
curl --request POST \
  http://127.0.0.1:8790/api/patients/synthetic-karen/handovers \
  --header "authorization: Bearer $INTEGRATION_API_BEARER_TOKEN" \
  --header 'content-type: application/json' \
  --header 'x-actor-id: clinician:demo' \
  --header 'x-correlation-id: handover-demo-1' \
  --data '{
    "idempotencyKey": "handover-demo-001",
    "reason": "on_demand",
    "focus": null
  }'
```

The caller supplies the dedicated inbound `INTEGRATION_API_BEARER_TOKEN`. The
browser never receives or supplies the separate private Agentic service bearer.
A replay returns `200`; a newly generated handover returns `201`.

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
- patient demographics, beds, bays, schedules, and referral details are read
  from the versioned profile; clinical document drafts and filed versions are
  read from the synthetic mock-EHR service;
- staff rosters and unmapped clinical panels remain labelled UI fixtures.

## Local run

```bash
cp .env.example .env
npm install
npm test
npm run dev
```

Generate a dedicated `INTEGRATION_API_BEARER_TOKEN` for inbound handover
requests. Do not reuse it as `AGENTIC_APP_BEARER_TOKEN`, which must match the
Agentic/MCP backend's private application token. Set
`PATIENT_PROFILE_BEARER_TOKEN` and `MOCK_EHR_BEARER_TOKEN` to the matching
private-service values. Never commit `.env`.

Keep ordinary upstream calls on `UPSTREAM_TIMEOUT_MS=8000`. Use
`HANDOVER_UPSTREAM_TIMEOUT_MS=600000` for handover draft generation and Corti
rendering. The draft can contain two Corti agent phases, each allowing up to 60
seconds to send and 180 seconds to poll, so the dedicated value cannot be lower
than 480000 and may be raised to at most 900000. Finalization remains on the
ordinary timeout because it is a local snapshot-checked ledger write.

The local Lovable UI origins on port `8080` and the pipeline harness origins on
port `5173` are accepted by the example configuration. Add the deployed or
Lovable preview origin explicitly to `UI_ORIGINS`; wildcard origins are
intentionally unsupported.

## Next integration slice

- Post-approval Text Generation and Medical Coding orchestration. Agentic now
  returns a stable `taskId`, signed `approvalProof`, and expiry. The BFF must
  still retrieve the exact approved task/version, validate that boundary, call
  the pipeline, and retain the resulting draft artifacts. Approval alone must
  never be presented as publication or downstream action.
- Mutations for manually created tasks and free-form operational activity.
  Their Agentic ownership and audit contracts must be defined before the UI
  sends them to a backend.
