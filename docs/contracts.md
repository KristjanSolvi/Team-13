# Follow-Through integration contract v1

This is the MVP contract between the Corti pipeline, integration API, Ward
Companion, and Agentic/MCP backend. All examples use synthetic data.

## Authentication and attribution

- `GET /healthz` is public.
- `POST /api/patients/:patientId/handovers` requires `Authorization: Bearer
  $INTEGRATION_API_BEARER_TOKEN`. This dedicated inbound secret is distinct
  from every service-to-service token.
- Every attributed `/api/*` mutation requires `x-actor-id`.
- Every mutation carries an operation-specific `idempotencyKey`. Retrying the
  same operation must reuse the key.
- MCP requests to `POST`, `GET`, or `DELETE /mcp` require `Authorization:
  Bearer $MCP_BEARER_TOKEN`.
- Browser CORS is allowed only for configured `UI_ORIGINS`; the handover route
  explicitly allows the `Authorization` header.
- Corti, MCP, application, HMAC, and tunnel credentials are server-side only.

Errors use a stable, non-sensitive envelope:

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "Draft changed before approval",
    "retryable": false
  }
}
```

Consumers must tolerate additive fields and reject events whose major
`schemaVersion` is not `"1"`.

## Pipeline signal and evidence boundary

`POST /api/signals` always retains a valid signal before any agent action is
claimed. A synthetic evidence reference is not itself evidence. An
agent-suggested draft can use a reference only after the corresponding exact
source content has been registered in this patient's scoped record.

The current integration gateway forwards every validated evidence item as a
one-to-one `sourceEvidence` entry. This is the evidence-grounded happy path:

```json
{
  "patientId": "synthetic-karen",
  "interactionId": "interaction-karen-1",
  "signalText": "Dizziness needs follow-through",
  "evidenceRefs": ["encounter:candidate-a1b2.1"],
  "sourceEvidence": [
    {
      "evidenceRef": "encounter:candidate-a1b2.1",
      "sourceQuote": "I feel dizzy when I stand up.",
      "startSeconds": 10,
      "endSeconds": 12,
      "speakerId": 1
    }
  ],
  "idempotencyKey": "candidate-a1b2"
}
```

References-only requests remain backward compatible, but are deliberately
blocked from agent investigation. The backend returns `202` without pretending
that `signalText` is an exact quote:

```json
{
  "signalEventId": "event-uuid",
  "status": "retained",
  "investigationStatus": "blocked_missing_source_evidence",
  "recovery": "RESUBMIT_WITH_SOURCE_EVIDENCE_OR_CREATE_MANUAL_TASK",
  "missingEvidenceRefs": ["encounter:candidate-a1b2.1"]
}
```

All `evidenceRefs` must be unique and every reference must have exactly one
source entry. Only a complete set is registered. Reusing a reference with
different source content returns `409 EVIDENCE_CONFLICT`. A complete request
returns:

```json
{
  "signalEventId": "event-uuid",
  "status": "retained",
  "investigationStatus": "ready",
  "recovery": "AGENT_INVESTIGATION_AVAILABLE",
  "evidenceRefs": ["encounter:candidate-a1b2.1"]
}
```

The HTTP boundary registers exact quotes as scoped record items but keeps them
out of signal event payloads. The event contains the candidate summary,
references, and evidence status. Agent publication remains a separate,
clinician-approved operation.

## Clinician commands

`POST /api/tasks/manual` creates a clinician-authored draft through the same
ledger. It is the explicit recovery path when agent investigation is blocked or
misses a task:

```json
{
  "patientId": "synthetic-karen",
  "interactionId": "interaction-karen-1",
  "contextId": "ctx-karen",
  "summary": "Check blood pressure within 48 hours",
  "taskType": "blood-pressure-check",
  "evidenceRefs": ["dictation:manual-1"],
  "targetTeamId": "district-nursing",
  "requiredCapabilities": ["blood-pressure"],
  "clinicalUrgency": "medium",
  "dueInMs": 172800000,
  "idempotencyKey": "manual-karen-001"
}
```

When Corti did not establish a context, an authenticated clinician may omit
`contextId`; the draft stores a null context. This exception does not weaken
patient scoping for MCP tools.

All task commands use `POST /api/tasks/:taskId/:command`:

| Command | Required fields beyond `expectedVersion` and `idempotencyKey` | Result |
| --- | --- | --- |
| `approve` | optional `approvalChannel` | Exact short-lived proof, `approved_not_published`; approval alone does not publish |
| `correct` | at least one supported correction | Updated draft; prior approval is invalid |
| `dismiss` | `reason` | Dismissed draft and thread |
| `reopen` | `dueInMs` | Escalated task re-offered to its team |
| `accept` | none | Accepting team member becomes the owner |
| `decline` | none | Deterministic reassignment or escalation |
| `complete` | `outcomeRef` | Owner-reported completion, still awaiting verification |
| `verify` | `outcomeRef`; actor starts with `downstream:` | Independently verified task and thread |

Example approval request:

```json
{
  "expectedVersion": 1,
  "approvalChannel": "app_one_tap",
  "idempotencyKey": "approve-karen-001"
}
```

The response is intentionally not a published task:

```json
{
  "taskId": "task-uuid",
  "approvalProof": "approval-id.hmac-signature",
  "expiresAt": "2026-08-20T10:10:00.000Z",
  "status": "approved_not_published"
}
```

The Corti agent publishes that exact approved draft with the MCP
`publish_team_task` tool, then verifies authoritative state with `get_task`.

## Grounded on-demand patient handovers

The UI has one public operation through the integration API:

```text
POST /api/patients/:patientId/handovers
Authorization: Bearer $INTEGRATION_API_BEARER_TOKEN
x-actor-id: clinician:demo
x-correlation-id: handover-demo-1
```

```json
{
  "idempotencyKey": "handover-demo-001",
  "reason": "on_demand",
  "focus": null
}
```

The inbound bearer is checked before body validation, attribution, or any
upstream call. It must not equal or expose `AGENTIC_APP_BEARER_TOKEN`.
`x-actor-id` is required and becomes `requestedBy`; `x-correlation-id` is
propagated across the integration, Agentic, and pipeline services. `focus` is
only an emphasis hint. It is never treated as patient evidence. A new result
returns `201`; an exact saved or finalized replay returns `200`. The response
is always labelled `status: "draft"` because it is decision support, never an
approved clinical record. `renderingStatus` distinguishes `pending` from
`rendered`.

The integration service owns orchestration, not clinical state:

1. `POST /api/patients/:patientId/handover-drafts` on the Agentic service
   persists the request, runs the dedicated Corti agent, verifies that the
   completed Corti task saved exactly one draft, and returns the canonical
   packet.
2. `POST /api/corti/handovers/render` on the pipeline is an internal-only Text
   Generation boundary. It renders extractive narrative, appends authoritative
   task facts deterministically, and copies unknowns locally.
3. `POST /api/handovers/:handoverId/finalize` on the Agentic service accepts the
   render only if the patient source snapshot is unchanged. `GET
   /api/handovers/:handoverId` reads the safe Agentic projection.

The Agentic HTTP endpoints require `APP_BEARER_TOKEN`; the integration gateway
holds it server-side. Both MCP mounts require `MCP_BEARER_TOKEN`. Browser code
must not call either internal service directly or receive either bearer.

### Handover-only MCP boundary

The dedicated handover agent connects to `/mcp/handover`, not the task agent's
`/mcp` mount. It has exactly these tools:

| Tool | Authority |
| --- | --- |
| `get_patient_context` | Read registered patient record facts |
| `list_open_threads` | Read current non-terminal threads |
| `list_patient_tasks` | Read every current non-terminal patient task |
| `get_task` | Read one authoritative task without an audit side effect |
| `save_handover_draft` | Save one grounded packet idempotently |

There is no task creation, publication, approval, assignment, acceptance,
completion, verification, dismissal, or reopen tool on this server. Generating
or reading a handover cannot change task state or ownership.

### Grounding and lifecycle rules

- Every clinical statement cites one or more references already registered for
  that patient. Narrative claims may cite clinical `record:` and `encounter:`
  references, never task or thread references as clinical evidence.
- Operational task items may cite `thread:<threadId>@<version>` only for a
  current open thread in the patient scope. A stale, terminal, foreign, or
  unknown thread/version reference is rejected; thread references never support
  clinical narrative claims.
- Every active task appears exactly once in `outstandingTasks`,
  `awaitingVerification`, or `escalations`. Its summary, state, team, member,
  urgency, deadlines, version, and `task:<id>@<version>` reference must exactly
  match the ledger. `verified` and `dismissed` tasks are terminal and excluded.
- Text Generation sees only the three clinical narrative sections. Generated
  narrative must be an exact statement from the same canonical section with
  the same supported references. Task sentences are formatted locally from
  ledger values; unknowns are copied exactly and have no evidence references.
- A canonical hash covers sorted record content hashes plus current thread and
  task versions. Finalization rebuilds it. A mismatch returns
  `HANDOVER_SOURCE_CHANGED` and never returns a stale render.
- The durable lifecycle is `requested` → agent-verified `draft` → `rendered`, or
  `failed`. A draft is replayable only after the Corti completion and saved
  draft have been verified together. Reusing a key while generation is still
  running returns `HANDOVER_IN_PROGRESS` and does not start another agent.

Idempotency is scoped to the requester and key. Within that requester scope,
reuse with a different patient, reason, or focus returns
`IDEMPOTENCY_CONFLICT`; a different requester has a separate key scope. A
failed attempt requires a new key. A verified saved draft can resume rendering
without another agent call; an already rendered result is replayed exactly.

### Handover failures

| Code | HTTP | Meaning and recovery |
| --- | ---: | --- |
| `HANDOVER_IN_PROGRESS` | 409 | Same request is still running; retry the same key later |
| `IDEMPOTENCY_CONFLICT` | 409 | Key was reused for different inputs; correct the caller |
| `HANDOVER_RETRY_REQUIRES_NEW_KEY` | 409 | Prior request failed; explicitly start a new attempt |
| `HANDOVER_SOURCE_CHANGED` | 409 | Record, thread, or task version changed; regenerate with a new key |
| `HANDOVER_EVIDENCE_NOT_FOUND` | 409 | A clinical or rendered reference is missing, stale, or unsupported |
| `HANDOVER_TASK_SET_MISMATCH` | 409 | Packet omitted, duplicated, or invented an active task |
| `HANDOVER_TASK_MISMATCH` | 409 | Packet changed an authoritative task field |
| `HANDOVER_SECTION_MISMATCH` | 409 | Task was placed in the wrong lifecycle section |
| `CORTI_HANDOVER_AGENT_FAILED` | 502 | Agent completion or saved-draft verification failed; new key required |
| `HANDOVER_RENDER_FAILED` | 502 | Renderer rejected or could not safely validate output; retryable |
| `UPSTREAM_INVALID_RESPONSE` | 502 | A service returned a structurally or semantically invalid handover |
| `UPSTREAM_UNAVAILABLE` | 502 | An internal service could not be reached |
| `UPSTREAM_TIMEOUT` | 504 | An internal call exceeded the configured timeout |
| `HANDOVER_NOT_CONFIGURED` | 503 | Integration gateways are unavailable |

The grounding mismatch codes are authoritative domain/MCP errors. If the
dedicated agent produces one while saving its draft, the internal HTTP boundary
records the stable cause in `handover.failed` but returns the public-safe
`CORTI_HANDOVER_AGENT_FAILED` envelope. Snapshot and render validation errors
that occur during finalization keep their safe stable code.

Safe activity names are `handover.requested`,
`handover.context_initialized`, `handover.sources_retrieved`,
`handover.draft_saved`, `handover.render_requested`, `handover.rendered`,
`handover.source_changed`, and `handover.failed`. Activity payloads contain only
allow-listed identifiers, counts, hashes, status, version, credit totals, and
stable failure metadata. They never contain prompts, credentials, source prose,
full packets, model messages, or hidden reasoning.

## Queries and event stream

- `GET /api/patients/:patientId/threads` returns `{ "threads": [Thread] }`.
- `GET /api/patients/:patientId/tasks` returns `{ "tasks": [Task] }`, including
  drafts needed by the Ward Companion projection.
- `GET /api/teams/:teamId/tasks` returns the actionable team queue, sorted by
  dynamic operational priority and deadline.
- `GET /api/tasks/:taskId` returns one authoritative task.
- `GET /api/events?after=42` returns events with `sequence > 42`.
- `GET /api/events/stream` is SSE. Reconnect with `Last-Event-ID: 42`, then
  refresh authoritative patient/task state.

SSE frames are:

```text
id: 43
event: task.published_to_team
data: {"schemaVersion":"1","sequence":43,"eventId":"event-uuid","eventType":"task.published_to_team",...}
```

`Task` contains `taskId`, `threadId`, `patientId`, `origin`, `summary`,
`taskType`, `evidenceRefs`, `targetTeamId`, `requiredCapabilities`,
clinician-owned `clinicalUrgency`, dynamic `operationalPriorityScore`,
`priorityBreakdown`, `acceptBy`, `dueBy`, `state`, nullable
`assignedMemberId`, `failedOffers`, `version`, `createdAt`, and `updatedAt`.

Task states are `draft`, `offered_to_team`, `assigned_to_member`, `accepted`,
`completed`, `verified`, `escalated`, and `dismissed`. Thread states are
`awaiting_review`, `tracking`, `verified`, `escalated`, and `dismissed`.

## Demo command

`POST /api/demo/advance-clock` accepts positive `milliseconds` and an
`idempotencyKey`, advances time, and runs scheduling. It returns
`DEMO_CLOCK_DISABLED` when demo clock control is off.

## Safety display rule

The backend can report **“No tracked follow-through items.”** Consumers must
not convert that into **“ready for discharge,” “clear for discharge,”** or any
other clinical determination.
