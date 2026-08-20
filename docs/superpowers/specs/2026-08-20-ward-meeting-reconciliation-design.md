# Ward Meeting Reconciliation Design

**Status:** Approved direction, implementation-ready

**Date:** 2026-08-20

**Scope owner:** Agentic Framework and MCP workstream

**Related product:** Follow-Through

## Decision summary

Add a reuse-first ward-meeting orchestration layer around the existing Corti
Ambient, patient handover, and task-ledger capabilities. A meeting lead records
one live ward handover through Corti Ambient and explicitly selects the patient
before each patient discussion. Closing that patient segment freezes its final
transcript evidence and starts a grounded Corti Agentic reconciliation.

The agent compares four patient-scoped sources: the current discussion, the
patient's previous meeting transcript, the latest finalized handover, and the
current task ledger. It produces two deliberately separate outputs:

1. new explicit commitments that are not represented in the ledger become
   evidence-linked **draft tasks**;
2. existing unresolved work that remains relevant or was not discussed becomes
   a **carry-forward warning** linked to the existing task, never a duplicate.

Drafts are created automatically but cannot be offered, assigned, accepted, or
completed until a clinician reviews them through the existing task workflow.
Speech captured while no patient is selected remains unscoped meeting context
and can never support a patient task. Raw audio is not retained.

## Why this is a new feature rather than a duplicate pipeline

The repository already provides the lower-level rails:

- Corti Ambient creates diarized, timestamped transcript segments with audio
  quality state.
- Candidate normalization requires exact transcript quotes and rejects uncertain
  audio evidence.
- The agentic service owns patient-scoped evidence, threads, tasks, approvals,
  routing, escalation, idempotency, and audit events.
- On-demand handovers expose a grounded snapshot of the patient record and
  current operational work.
- MCP and the Corti Agent runner already support narrow, auditable tool use.

What is missing is the meeting boundary: one meeting containing several
explicitly selected patient discussions, retained previous meeting evidence,
multi-source reconciliation, carry-forward warnings, and a meeting-level result.
This feature composes the existing systems and does not introduce a second task
engine, candidate engine, handover format, or UI.

## User story

> As the clinician leading a ward handover, I can record the meeting, explicitly
> select each patient as they are discussed, and have Follow-Through surface new
> commitments and unresolved prior work without relying on someone to retype the
> conversation.

## Goals

- Capture a live multi-patient handover using Corti Ambient.
- Make patient attribution deterministic through explicit patient selection.
- Reconcile current speech with yesterday's patient-scoped transcript, the
  latest finalized handover, and the current ledger.
- Create grounded draft tasks automatically for genuinely new commitments.
- Surface existing unresolved tasks as carry-forward warnings without cloning
  them.
- Keep every proposed task linked to an exact transcript quote and source
  segment.
- Preserve human control before any draft is dispatched to a team.
- Record a safe, visualizable audit trail without hidden model reasoning.
- Reuse current task, handover, MCP, agent, authentication, and integration
  contracts wherever possible.
- Keep the backend independently wireable by the UI team.

## Non-goals

- Inferring a patient from names, diagnoses, bed numbers, or model reasoning.
- Attaching unscoped speech to the previous or next patient.
- Retaining raw meeting audio.
- Automatically publishing or assigning an AI-created draft task.
- Replacing the existing patient handover or task lifecycle.
- Generating a new diagnosis, treatment recommendation, urgency, deadline, or
  owner that was not explicitly supported by source data or clinician input.
- Building or changing ward-companion UI in this feature.
- Integrating with a production EHR, staff directory, or rostering system.
- Processing uploaded recordings in the MVP; live Ambient capture is the first
  input adapter.

## Product workflow

### 1. Start a meeting

An authenticated, attributable clinician starts a ward meeting. The service
creates a meeting record in `recording` state and a Corti Ambient interaction.
No patient is initially active.

### 2. Select a patient

The meeting lead selects a patient from the ward roster. The backend opens one
patient discussion segment. Only transcript evidence whose final timestamps fall
inside this explicit segment may be registered to that patient.

Changing patients is an explicit close-then-open operation. Two patient segments
can never be active in the same meeting at once.

### 3. Record the discussion

