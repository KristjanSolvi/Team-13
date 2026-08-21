# Fluence Agentic and MCP Task Routing Design

**Status:** Approved design, ready for team review

**Date:** 2026-08-20

**Scope owner:** Agentic Framework and MCP workstream

**Related product:** Fluence

## Decision summary

Build one TypeScript backend service that lets a Corti agent investigate a possible follow-through gap, propose a narrowly scoped task, wait for explicit clinician approval, publish that task to the appropriate clinical team, and verify the committed state through a readback. The same service owns a deterministic task ledger, team routing, a controllable demo clock, and an append-only event trail.

The hackathon vertical slice follows one patient thread end to end:

> During a ward conversation, Karen mentions dizziness after a medication change and her daughter is unsure who will check her blood pressure. The agent checks the available record and open threads, proposes a medium-urgency blood-pressure check for the district-nursing team within 48 hours, and waits for a clinician. The clinician approves with one authenticated action or corrects it by dictation. The team is offered the task; a member can accept it. If nobody accepts within the medium-urgency acceptance window, deterministic routing assigns it to an eligible member. Completion is later read back and verified, or the task is escalated if it remains unresolved.

The MVP creates only the district-nursing blood-pressure task. A GP medication-review task is the first clinical extension after the complete one-task path is reliable.

## Product intent

Fluence is an addition alongside the EHR, not a replacement for it. It gives clinical conversations a durable memory by turning selected commitments or unresolved concerns into clinician-approved, tracked work. Its central promise is:

> Nothing a patient tells their care team should get lost, and nothing they are promised should go unkept.

The product deliberately avoids claiming that it can decide whether a patient is medically ready for discharge. The safe summary is **“No tracked follow-through blockers”**, not “clear for discharge.” The UI workstream may render patient-level or ward-level views, but those views consume the task and event contracts defined here.

## Goals

- Demonstrate meaningful Corti Agentic Framework use rather than a decorative chatbot.
- Make at least one real MCP record lookup and one clinician-approved MCP state change visible in Corti tool activity.
- Prove a complete task lifecycle from detection through verification or escalation.
- Keep publication and changes to clinical intent under human authority; only operational queueing and routing may proceed automatically under visible policy.
- Assign work to a clinical team first and a named person only through deterministic policy or explicit human action.
- Allow clinicians to add tasks the agent missed, using the same ledger and safeguards.
- Produce a trustworthy, replayable action trail for the UI and demo.
- Remain small enough for three developers working in parallel across Agentic/MCP, UI, and pipeline workstreams, supported by the team's fourth member.
- Leave clear extension points for a richer record source, real hospital integrations, workforce scheduling, and more than one task per thread.

## Non-goals for the MVP

- Building the rail, ward board, ring visualization, or any other UI.
- Replacing an EHR, task manager, staffing system, or bed-management product.
- Writing to a real hospital system during the hackathon.
- Selecting staff with an LLM.
- Automatically authorizing, accepting, completing, or verifying a clinical task without an attributable system or human event.
- Determining discharge readiness.
- Implementing production-grade FHIR integration, embeddings, or longitudinal RAG.
- Supporting multiple clinical tasks in the canonical Karen demo before the one-task lifecycle is stable.

## Fit with the five Corti product areas

The wider project can use all five areas without forcing all five into this service:

| Corti area | Purpose in Fluence | Workstream boundary |
|---|---|---|
| Ambient speech-to-text | Capture the ward or discharge conversation and retain evidence references | Pipeline |
| Dictation speech-to-text | Let a clinician correct a proposal or create a missed task deliberately | Pipeline into Agentic/MCP commands |
| Agentic Framework | Investigate the signal, call MCP tools, structure a draft, and verify publication | Agentic/MCP |
| Text generation | Produce concise proposal and escalation rationale grounded in returned evidence | Agentic/MCP, with output treated as advisory text |
| Medical coding | Check whether a discussed concern is reflected in coding/documentation | Pipeline; useful extension but not a prerequisite for Karen's task |

The distinction between ambient and dictation is load-bearing: ambient speech can suggest a concern, while intentional clinician input authorizes or corrects it.

## Architecture

The MVP is one deployable TypeScript backend with strong internal module boundaries. A single public Streamable HTTP MCP endpoint exposes narrow tools to one Corti agent. Non-agent clients use ordinary command, query, and event endpoints. SQLite provides durable, transactional state for the prototype.

