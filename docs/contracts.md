# Follow-Through integration contract v1

This is the MVP contract between the Corti pipeline, integration API, Ward
Companion, and Agentic/MCP backend. All examples use synthetic data.

## Authentication and attribution

- `GET /healthz` is public.
- Every `/api/*` request requires `Authorization: Bearer
  $APP_BEARER_TOKEN`.
- Every `/api/*` mutation also requires `x-actor-id`.
- Every mutation carries an operation-specific `idempotencyKey`. Retrying the
  same operation must reuse the key.
- MCP requests to `POST`, `GET`, or `DELETE /mcp` require `Authorization:
  Bearer $MCP_BEARER_TOKEN`.
- Browser CORS is allowed only for the configured `UI_ORIGIN`. The application
  bearer belongs in the integration service/BFF, never in browser code.
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