Ambient streams audio to Corti and the client sends final transcript segments to
the meeting service. Interim text is useful for display but is never persisted as
evidence. Raw audio is not stored. Uncertain audio remains retained for audit but
is ineligible to support a task draft.

Speech before patient selection or between patient segments is stored only as
unscoped meeting transcript context. The reconciliation agent cannot read it
through patient-scoped MCP tools and it cannot become task evidence.

### 4. Close and reconcile the patient segment

Closing the segment freezes its final evidence set and creates a reconciliation
request. The dedicated meeting agent receives a fresh Corti context and reads:

- exact eligible transcript evidence from the closed segment;
- the same patient's most recent prior meeting segment and its decisions;
- the latest finalized on-demand handover, if one exists;
- the current active task ledger and versioned task state.

The agent saves one structured reconciliation. Server-side validation proves
patient scope, exact quotes, source eligibility, task versions, and duplicate
rules before anything is persisted.

### 5. Materialize outcomes

Each validated new commitment creates one ordinary task in `draft` state using
the existing task ledger. The task retains its meeting evidence and the
reconciliation identifier. To satisfy the existing draft contract, the agent
selects a provisional eligible team and recommends urgency and a due window.
Those fields are visibly provisional and editable; the task is not offered to
the team or assigned to a person until the existing human review flow confirms
them.

Each carry-forward item points to an existing task and its exact current version.
It does not mutate or clone that task. Stale task versions cause reconciliation
to fail closed and retry from a fresh ledger snapshot.

### 6. End the meeting

The meeting can be completed only when no patient segment is open. The response
summarizes patient segments as `reconciled`, `needs_review`, or `failed`, along
with counts of new drafts and carry-forward warnings. This is a backend contract;
the UI team decides how it appears.

## Domain model

### Meeting

```ts
type MeetingStatus = "recording" | "completed" | "failed";

interface WardMeeting {
  meetingId: string;
  wardId: string;
  interactionId: string;
  status: MeetingStatus;
  startedBy: string;
  startedAt: string;
  completedAt: string | null;
  version: number;
}
```

### Patient discussion segment

```ts
type SegmentStatus =
  | "recording"
  | "closed"
  | "reconciling"
  | "reconciled"
  | "failed";

interface PatientMeetingSegment {
  segmentId: string;
  meetingId: string;
  patientId: string;
  status: SegmentStatus;
  openedBy: string;
  openedAt: string;
  closedAt: string | null;
  version: number;
}
```

The database enforces at most one `recording` patient segment per meeting. A
segment's patient identity is immutable after creation.

### Persisted transcript evidence

Final Ambient segments retain the current `TranscriptSegment` fields plus
`meetingId`, nullable `patientSegmentId`, and an eligibility decision. Evidence
with a null patient segment is unscoped and unavailable to patient tools.

The canonical evidence reference is:

```text
meeting:<meetingId>:segment:<patientSegmentId>:evidence:<segmentKey>
```

It resolves to one patient, one interaction, exact text, timestamps, optional
speaker, audio-quality status, and registration time.

### Reconciliation

```ts
interface MeetingReconciliation {
  reconciliationId: string;
  meetingId: string;
  patientSegmentId: string;
  patientId: string;
  sourceSnapshotHash: string;
  status: "requested" | "saved" | "failed";
  newDraftTaskIds: string[];
  carryForwardTaskRefs: string[];
  createdAt: string;
  version: number;
}
```

The snapshot hash covers the closed segment evidence, selected prior meeting
evidence, latest handover identity/hash, and every current task identifier and
version. Reconciliation is accepted only while that snapshot remains current.

### Proposed draft task

```ts
interface ProposedMeetingDraft {
  summary: string;
  taskType: string;
  evidenceRefs: string[];
  targetTeamId: string;
  requiredCapabilities: string[];
  clinicalUrgency: "high" | "medium" | "routine";
  dueInMs: number;
}
```

The server validates exact meeting evidence, team eligibility, permitted
capabilities, urgency, and deadline bounds through the existing ledger service.
These operational fields are recommendations until approval and can be corrected
through the current draft-edit flow.

### Carry-forward warning

```ts
interface CarryForwardWarning {
  warningId: string;
  reconciliationId: string;
  patientId: string;
  taskRef: `task:${string}@${number}`;
  reason: "unresolved" | "not_discussed" | "overdue";
  sourceRefs: string[];
  createdAt: string;
}
```

