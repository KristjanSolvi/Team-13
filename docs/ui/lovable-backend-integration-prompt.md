# Lovable prompt: wire the current UI to the Ward Threads backend

Use this prompt in the `YaldesDev/ward-companion` Lovable project:

---

Keep the existing visual design, navigation, spacing, responsive behavior, and
demo polish. This task is logic/data wiring, not a redesign. Inspect the current
components and data model first, then replace only backend-owned fixture state
with a small typed API adapter.

The browser's only backend is `VITE_INTEGRATION_API_URL`. Never call the
Agentic, Corti pipeline, patient-profile, downstream-gateway, or mock-EHR
services directly. Never add a service bearer, Corti credential, or other
secret to source code, localStorage, or any `VITE_*` variable.

Canonical demo identity:

- `synthetic-karen` is Karen Jensen everywhere.
- Replace the current Arthur Pender display attached to `synthetic-karen` with
  Karen. Never show Arthur's demographics or prose under Karen's backend ID.
- For the selected live patient, use the profile returned by the backend for
  name, identifiers, DOB/pronouns, bed/bay, schedule, waiting-for, home-tomorrow,
  contact, and referral details. Other patients may remain clearly local UI
  fixtures until backend IDs exist for them.

Create a typed adapter for these Integration API routes:

1. `GET /api/ehr/patients/{patientId}` returns the authoritative profile plus
   documents.
2. `PATCH /api/ehr/patients/{patientId}/profile` saves manual edits with
   `{ expectedVersion, idempotencyKey, reason, changes }` and an `x-actor-id`
   such as `clinician:ward-ui`.
3. Document operations are `POST /api/ehr/patients/{patientId}/documents`,
   `PATCH /api/ehr/documents/{documentId}`, `POST
   /api/ehr/documents/{documentId}/file`, and `GET
   /api/ehr/documents/{documentId}/history`.
4. Referral snapshots are `POST` and `GET
   /api/ehr/patients/{patientId}/referral-snapshots`, plus `GET
   /api/ehr/referral-snapshots/{referralId}`. The create body is
   `{ idempotencyKey, referralType, destination, clinicalReason,
   additionalInstructions }`.
5. `GET /api/patients/{patientId}/companion` is authoritative for
   follow-through cards, backend IDs, versions, states, and available commands.
6. Send task actions to `POST /api/tasks/{taskId}/{command}` with the exact
   `expectedVersion`, a stable retry `idempotencyKey`, and `x-actor-id`.
7. Before approving a referral task, create its referral snapshot and include
   the returned `referralId` as `referralSnapshotId` in the approve body. The
   approval response includes the authoritative task and its downstream
   delivery.
8. `GET /api/tasks/{taskId}/deliveries` returns submission/provider status for
   the task. Show submitted, accepted, completed, or rejected honestly; do not
   convert submission/acceptance into verified.
9. Subscribe to `GET /api/events/stream` with SSE. Persist only the last numeric
   event ID, reconnect with `Last-Event-ID`, and refetch the affected patient's
   companion/EHR data after relevant events. While a delivery is non-terminal,
   also poll its delivery endpoint at a modest interval because provider state
   is owned outside the Agentic event stream.

Data and retry rules:

- Generate idempotency keys with `crypto.randomUUID()` and retain the same key
  when retrying the same user action. Generate a new key only for a new intent.
- Do not optimistically invent backend task states. A small saving/pending
  indicator is fine; replace state only from the successful response or refetch.
- On `409`, refetch the current record/version and show a concise conflict
  message instead of overwriting another edit.
- Show safe empty states such as “No open tracked follow-through items.” Never
  infer “ready for discharge” from an empty task list.
- Keep localStorage only for non-authoritative UI preferences or clearly
  labelled fallback fixtures. It must not overwrite a successful backend read.
- Preserve and display useful error/retry states without showing raw internal
  error details or credentials.

Do not wire the authenticated handover or downstream-provider simulation route
directly from the public SPA, because their bearer must stay server-side. Leave
those controls disabled/hidden unless a trusted server-side proxy or real user
authentication is supplied.

Acceptance checks:

- Reloading the page keeps profile/document edits because they come from the
  backend, not component state.
- `synthetic-karen` always renders as Karen Jensen with one consistent profile.
- A referral snapshot remains unchanged after later profile edits and its read
  view shows that the live profile changed.
- Approving the same referral twice with the same retry key shows one task and
  one delivery.
- Provider acceptance remains tracking; only independent completed readback
  eventually produces a verified task after refresh/SSE.
- No private token appears in built JavaScript, browser storage, or network
  requests.

---