```text
Pipeline / Dictation ── commands ─────────────┐
                                              v
Corti Agent ── Streamable HTTP MCP ──> Fluence backend
                                       ├── Patient Record module
                                       ├── Task Ledger module
                                       ├── Team Directory module
                                       ├── Deterministic Routing Policy
                                       ├── Injectable Clock
                                       ├── Approval verifier
                                       └── Audit/Event outbox
                                              │
UI workstream <── queries + event stream ─────┘
```

For the first real integration, the service runs locally and is exposed to Corti through a temporary public HTTPS tunnel. If the complete path is stable, the same service can be deployed to a shared hosted environment without changing the domain or MCP contracts.

### Why one service and one agent

One service minimizes deployment, networking, authentication, and consistency risks while preserving boundaries that can later become separate services. One agent with several small tools can perform the investigation coherently within a single Corti context. Splitting record and ledger operations across multiple MCP servers or using multiple agents would demonstrate more topology but would add coordination failure modes without improving the core patient-safety story.

### Module responsibilities

| Module | Responsibility | Must not do |
|---|---|---|
| Patient Record | Return patient-scoped synthetic facts and existing open threads | Infer that a failed lookup means no relevant record exists |
| Task Ledger | Enforce task/thread states, versioning, approval binding, idempotency, and audit events | Bypass approval or permit invalid transitions |
| Team Directory | Return eligible teams and maintain synthetic team/member availability | Make clinical-urgency decisions |
| Routing Policy | Recalculate operational priority and assign an eligible member after timeout | Use an LLM or silently discard an unassignable task |
| Clock | Supply real time or an authorized controllable demo time | Be callable by the clinical agent |
| Approval verifier | Validate who approved the exact draft and whether the proof is current | Treat approval of an earlier draft as approval of a changed one |
| Audit/Event outbox | Persist safe, ordered facts about actions and expose them to consumers | Store or expose hidden model reasoning |

## Corti context and interaction identity

Corti `interactionId` and Agentic `contextId` are separate identifiers. The application stores an explicit mapping among:

- `patientId`
- `interactionId`
- `contextId`
- encounter or session identifier

Agentic contexts are treated as isolated. A request is denied when its patient scope does not match the stored context mapping. The mapping also lets a later UI or pipeline event correlate tool calls with the originating encounter without placing patient identity in prompts unnecessarily.

The implementation must inspect the installed Corti SDK adapter type definitions before copying example code because example and installed package versions can differ.

## Record data strategy

Organizer-provided synthetic records are normalized into deterministic local JSON fixtures and SQLite rows. MCP record tools initially use structured lookup, not embeddings, so tests and the live demo return reproducible evidence. The module boundary permits semantic retrieval or FHIR-backed adapters later without changing the agent's patient-scoped tool contracts.

## Data model

SQLite is the system of record for the prototype. State changes and their audit/outbox events are written in the same transaction so a visible state can never exist without its corresponding event.

### Core tables

- `patients`: synthetic patient identity and display-safe metadata.
- `patient_record_items`: deterministic local clinical facts derived from organizer-provided synthetic data.
- `context_mappings`: patient, interaction, and Corti context relationships.
- `threads`: the clinical concern that one or more tasks follow.
- `tasks`: actionable units offered to teams and eventually owned by members.
- `approvals`: proof that a clinician approved an exact draft version.
- `teams`: clinical teams and their capabilities.
- `members`: synthetic team membership, shift availability, capacity, and stable tie-break key.
- `audit_events`: append-only facts for the activity trail.
- `processed_commands`: idempotency keys and saved command results.

### Thread

A thread represents the concern raised by the conversation. It contains:

- patient and encounter references;
- triggering evidence references and a safe short summary;
- state: `awaiting_review`, `tracking`, `verified`, `escalated`, or `dismissed`;
- child task identifiers;
- optimistic-lock version and timestamps.

Thread state is derived from its child tasks. In the MVP, Karen's thread has exactly one child task. The model is one-to-many so the GP review can be added later without redesign.

### Task

A task contains:

- `taskId`, `threadId`, and `patientId`;
- `origin`: `agent_suggested` or `clinician_created`;
- short summary, task type, and evidence references;
- target team and required capabilities;
- clinician-owned `clinicalUrgency`: `high`, `medium`, or `routine`;
- calculated `operationalPriorityScore` and an explainable score breakdown;
- `acceptBy` and `dueBy` timestamps;
- state and optional assigned member;
- version, idempotency metadata, and timestamps.