Warnings are meeting observations, not task state. Repeating the same
reconciliation request cannot create duplicates.

## Agentic and MCP design

Use a dedicated meeting-reconciliation Corti Agent and a separate MCP mount so
its authority is smaller than the task-publication agent.

### Read tools

1. `get_meeting_segment`
   - returns metadata and eligible exact evidence for the closed patient segment;
2. `get_previous_patient_meeting`
   - returns the most recent prior segment, exact eligible evidence, and prior
     reconciliation decisions for the same patient;
3. `get_latest_patient_handover`
   - returns the existing finalized handover packet and source hash or `null`;
4. `list_patient_tasks`
   - reuses the existing side-effect-free patient task read and exact versions;
5. `get_task`
   - reuses the existing scoped authoritative task read.

### Write tool

6. `save_meeting_reconciliation`
   - accepts proposed draft commitments and carry-forward references;
   - validates all source quotes and patient scope;
   - routes each proposal only to a team returned by the eligible-team tool;
   - treats team, urgency, and due window as editable recommendations;
   - requires exact current task versions;
   - rejects duplicate commitments already represented by an active task;
   - atomically saves the reconciliation, creates ordinary draft tasks, records
     carry-forward warnings, and appends safe audit events;
   - is idempotent for the meeting segment and request key.

The MCP tool cannot publish, offer, assign, accept, complete, verify, or escalate
a task. Existing human workflow remains the only path out of `draft`.

### Agent instructions

The agent must:

- consider every eligible current-segment statement;
- use exact contiguous transcript quotes, never paraphrases, as evidence;
- distinguish an explicit commitment from discussion, speculation, or a clinical
  recommendation;
- compare meaning conservatively against current task summaries and evidence;
- call the existing eligible-team read and use only returned team/capability
  combinations for proposed drafts;
- recommend urgency and a due window conservatively without presenting either as
  a clinical decision;
- never create a new draft when an active ledger task already represents the
  work;
- place existing work only in carry-forward results;
- consult prior meeting evidence to recover an explicit commitment that never
  entered the ledger;
- respect prior dismissal decisions unless new current evidence materially
  changes the commitment;
- return an empty reconciliation when nothing actionable is grounded;
- call `save_meeting_reconciliation` exactly once.

## HTTP composition

The agentic service owns meeting state and exposes authenticated internal routes:

```text
POST /api/ward-meetings
POST /api/ward-meetings/:meetingId/segments
POST /api/ward-meetings/:meetingId/transcript-segments
POST /api/ward-meetings/:meetingId/segments/:segmentId/close
POST /api/ward-meetings/:meetingId/segments/:segmentId/reconcile
POST /api/ward-meetings/:meetingId/complete
GET  /api/ward-meetings/:meetingId
```

The public integration API exposes the same workflow under a single authenticated
`/api/ward-meetings` boundary and delegates Ambient session/token creation to the
existing pipeline. Service credentials remain separated by trust domain and are
never returned to the browser.

All write requests require an idempotency key, attributable actor, and optional
safe correlation identifier. Segment close and reconciliation use expected
versions to prevent double-close and stale replay.

## State and concurrency rules

```text
meeting recording
  -> segment recording
  -> segment closed
  -> segment reconciling
  -> segment reconciled | segment failed
  -> next segment recording ...
  -> meeting completed
```

- A meeting cannot complete with an open patient segment.
- A patient segment cannot reopen or change patient.
- Final transcript evidence cannot be appended after segment close.
- Two callers closing the same version replay the same result or receive a
  version conflict; they never start two agent runs.
- A durable agent-verification marker gates reconciliation replay, matching the
  existing handover safety pattern.
- Draft task creation, carry-forward creation, reconciliation save, and audit
  append occur in one database transaction.
- A changed source snapshot returns a retryable source-conflict error without
  partial draft creation.

## Safety and privacy invariants

- Explicit selection is the only patient attribution mechanism.
- Unscoped evidence can never be read by a patient-scoped agent tool.
- Raw audio is never persisted by Follow-Through; Corti Ambient uses no-retention
  configuration where supported.
- Interim transcripts cannot become evidence.
- Uncertain audio cannot support a task draft.
- Every draft clinical statement resolves to exact eligible transcript evidence.
- Previous transcript evidence can recover a commitment, but cannot override a
  newer completed or superseded ledger state.
