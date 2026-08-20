# On-Demand Grounded Patient Handover Design

**Status:** Approved direction, ready for team review

**Date:** 2026-08-20

**Scope owner:** Agentic Framework and MCP workstream

**Related product:** Follow-Through

## Decision summary

Build an on-demand, patient-scoped handover that a newly assigned clinician or
an existing care-team member can request in seconds. A fresh Corti Agentic
context gathers the current patient record, open follow-through threads, and
authoritative task state through MCP. It saves a structured, evidence-linked
handover packet. Corti Text Generation then turns that packet into concise
handover prose without becoming the source of truth.

The result is an explicitly labelled draft. It tells the next clinician what
matters now, what remains outstanding, who currently owns it, when it is due,
and what still needs verification. Every clinical statement and operational
claim links to a source record or versioned ledger object. If the source changes
while the handover is being generated, the stale draft is not returned.

This is feature A. Feature B, whole-handover-meeting capture and reconciliation,
will reuse this same patient packet rather than create a separate summary
architecture.

## User story

> As a clinician taking over a patient, I can request a current handover and get
> a short, grounded summary of the patient's situation and open follow-through
> work, so I do not need to reconstruct it from several conversations and task
> lists.

The same action is available to an already assigned clinician who wants a fresh
summary before a review, ward round, or handover.

## Goals

- Produce a useful handover from the patient record and live Follow-Through
  ledger, not from a free-form prompt alone.
- Use Corti Agentic as an observable investigator that calls narrow MCP tools.
- Use Corti Text Generation for a bounded rendering step.
- Preserve exact task states, teams, owners, deadlines, and verification status.
- Make each clinical and operational claim traceable to its source.
- Require an attributable requester and retain a safe activity trail.
- Prevent the handover workflow from creating, approving, assigning, completing,
  or verifying clinical work.
- Keep the first implementation small enough to ship and merge as one feature.
- Establish the reusable patient-level primitive needed by later meeting
  reconciliation.

## Non-goals

- Recording or diarizing a whole handover meeting in this feature.
- Attributing meeting speech to patients.
- Detecting yesterday's missing handover tasks; that is feature B.
- Creating or changing tasks from the handover request.
- Replacing the clinician-to-clinician handover or the EHR.
- Writing back to a real EHR or hospital task system.
- Declaring discharge readiness or medical fitness.
- Producing a diagnosis, treatment recommendation, or new clinical inference.
- Building the handover UI. This feature supplies the backend contract the UI
  can render.
- Reusing a clinician approval identifier to make unreviewed text appear
  approved.

## Existing foundations on `main`

The design extends the current system instead of creating a parallel stack:

- The pipeline captures patient conversations and registers one-to-one source
  evidence.
- The agentic service stores patient record items, open threads, versioned tasks,
  context mappings, idempotent commands, and append-only audit events.
- MCP already exposes patient-scoped record and ledger tools.
- The Corti agent runner already creates scoped contexts and verifies completed
  agent work.
- The integration API is the public composition boundary for the agentic and
  pipeline services.
- The pipeline already uses Corti Text Generation for supporting documents, but
  its current endpoint requires approved clinical text. This feature must not
  fake that approval contract.

## Product behavior

### Request

The public integration API adds:

```http
POST /api/patients/:patientId/handovers
X-Actor-Id: clinician:123
X-Correlation-Id: optional-safe-id
Content-Type: application/json

{
  "idempotencyKey": "handover-karen-20260820-001",
  "reason": "assignment",
  "focus": "Medication changes and overnight follow-through"
}
```

`reason` is `assignment` or `on_demand`. `focus` is optional and is treated only
as a request for emphasis. It is never evidence and cannot introduce a fact.

The request requires a valid `X-Actor-Id`. Authentication remains the existing
service-boundary bearer authentication; actor attribution is additionally
carried to the audit trail.

### Successful response

The public endpoint returns `201 Created` for a new result and `200 OK` when the
same idempotency key replays the exact saved result.

```json
{
  "handoverId": "uuid",
  "patientId": "karen",
  "status": "draft",
  "reason": "assignment",
  "requestedBy": "clinician:123",
  "generatedAt": "2026-08-20T10:00:00.000Z",
  "sourceSnapshotHash": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "packet": {
    "situation": [],
    "background": [],
    "currentConcerns": [],
    "outstandingTasks": [],
    "awaitingVerification": [],
    "escalations": [],
    "unknowns": []
  },
  "rendered": {
    "title": "Current handover",
    "sections": []
  },
  "activity": []
}
```