Clinical urgency is immutable after publication except through an explicit clinician correction event. Operational priority changes over time and affects queue order and escalation behavior, but never rewrites the clinical judgement.

### Approval

Approval proof binds all of the following:

- patient;
- authenticated clinician;
- task draft identifier;
- exact draft version or canonical content hash;
- approval time and expiry;
- approval channel.

Any material draft change invalidates earlier approval. Publication with a stale, expired, mismatched, or already-consumed proof fails safely and leaves the draft non-actionable.

## Task and thread lifecycles

### Task states and transitions

| From | Event or command | To | Notes |
|---|---|---|---|
| `draft` | Valid clinician approval and publish | `offered_to_team` | Requires approval proof, expected version, and idempotency key |
| `draft` | Clinician dismissal | `dismissed` | Reason is recorded |
| `offered_to_team` | Team member accepts | `accepted` | Atomic first-writer-wins ownership |
| `offered_to_team` | Acceptance window expires | `assigned_to_member` | Deterministic router chooses an eligible member |
| `assigned_to_member` | Assigned member accepts | `accepted` | Acceptance is attributable |
| `assigned_to_member` | Member declines | `assigned_to_member` or `escalated` | Next eligible member is tried; exhaustion escalates |
| `accepted` | Downstream or human completion | `completed` | Completion is not yet verification |
| `completed` | Independent readback confirms outcome | `verified` | Terminal successful state for the MVP |
| Any non-terminal state | Due deadline or policy failure | `escalated` | Preserves existing team/member ownership and reason |
| `escalated` | Human correction or reopen | Policy-selected active state | Recovery is explicit and audited |

`accepted`, `completed`, and `verified` have intentionally different meanings:

- **Accepted:** somebody owns the work.
- **Completed:** the responsible workflow reports that the work was done.
- **Verified:** an independent readback confirms the recorded outcome.

Only `verified` and `dismissed` are terminal. A `completed` task remains non-terminal until its completion can be verified; an `escalated` task remains recoverable through a human command.

### Derived thread states

- `awaiting_review`: the concern has only an unapproved draft.
- `tracking`: at least one child task is active and none is escalated.
- `verified`: every required child task is verified.
- `escalated`: at least one required child task is escalated.
- `dismissed`: the clinician dismissed the concern before publication.

The UI may label or visualize these states, but the backend remains their source of truth.

## Human authority and recovery

### Agent-suggested task

1. The pipeline supplies encounter evidence to the backend.
2. The Corti agent retrieves patient context, checks open threads, and discovers eligible teams.
3. The agent creates a non-actionable draft.
4. The application requests clinician approval.
5. The clinician either:
   - approves the exact proposal with one authenticated action;
   - corrects it by dictation and approves the revised version; or
   - dismisses it as already covered, irrelevant, or incorrect.
6. Only a valid approval allows publication to the team.

### Clinician-created task

If the agent misses a concern, the doctor can dictate a task manually. The agent structures the requested team, urgency, deadline, evidence, and summary and checks for a likely duplicate. The clinician confirms the structured result before it is published. It enters the same ledger with `origin: clinician_created`; it is not a secondary or less visible workflow.

### After publication

Authorized people can accept, decline, reassign, complete, or escalate tasks. When automation fails, durable state remains available for manual continuation. No failure is represented as silent success.

## Team routing and changing priority

### Team-first assignment

The agent chooses from eligible teams, not individual people. For Karen's task, the proposed destination is the district-nursing team because it has the required blood-pressure-monitoring capability. After publication:

1. The team collectively owns the offered task.
2. Any currently eligible team member may accept it.
3. If nobody accepts before `acceptBy`, the deterministic router chooses a named eligible member.
4. If that member declines, the router tries the next eligible candidate.
5. If no eligible member remains, the team retains ownership and the task escalates for human review.

Candidate selection considers capability, current shift/availability, existing workload, and a stable fair tie-break. The stable tie-break compares `tieBreakKey` and then `memberId` using locale-independent UTF-16 code-unit ordering, so identical inputs route identically across hosts. Availability changes who can receive the task; it does not change clinical urgency.

### Acceptance windows

The synthetic policy used by the demo is:

| Clinical urgency | Team acceptance window |
|---|---:|
| High | 5 minutes |
| Medium | 30 minutes |
| Routine | 4 hours |

