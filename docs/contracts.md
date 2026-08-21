# Fluence integration contract v1

This is the MVP contract between the Corti pipeline, integration API, Ward
Companion, Agentic/MCP backend, patient profile, mock EHR, and downstream
gateway. All examples use synthetic data.

## Authentication and attribution

- `GET /healthz` is public.
- On the authoritative Agentic backend, every `/api/*` request requires
  `Authorization: Bearer $APP_BEARER_TOKEN`.
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

## Transcript review boundary

`POST /api/corti/transcripts/review` is non-mutating decision support over final
Corti Ambient segments. The browser sends the same interaction-scoped segment
objects used for candidate generation, optional clinical context hints, and
explicit protected terms such as the selected patient's name. The integration
API exposes only this exact allow-listed pipeline path; Corti credentials stay
server-side.

Text Generation may return at most three possible minimal phrase replacements.
The pipeline retains only high-confidence suggestions grounded by one exact,
unique source span. It independently rejects changes involving negation,
dosage, numbers, units, allergies, dates, times, protected names, overlapping
spans, or capitalization alone. Context never authorizes a replacement.

Every retained item has `requiresConfirmation: true`. The response always has
`originalTranscriptPreserved: true`; it contains suggestions and source offsets,
not a corrected transcript. The UI may start candidate extraction from the raw
transcript concurrently to keep the common path fast, but it cannot send those
candidates to Agentic while any wording suggestion awaits a clinician decision.
If every phrase is kept, the raw extraction can continue. If any interpretation
is confirmed, the raw result is discarded and candidate extraction runs again
over a separate clinician-reviewed interpretation. The exact Ambient transcript
remains immutable and visible throughout.

## Mock-EHR documents and medical-coding review

The mock EHR versions the clinician's Medical Coding review with the same
optimistic concurrency and immutable history as its document draft. A coding
suggestion being highlighted for evidence inspection is not acceptance. Before
the UI can save a draft that has suggestions, the clinician must explicitly
choose one of these outcomes:

- `accepted`, with the exact supported/candidate code, display text,
  evidence-validation status, and evidence offsets;
- `rejected`, with no selected code;
- `no-suggestions`, recorded when Corti returned no reviewable result; or
- `unavailable`, recorded when coding failed without blocking safe document
  drafting.

The server stamps the review with `reviewedBy` from `x-actor-id` and its own
`reviewedAt` time. Create and revision requests carry only the review input;
clients cannot provide attribution. Changing a coding outcome creates a new
document version. Filing preserves that version and makes it immutable.

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
| `approve` | optional `approvalChannel`; Integration API also accepts optional `referralSnapshotId` | Published authoritative task plus idempotent downstream delivery when the Corti runner is configured |
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

Without a configured Corti runner, the direct Agentic service returns an
explicit recovery state and does not pretend publication occurred:

```json
{
  "taskId": "task-uuid",
  "approvalProof": "approval-id.hmac-signature",
  "expiresAt": "2026-08-20T10:10:00.000Z",
  "status": "approved_not_published"
}
```

With the configured runner, the Corti agent publishes that exact approved draft
with the MCP `publish_team_task` tool, verifies authoritative state with
`get_task`, and the Integration API submits the returned task to the private
downstream gateway before returning success.

## Referral snapshots and downstream delivery

The patient profile service is the single mutable profile owner. The Integration
API exposes it through:

- `PATCH /api/ehr/patients/:patientId/profile` with optimistic versioning;
- `POST` and `GET /api/ehr/patients/:patientId/referral-snapshots`;
- `GET /api/ehr/referral-snapshots/:referralId`.

A referral snapshot is immutable. It contains the exact profile version used
for that referral; reading it later reports `profileChanged: true` when the live
profile has moved on. The caller creates the snapshot first and supplies its
`referralSnapshotId` in the approval request. The Integration API rejects a
snapshot attached to a non-referral task or a different patient.

After authoritative publication, the Integration API submits one delivery with
the stable key `delivery:<taskId>`. A request failure is retryable: replaying the
same approval reuses both the Agentic publication and downstream intent rather
than sending duplicate work. The UI reads provider state through
`GET /api/tasks/:taskId/deliveries`; it never calls the private gateway.

Provider submission and acceptance do not verify a task. The background
reconciler reads pending provider work and acts only on `completed` readback
with a non-empty outcome reference. It then:

1. calls the Agentic `verify-external` command with the exact delivery and task
   version, using an attributed `downstream:` verifier;
2. acknowledges the readback with a `system:` actor only after the ledger write
   succeeds.

Both writes use stable idempotency. Completed but unacknowledged deliveries stay
pending, so a process failure between the two steps safely retries instead of
losing the completion or fabricating it.

## Change Radar

Every persisted task evidence reference and generated handover source snapshot
creates an immutable evidence dependency containing the source reference and
content hash observed at creation time. Existing databases backfill these
dependencies at startup.

The internal, application-bearer-protected endpoint
`POST /api/patients/:patientId/source-revisions` accepts a registered source
item, its expected source reference, revised content, a revision reason, and an
idempotency key. It atomically:

1. records the source revision and before/after hashes;
2. finds dependencies whose observed hash is now stale;
3. persists one `review_required` impact per affected task or handover; and
4. emits `record.source_revised` and `change_radar.impact_detected` audit
   events without including the source text.