`activity` contains safe milestones and tool names, timestamps, and outcomes. It
does not expose hidden model reasoning or chain-of-thought.

## Grounded handover packet

The structured packet is canonical. Rendered prose is a presentation of this
packet, not a replacement for it.

### Narrative items

The `situation`, `background`, and `currentConcerns` sections contain:

```ts
interface GroundedStatement {
  statement: string;
  sourceRefs: string[];
}
```

Every statement must have at least one source reference that resolves within the
requested patient's scope. Unsupported statements are rejected rather than
returned with a warning.

### Operational task items

Outstanding, verification-pending, and escalated work uses exact ledger fields:

```ts
interface HandoverTaskItem {
  taskId: string;
  threadId: string;
  summary: string;
  state: TaskState;
  targetTeamId: string;
  assignedMemberId: string | null;
  clinicalUrgency: ClinicalUrgency;
  acceptBy: string;
  dueBy: string;
  version: number;
  sourceRefs: string[];
}
```

These fields are copied from an authoritative task readback. The agent cannot
invent, paraphrase, or recalculate them. Human-readable team and member names may
be added only when returned by a scoped directory lookup; identifiers remain in
the packet.

### Source references

The packet supports three resolvable source kinds:

- a patient record item and its retained encounter evidence;
- `thread:<threadId>@<version>` for current thread state;
- `task:<taskId>@<version>` for current task state and deadlines.

Clinical wording must ultimately resolve to retained record evidence. Versioned
thread and task references support operational claims only. A task reference by
itself cannot support a new clinical claim.

`unknowns` contains short statements such as “No current medication list was
available in the connected record.” Unknowns describe unavailable input; they do
not convert absence into a clinical conclusion.

## Architecture

```text
UI / client
    |
    | POST /api/patients/:patientId/handovers
    v
Integration API (orchestrator)
    |                         |
    | create grounded draft   | render grounded packet
    v                         v
Agentic service             Corti pipeline
    |                         |
    | fresh context           | Corti Text Generation
    v                         |
Corti Agent                  |
    |                         |
    | patient-scoped MCP      |
    v                         |
Record + task ledger <--------+ final rendered draft is recorded
```

The integration API remains the only public coordinator. It does not generate
clinical content itself. It asks the agentic service for a validated packet,
asks the pipeline to render that exact packet, then asks the agentic service to
finalize the handover against the original source snapshot.

### Service contracts

The public operation is composed from three internal calls:

1. `POST /api/patients/:patientId/handover-drafts` on the agentic service creates
   and returns a validated structured packet.
2. `POST /api/corti/handovers/render` on the pipeline renders that packet with
   Corti Text Generation. This is a new purpose-built contract and does not use
   the existing approved-document endpoint.
3. `POST /api/handovers/:handoverId/finalize` on the agentic service persists the
   exact render only if the stored snapshot and expected handover version still
   match.

Only service bearer credentials may call the internal operations. The public
integration API forwards the safe correlation and actor identifiers.

### Agentic service

Add a `HandoverService` that owns source snapshotting, packet validation,
idempotency, persistence, and finalization. Extend `AgentRunner` with a handover
operation that always creates a fresh Corti context by using a unique handover
interaction identifier. It must not reuse the context from an earlier encounter
or task investigation.

The agent receives only:

- the patient identifier;
- the handover identifier and interaction identifier;
- the request reason;
- optional focus labelled as untrusted emphasis, not evidence;
- the MCP bearer token and idempotency metadata.

Use a dedicated Corti handover agent configured against a dedicated
`/mcp/handover` endpoint. That MCP server registers only the handover-safe reads
and `save_handover_draft`; it does not register `create_task_draft` or
`publish_team_task`. Add a separate `CORTI_HANDOVER_AGENT_ID` so enforcement does
not depend on prompt compliance or on changing the existing task agent.

The handover agent prompt additionally limits it to gathering current facts and
saving one draft. The dedicated tool surface is the security boundary; the
prompt is defense in depth.

### MCP changes

Add two narrow tools:

1. `list_patient_tasks`
   - patient-scoped and read-only;
   - returns active and verification-pending tasks, excluding terminal
     `verified` and `dismissed` tasks;
   - does not append publication-verification events simply because a task was
     read.
2. `save_handover_draft`
   - accepts the structured packet and its handover identifier;
   - persists a non-actionable draft idempotently;
   - validates every supplied source reference against the current patient and
     source snapshot;
   - rejects task fields that differ from authoritative ledger readback;
   - cannot create or modify a thread, task, approval, assignment, or outcome.