Karen's blood-pressure task is medium urgency, is offered for 30 minutes, and is due within 48 hours.

### Operational priority

Queue ordering is recalculated when time advances, a shift changes, availability changes, a member declines, or the task changes. The transparent initial scoring policy is:

| Factor | Points |
|---|---:|
| High clinical urgency | 100 base |
| Medium clinical urgency | 60 base |
| Routine clinical urgency | 20 base |
| Deadline pressure | 0–30 as the active target approaches |
| Overdue | +40 at expiry, then +5 per hour, capped at +80 |
| Failed offers | +10 each, capped at +20 |

The active target is `acceptBy` while a task is waiting for ownership and `dueBy` once it is accepted or reported complete but not yet verified. This is what lets a medium-urgency task rise visibly after waiting for hours or days. The stored breakdown explains every score change. The score orders work; the explicit `acceptBy` and `dueBy` deadlines authorize automatic transitions: acceptance expiry triggers deterministic member assignment, and due expiry without verification triggers escalation. None of these changes silently relabels a clinician's medium-urgency judgement as high urgency.

An injectable clock makes multi-day waiting visible during the demo. The demo clock accepts only positive safe-integer millisecond increments, copies the `Date` supplied to its constructor and every `Date` it returns, and rejects advances beyond the JavaScript `Date` range before mutating its current time. Advancing the clock is environment-gated, authenticated, and audited, and is never exposed as an agent tool.

## MCP interface exposed to the Corti agent

The MCP gateway exposes a deliberately small, patient-scoped tool surface.

### Read tools

#### `get_patient_context`

Returns the minimum synthetic record facts relevant to the current patient and question, with evidence identifiers and timestamps. A failure is an explicit error; it is never converted into an empty record.

#### `list_open_threads`

Returns active and recently resolved follow-through threads for duplicate checking and continuity.

#### `list_eligible_teams`

Returns teams capable of handling a proposed task. It includes team capabilities and availability summary but not a tool-controlled choice of named staff.

### Write and verification tools

#### `create_task_draft`

Creates or returns a non-actionable draft after validating patient scope, evidence, team capability, and likely duplicates. It accepts an idempotency key and returns the draft version/content hash needed for approval.

#### `publish_team_task`

Publishes an exact approved draft. It requires the approval proof, expected version, and idempotency key. A repeated request returns the original committed result rather than creating a duplicate.

#### `get_task`

Reads the authoritative task state after publication. The agent uses it as a read-after-write verification step so a network response is not mistaken for a committed action.

### Explicitly unavailable to the agent

The agent cannot:

- approve, accept, complete, or verify its own task;
- choose a named staff member;
- advance the clock;
- run generic SQL;
- delete ledger or audit records;
- perform arbitrary EHR mutation;
- read a different patient's data.

## Non-MCP integration contracts

The MCP interface is for agent reasoning and narrow actions. Other actors use ordinary authenticated APIs.

### Pipeline and dictation commands

- submit encounter evidence or a candidate signal;
- submit a clinician correction;
- request approval for an exact draft;
- submit authenticated approval or dismissal;
- submit a clinician-created task from dictation.

### Human workflow commands

- accept an offered or assigned task;
- decline an assigned task;
- reassign or escalate a task with reason;
- mark work completed with an outcome reference.

### Queries and event consumption

- fetch a patient thread and its tasks;
- fetch a team queue sorted by operational priority;
- fetch the current task state and activity history;
- subscribe to safe domain events with reconnection from the last event ID.

All cross-workstream messages use a versioned envelope:

```json
{
  "schemaVersion": "1",
  "eventId": "evt_...",
  "eventType": "task.published_to_team",
  "occurredAt": "2026-08-20T10:00:00Z",
  "correlationId": "corr_...",
  "patientId": "synthetic-karen",
  "interactionId": "int_...",
  "contextId": "ctx_...",
  "actor": { "type": "clinician", "id": "clinician-1" },
  "payload": {}
}
```

Schemas are versioned and shared with the pipeline and UI workstreams as fixtures. Consumers must ignore additive unknown fields and reject unsupported major schema versions.

## Audit trail for the visual action trail

The UI team may create a visual trail of actions. This workstream does not implement that presentation. It emits durable, safe events that make it possible:

- `encounter.signal_received`
- `agent.investigation_started`
- `record.context_retrieved`
- `record.open_threads_checked`
- `task.draft_created`
- `task.draft_corrected`
- `task.draft_dismissed`
- `task.approval_requested`
- `task.approved`
- `task.published_to_team`
- `task.publish_verified`
- `task.member_accepted`
- `task.member_declined`
- `task.operational_priority_recalculated`
- `task.team_acceptance_timed_out`
- `task.member_assigned`
- `task.completed`
- `task.completion_verified`
- `task.escalated`
- `thread.state_changed`

These events describe observable inputs, tool calls, validations, decisions, and state transitions. They do not contain chain-of-thought or hidden model reasoning. Human-facing “why” text is limited to evidence references, policy results, and concise generated rationale.

## End-to-end flows

### Happy path

1. Ambient capture supplies the Karen signal and transcript evidence reference.
2. The Corti agent starts an investigation in the mapped context.
3. It calls `get_patient_context`, `list_open_threads`, and `list_eligible_teams`.
4. It calls `create_task_draft` for a district-nursing blood-pressure check.
5. The clinician approves the exact medium-urgency, 48-hour proposal.
6. The agent calls `publish_team_task` and then `get_task`.
7. A district nurse accepts the team offer.
8. The mock downstream workflow records completion.
9. A separate readback confirms the completion and changes the task and thread to verified.

### No team member accepts

1. The clinician approves and the task enters `offered_to_team`.
2. The controlled clock passes the 30-minute medium-urgency `acceptBy` time.
3. The router recalculates priority and atomically assigns the best eligible district nurse.
4. If no candidate exists, the task is escalated while remaining visible to the team and human reviewer.

### Agent misses the concern

1. The doctor dictates the missing blood-pressure task.
2. The agent structures and duplicate-checks it.
3. The doctor confirms the resulting draft.
4. It is published and tracked exactly like an agent-suggested task.

### Work is not verified by the deadline

1. A member accepts the task, but no valid completion can be read back by `dueBy`.
2. The system raises operational priority and emits an escalation with the failed-verification reason.
3. The task remains recoverable through human completion, correction, or reassignment.

## Failure handling and safety

| Failure | Required behavior |
|---|---|
| Corti agent stalls or errors | Preserve the encounter signal, publish nothing, allow a bounded retry or manual task |
| Record lookup fails | Return an explicit retryable error; never display “nothing found” |
| Approval is stale or mismatched | Leave the draft non-actionable and request fresh confirmation |
| Publish response is lost | Resolve the idempotency key and return the already committed result |
| Two members accept simultaneously | Commit one atomic owner; return current ownership to the second caller |
| No member is eligible | Retain team ownership and escalate for human review |
| Router runs twice or restarts | Use optimistic versions and rescan due tasks safely on startup |
| Event connection drops | Resume after the last event ID and refresh current state |
| Patient/context scope mismatches | Deny by default without leaking another patient's existence |
| Evidence, team, or transition is invalid | Return a structured validation error with no partial write |
| Tunnel or MCP is unavailable | Preserve all existing state and allow later retry/manual continuation |

Additional controls:

- Corti credentials remain server-side.
- The MCP endpoint uses a narrow bearer credential and exposes only the defined tools.
- Logs omit raw transcripts by default and use synthetic identifiers in the demo.
- Every mutation requires actor attribution, expected version, and an idempotency key.
- Agent streaming uses a generous idle timeout and supports cancellation rather than assuming a short HTTP response.
- The demo clock is disabled outside an explicitly configured demo environment.

## Testing strategy

### Deterministic automated tests

- every permitted and forbidden task/thread state transition;
- approval proof binding, expiry, invalidation after correction, and replay protection;
- operational-priority calculations at boundary times;
- routing by capability, availability, workload, and stable tie-break;
- atomic concurrent acceptance;
- idempotent draft and publish commands;
- startup rescan and restart durability using SQLite;
- patient/context authorization and information-leak prevention;
- event/outbox creation in the same transaction as state change;
- clock advancement and time-triggered behavior.

### Contract and integration tests

- MCP Inspector can list and call every tool with valid and invalid payloads.
- Pipeline fixtures create the exact expected encounter signal and context mapping.
- UI fixtures receive versioned state and event envelopes without needing the backend UI implementation.
- A real Corti smoke test reaches the tunneled MCP server, shows visible tool activity, and preserves the application mapping between `interactionId` and `contextId`.

### Five executable demo scenarios