- The model cannot select a named assignee or invent a team/capability outside
  the eligible directory. Provisional team, urgency, and due-window values remain
  recommendations until a clinician confirms or edits the draft.
- The model cannot invent diagnoses or treatment decisions.
- Automatic creation stops at `draft`; dispatch always remains human-controlled.
- Public and internal authentication occur before validation that could trigger
  Corti work or expose patient data.
- Activity responses use an allow-listed event projection and never expose model
  reasoning, prompts, credentials, or raw upstream errors.

## Safe audit events

The activity trail may expose only allow-listed identifiers, states, counts, and
versions for events such as:

```text
meeting.started
meeting.patient_segment_opened
meeting.transcript_finalized
meeting.patient_segment_closed
meeting.reconciliation_requested
meeting.context_initialized
meeting.sources_retrieved
meeting.reconciliation_saved
meeting.draft_task_created
meeting.carry_forward_recorded
meeting.reconciliation_failed
meeting.completed
```

## Failure behavior

- `PATIENT_SEGMENT_REQUIRED`: patient-scoped evidence arrived without an open
  segment.
- `PATIENT_SEGMENT_ALREADY_OPEN`: another patient is already active.
- `PATIENT_SEGMENT_CLOSED`: evidence arrived after close.
- `MEETING_IN_PROGRESS`: completion attempted with an open segment.
- `MEETING_RECONCILIATION_IN_PROGRESS`: same segment is still being processed.
- `MEETING_SOURCE_CHANGED`: transcript, handover, or task versions changed during
  reconciliation; retry from a fresh snapshot.
- `MEETING_EVIDENCE_NOT_FOUND`: a quote or reference does not resolve exactly.
- `MEETING_TASK_ALREADY_TRACKED`: a proposed new commitment matches an active
  task and must be returned as carry-forward instead.
- `MEETING_AGENT_INCOMPLETE`: the agent did not complete the constrained save.
- Upstream timeouts and invalid outputs map to safe retryable gateway errors.

No failed request returns hidden model output or partially created tasks.

## Verification strategy

### Domain and persistence

- Explicit open/close transitions and single-active-segment constraint.
- Patient identity immutability and final-evidence-only persistence.
- Unscoped evidence cannot resolve through patient tools.
- Restart persistence, foreign keys, version conflicts, and concurrent close.
- Atomic reconciliation, draft, warning, and audit rollback.

### MCP and agent

- Exact dedicated tool surface and bearer separation.
- Patient and meeting scope enforcement for every tool.
- Current and prior evidence exact-quote validation.
- Existing-task detection produces warning, not duplicate draft.
- Prior dismissed items remain suppressed without new evidence.
- Empty reconciliation is valid.
- Context mismatch, incomplete agent task, stale snapshot, and repeated calls fail
  or replay safely.

### HTTP and integration

- Authentication and actor validation precede Corti calls.
- Start, select, transcript, close, reconcile, complete happy path.
- Unscoped transcript behavior and cross-patient attack cases.
- Idempotent replay and deterministic concurrency.
- Safe error envelopes and activity projection.
- Real in-memory service composition with a fake Corti gateway; no live API calls
  in automated tests.

## Implementation sequence

1. Meeting domain types, schemas, storage, transitions, and audit projection.
2. Meeting service with transcript registration and source snapshotting.
3. Dedicated reconciliation MCP tools and constrained agent runner.
4. Internal authenticated meeting routes.
5. Integration API orchestration and public contract.
6. Existing pipeline adapter reuse for Ambient session/token; no new audio stack.
7. Deterministic end-to-end scenario, contracts, and one-call smoke runbook.

## Demo narrative

The meeting lead starts a ward handover and selects Karen. Corti Ambient captures
the discussion. The lead closes Karen's segment. The agent reads today's exact
quotes, yesterday's Karen segment, her latest handover, and her current tasks.
It finds one newly promised pharmacy check and automatically creates a grounded
draft. It also finds yesterday's unresolved physiotherapy referral and displays
it as carry-forward rather than creating a duplicate. The lead moves to the next
patient while Karen's draft waits for normal clinician review and team dispatch.

The visible distinction is the product: **new work becomes a draft; existing work
is remembered, not recreated.**