The existing `get_patient_context`, `list_open_threads`, and `get_task` tools are
reused. The expected tool path is:

1. retrieve patient context;
2. list open threads;
3. list patient tasks;
4. read back each relevant task with `get_task`;
5. save exactly one handover draft.

`get_task` must become a side-effect-free read. Reading a task for a handover is
not proof that publication was verified. The existing publication runner emits
its verification event only after it independently checks the returned task
state and version.

The existing `/mcp` endpoint and task agent retain the task workflow. The new
`/mcp/handover` endpoint reuses the same services and patient-scope checks while
registering only its constrained tool set.

### Pipeline rendering

The pipeline adds a handover renderer beside, not inside, the approved supporting
document flow. Its input is the validated structured packet plus the allowed
source-reference set. Corti Text Generation is instructed to:

- preserve the supplied section boundaries;
- be concise and use direct clinical handover language;
- retain source references for every rendered statement;
- copy task state, ownership, urgency, and deadline values exactly;
- state unknowns plainly;
- add no diagnosis, recommendation, completion claim, or discharge claim.

The renderer validates that every returned reference was present in the input
and that required task fields were preserved. Invalid generation is rejected.
The canonical packet remains available for a safe retry.

### Persistence

Add a `handovers` table containing:

- handover, patient, request interaction, and Corti context identifiers;
- requester, request reason, optional focus, and correlation identifier;
- internal `requested`, `draft`, `rendered`, or `failed` status and
  optimistic-lock version; only `draft` and `rendered` are returnable handover
  results;
- canonical packet JSON;
- rendered sections JSON when available;
- source snapshot JSON and its canonical SHA-256 hash;
- creation, update, and generation timestamps.

The existing `processed_commands` table provides request idempotency. Handover
state and each related audit event are written in the same transaction.

No hidden model reasoning is stored. Corti task/context identifiers and safe tool
milestones are retained for the visible activity trail.

## Source consistency and concurrency

At draft creation, `HandoverService` builds a canonical source snapshot from:

- sorted patient record item identifiers, source references, and content hashes;
- sorted open thread identifiers and versions;
- sorted non-dismissed task identifiers and versions.

It stores the snapshot and hash with the draft. Before finalization, the service
rebuilds the current snapshot. If it differs, finalization fails with retryable
`409 HANDOVER_SOURCE_CHANGED`; the rendered output is discarded and is never
returned as current. The client may retry the complete operation with a new
idempotency key.

This avoids returning a handover whose task owner, state, or deadline changed
during generation. It also avoids treating an unrelated event elsewhere in the
ward as a patient-data conflict.

The request row is persisted before the Corti agent starts, so concurrent reuse
of the same key cannot start a second agent run. A concurrent replay receives
retryable `409 HANDOVER_IN_PROGRESS`. The same idempotency key, actor, and
patient replay the exact saved result after finalization. If rendering
previously failed, replay resumes from the saved canonical packet without
another agent call. Reuse of the key with a different patient, actor, reason, or
focus fails with `409 IDEMPOTENCY_CONFLICT`.

## Human authority and safety rules

- The response is always labelled `draft`.
- The requester can read the result but the request itself does not approve any
  clinical or operational action.
- The dedicated handover agent is provisioned against `/mcp/handover`, which has
  read tools and `save_handover_draft` but no task mutation tools.
- Even if the model asks for a forbidden tool, that tool does not exist on its
  MCP server.
- Task state and ownership come from the ledger, never model memory.
- Missing data is reported as unknown, never “normal,” “none,” “completed,” or
  “safe.”
- “No open Follow-Through tasks were found” is allowed only after successful
  scoped retrieval. It is not equivalent to “no clinical issues.”
- There is no “ready for discharge” output.
- Cross-patient references are rejected before storage and again before render.

## Audit and observability

The activity trail uses append-only events such as:

- `handover.requested`;
- `handover.context_initialized`;
- `handover.sources_retrieved`;
- `handover.draft_saved`;
- `handover.render_requested`;
- `handover.rendered`;
- `handover.source_changed`;
- `handover.failed`.

Events identify the requester or responsible service, correlation ID, patient,
handover, Corti context, and safe outcome metadata. Error events record a stable
code and retryability, not prompts, credentials, patient prose, or model
reasoning.

The existing event stream can carry these events to the UI. The UI team may show
the same visual action trail as tasks, but no UI implementation is part of this
feature.