1. **Happy path:** suggest, approve, publish, accept, complete, read back, and verify Karen's task.
2. **Human recovery:** the agent misses the task and the clinician creates it manually by dictation.
3. **Timeout routing:** nobody accepts; the clock advances; the router assigns a named eligible member.
4. **Acceptance race:** two members accept at once; exactly one wins.
5. **Lost response:** publication commits but its response is lost; retry/readback finds exactly one task.

### Acceptance gates

- Deterministic tests pass from a clean checkout.
- MCP Inspector demonstrates valid calls and safe validation failures.
- Corti's agent activity shows a real record lookup, draft creation, approved publication, and readback.
- The complete five-minute demo path runs twice consecutively without database cleanup.
- Every demonstrated automation failure has a visible manual recovery path.

## Delivery sequence for the hackathon

### Hours 0–2: contracts and domain core

- Freeze shared event/command schemas and fixtures.
- Implement the ledger state machine, approval model, database schema, and canonical Karen data.

### Hours 2–6: MCP and deterministic operations

- Implement Patient Record and Task Ledger MCP tools.
- Implement the team directory, router, priority policy, clock, and audit outbox.
- Validate the server with MCP Inspector.

### Hours 6–10: real Corti integration

- Expose the local service through public HTTPS.
- Configure one Corti agent with the MCP gateway.
- Prove context mapping and the real tool-call sequence.

### Hours 10–18: parallel integration

- Give stable fixtures and endpoints to the pipeline and UI workstreams.
- Exercise approval, dictation correction, human commands, event consumption, and all five scenarios.

### Hours 18–27: hardening and selective extensions

- Make the canonical path repeatable and polish failure recovery.
- If and only if the acceptance gates remain green, add extensions in this order:
  1. shared hosted deployment;
  2. richer shift and availability data;
  3. GP medication-review task as a second child of Karen's thread;
  4. semantic/RAG record retrieval;
  5. FHIR adapters or separated MCP services.

## Team boundaries

### Agentic and MCP workstream owns

- Corti agent configuration and prompts;
- MCP server and tool contracts;
- domain state machine and SQLite persistence;
- approvals, idempotency, routing, priority, clock, and audit events;
- integration fixtures and executable scenarios.

### Pipeline workstream owns

- ambient and dictation capture;
- conversion of Corti outputs into the agreed encounter/correction commands;
- medical coding and documentation work outside this service;
- preserving evidence references required by task drafts.

### UI workstream owns

- rail, board, controls, rings, and visual action trail;
- rendering state and events without inventing clinical status;
- authenticated approval and human task actions through the defined APIs.

The contracts, synthetic identifiers, and scenario fixtures are shared. Any contract change is versioned and communicated before workstreams rely on it.

## Extensibility

The MVP's local record module can later be replaced by RAG, FHIR, or hospital-specific adapters behind the same patient-scoped interface. The deterministic team directory can later consume rota and workforce systems. SQLite can be replaced with a networked database when multiple replicas are required. Internal Record and Ledger modules can become separate MCP servers if independent deployment, security boundaries, or reuse justify the operational cost.

The one-task Karen thread intentionally exercises the one-to-many model. Adding a GP medication-review task later does not change approval, routing, events, or thread derivation; it only introduces a second child with a different team, deadline, and capability requirement.

## Demo truthfulness

The presentation must clearly distinguish real and simulated parts:

- **Real:** Corti Agentic Framework, Corti-to-MCP calls, tool activity, approval enforcement, task ledger, deterministic routing, priority changes, event trail, and read-after-write verification.
- **Simulated:** patient record contents, clinical teams and availability, downstream task system, completion callback/readback, and accelerated time.
- **Not claimed:** live EHR integration, autonomous clinical judgement, verified patient outcome, or discharge-readiness determination.

## References

- [Corti Agentic Framework: Create an agent](https://docs.corti.ai/agentic/agents/create-agent)
- [Corti Agentic Framework: Context and memory](https://docs.corti.ai/agentic/context-memory)
- [Corti Agentic Framework: Core concepts](https://docs.corti.ai/agentic/core-concepts)
- [Corti Agentic Framework: Architecture](https://docs.corti.ai/agentic/architecture)
- [Corti Agentic Framework: Quickstart](https://docs.corti.ai/agentic/quickstart)
- [Corti AI SDK adapter overview](https://docs.corti.ai/sdk/ai-sdk-adapter/overview)
- [Corti examples repository](https://github.com/corticph/corti-examples)