Source revision detection never changes task, thread, handover, ownership, or
completion state. Consumers must present the impact as requiring clinician
review, not as an automated clinical decision.

`GET /api/patients/:patientId/change-impacts` returns the patient-scoped impact
chain. The integration overview and Fluence projection expose the same
records as `changeImpacts`. The browser-facing
`POST /api/demo/patients/:patientId/source-revisions` is intentionally limited
to the predefined `synthetic-karen` revision and accepts no clinical text.

## Audience demo sessions

The authoritative backend persists audience sessions, participants, groups,
and assignments. The browser reaches these operations through the integration
API, so `$APP_BEARER_TOKEN` remains server-side.

`POST /api/demo/sessions` creates a session for one existing target team. It
accepts a title, `targetTeamId`, `groupSize` of `1` or `2`, and one of these
scenarios:

- `meeting`
- `discharge_coordination`
- `ward_consultation`

The response includes a random `joinCode` and a relative `joinPath` such as
`/demo/join/JOINCODE`. The UI may encode its public origin plus that path in a
QR code; credentials must never be embedded in the URL.

`POST /api/demo/join/:joinCode` accepts a display name and browser-generated
`joinKey`. Participants are placed in scan order into solo or duo groups named
`group-1`, `group-2`, and so on. A retry with the same `joinKey` does not create
a duplicate participant; it rotates and returns a new high-entropy participant
token. The UI should keep that token in session storage, send it only as a
Bearer credential to `GET /api/demo/participants/me`, and never log it.

`POST /api/demo/sessions/:sessionId/assign` accepts a group, task, exact task
version, and idempotency key. It can assign only an unchanged
`offered_to_team` task whose target team matches the session. The backend
selects one eligible participant in the chosen group using deterministic load
balancing, records the assignment, and moves the authoritative task to
`assigned_to_member`. It does not bypass clinician approval or publication.

The host reads `GET /api/demo/sessions/:sessionId` to refresh group and
assignment state. The participant endpoint returns only the authenticated
participant's assignments. On the Agentic backend itself, participant lookup
is a server-to-server `POST /api/demo/participants/lookup`; browsers must not
call that protected endpoint directly.

## Explainable smart assignment demo

An expanded `offered_to_team` task may expose the demo-only
`POST /api/demo/tasks/:taskId/route-now` control. It accepts only an idempotency
key, requires a signed presenter session plus CSRF token at the UI boundary,
and uses the server-held integration bearer upstream. The presenter unlocks
that session with `DEMO_HOST_ACCESS_KEY`, which is never bundled into client
code. The control advances the backend's synthetic clock to the task's existing
team acceptance deadline. It is rejected without mutation when demo mode is
disabled, nobody is eligible, or the team deadline collides with the clinical
deadline. The normal scheduler still makes the decision; the UI cannot nominate
an owner or bypass team, shift, availability, capacity, or capability checks.

The result contains the newly assigned task and a durable routing receipt. The
same receipt remains available from
`GET /api/tasks/:taskId/routing-receipt`, including the trigger, selected
member, required capabilities, ranked eligible candidates, workloads, and
explicit exclusion reasons. The browser must present this as operational
routing after clinician approval—not as a clinical decision made by the agent.

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

## Ambient ward-meeting reconciliation

The authenticated integration surface exposes one meeting lifecycle:

- `POST /api/ward-meetings` creates a Corti Ambient browser session and an
  attributable recording meeting.
- `POST /api/ward-meetings/:meetingId/segments` explicitly selects one patient.
  Patient identity is never inferred from the transcript.
- `POST /api/ward-meetings/:meetingId/transcript-segments` retains final
  transcript. Clear final speech is eligible evidence only while explicitly
  scoped to an open patient segment; unscoped or uncertain speech cannot create
  patient evidence or tasks.
- `POST /api/ward-meetings/:meetingId/segments/:segmentId/close` freezes the
  evidence and automatically reconciles the current discussion with that
  patient's previous meeting segment, latest finalized handover, and active
  task ledger.
- `POST /api/ward-meetings/:meetingId/complete` finishes a meeting only after no
  patient segment remains open. `GET /api/ward-meetings/:meetingId` returns the
  safe current projection.

The dedicated meeting agent uses only `/mcp/meeting`. It can read the current
and previous meeting, latest handover, active tasks and eligible teams, then
save exactly one grounded reconciliation. It cannot approve, publish, offer,
assign, accept, complete, verify, or escalate a task. A genuinely new spoken
commitment becomes an `agent_suggested` draft for clinician review. Existing
unresolved or undiscussed work becomes a separate carry-forward warning and is
never duplicated. Every accepted proposal must quote exact eligible transcript
and cite its registered `encounter:` reference.

The integration close operation derives a stable reconciliation idempotency
key and calls close before reconciliation. Replays cannot create another draft
or warning. Meeting reconciliation uses the dedicated long upstream timeout;
all credentials remain server-side, and all public meeting operations require
the inbound integration bearer plus `x-actor-id`.

## Queries and event stream

- `GET /api/patients/:patientId/threads` returns `{ "threads": [Thread] }`.
- `GET /api/patients/:patientId/tasks` returns `{ "tasks": [Task] }`, including
  drafts needed by the Fluence projection.
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