## Failure behavior

| Failure | Result |
|---|---|
| Patient or source retrieval unavailable | Fail closed; do not produce an empty handover |
| Cross-patient context or source | `403 PATIENT_SCOPE_DENIED`; persist no packet |
| Agent incomplete or wrong context | Retryable upstream error; persist failure event only |
| Agent omits citations or changes task facts | Reject the packet; no handover is returned |
| Text Generation unavailable | Keep the canonical structured draft; return a retryable render failure with `handoverId` |
| Renderer returns unsupported references | Reject the render; keep the canonical draft |
| Patient sources change during generation | `409 HANDOVER_SOURCE_CHANGED`; return no stale render |
| Duplicate request with same content | Replay the final result, or resume rendering from the saved packet, without another agent call |
| Duplicate key with changed content | `409 IDEMPOTENCY_CONFLICT` |

No failure is represented as “no issues” or silent success.

## Tests

### Agentic domain and persistence

- snapshot hashes are deterministic regardless of row ordering;
- grounded packets persist across restart;
- packet and audit event commit atomically;
- duplicate requests replay and conflicting reuse fails;
- finalization rejects changed task/thread/record snapshots;
- rendered output finalizes only once at the expected handover version.

### MCP

- `/mcp/handover` exposes the required reads plus `save_handover_draft` and no
  task mutation tool to the handover agent;
- every narrative statement requires a valid patient-scoped evidence source;
- task fields must exactly match `get_task` readback;
- a task/version reference cannot support an unsupported clinical statement;
- cross-patient and unknown references fail closed;
- draft saving is idempotent;
- handover task reads do not emit publication-verification events.

### Agent runner

- every handover receives a fresh context;
- request focus is labelled as non-evidence;
- incomplete, failed, or mismatched Corti tasks fail safely;
- a completed Corti task without one persisted draft is rejected;
- one request cannot persist multiple drafts.

### Pipeline

- the renderer sends only validated packet content to Corti Text Generation;
- returned source references must be members of the allowed set;
- task state, owner, team, urgency, and deadlines cannot change;
- unsupported discharge, diagnosis, recommendation, and completion claims fail
  the safety evaluator;
- timeout and invalid Corti output return typed, retryable errors;
- no existing approved-document contract is weakened.

### Integration API

- actor and request validation;
- exact orchestration order: draft, render, finalize;
- no render call when agentic draft generation fails;
- no finalize call when rendering fails;
- upstream status and safe error propagation;
- correlation and actor propagation;
- replay does not consume another Corti call.

### End-to-end demo

1. Request Karen's handover as a newly assigned clinician.
2. Observe a fresh Corti context and patient-scoped MCP reads.
3. Receive a short draft with current concerns and exact open task ownership and
   deadlines.
4. Open a cited source and show that the wording is grounded.
5. Change a task during a delayed render and show stale finalization fail safely.
6. Retry and receive the updated handover.

## Acceptance criteria

- A caller can request one patient's handover through the integration API.
- The request is attributable and idempotent.
- Corti Agentic visibly calls patient-scoped MCP tools in a fresh context.
- The saved packet includes current clinical context, open concerns, outstanding
  tasks, verification-pending work, escalations, and explicit unknowns when
  available.
- Every clinical statement has retained patient evidence.
- Every operational claim is backed by a versioned thread or task readback.
- Corti Text Generation renders the packet under a separate safe contract.
- The handover cannot mutate clinical task state.
- A source change during generation prevents a stale response.
- Safe audit events can drive a UI activity trail.
- The existing agentic, pipeline, and integration test suites remain green.

## Extension to whole-handover meetings

Feature B will add Ambient capture for the whole handover meeting, explicit
speaker and patient attribution, and reconciliation against the previous
patient handover packets. It may propose missing-task candidates, but those
candidates must enter the existing clinician-review and approval workflow.

The meeting feature must not guess which patient a statement concerns. Ambiguous
segments remain unassigned for human resolution. Once patient attribution is
confirmed, the meeting workflow can request the same packet defined here and
compare stated commitments with current ledger state. This keeps one grounded
patient summary contract across assignment handovers, on-demand review, and
meeting reconciliation.

## Delivery boundary

Implement and merge this feature before starting whole-meeting capture. During
implementation, fetch and compare against `origin/main`; do not pull unfinished
feature branches into this work. The commit must contain only the handover
vertical slice and its contracts, migrations, tests, and documentation.
