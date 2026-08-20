# Ward Meeting Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a backend-only, live ward-meeting workflow that explicitly scopes transcript evidence to selected patients, creates grounded draft tasks for new commitments, and records existing unresolved work as carry-forward warnings.

**Architecture:** The agentic service owns meeting state, transcript persistence, reconciliation snapshots, and task materialization. A dedicated Corti Agent reads a narrow meeting MCP surface and saves one validated reconciliation. The integration API composes the existing Ambient-session endpoint with the authenticated meeting lifecycle; no new audio implementation or UI is added.

**Tech Stack:** TypeScript 5.9, Node.js 24, Express, SQLite `DatabaseSync`, Zod, Corti SDK 5, MCP SDK 1.30, Node test runner, Vitest, Biome.

---

## File structure

### Agentic service

- Create `src/domain/meeting.ts`: strict meeting, patient-segment, transcript,
  warning, proposal, reconciliation, and response schemas/types.
- Modify `src/infra/database.ts`: meeting, segment, transcript, reconciliation,
  and carry-forward tables plus single-open-segment indexes.
- Modify `src/infra/store.ts`: typed persistence, CAS updates, previous-meeting
  lookup, and scoped source reads.
- Create `src/services/meeting-service.ts`: lifecycle, evidence registration,
  snapshot construction, reconciliation validation, and atomic draft creation.
- Modify `src/services/ledger-service.ts`: allow registered meeting encounter
  evidence through the existing `encounter:` namespace without changing task
  lifecycle.
- Create `src/mcp/meeting-tools.ts`: five scoped reads and one reconciliation
  write.
- Create `src/agent/meeting-prompt.ts`: exact grounding and duplicate rules.
- Create `src/agent/meeting-runner.ts`: fresh context, constrained agent call,
  terminal verification, and durable replay marker.
- Modify `src/agent/definitions.ts`, `src/agent/runtime.ts`, `src/config.ts`,
  `.env.example`, and `scripts/provision-agent.ts`: third agent configuration.
- Create `src/http/meeting-routes.ts`: authenticated internal meeting contract.
- Modify `src/http/app.ts`, `src/http/routes.ts`, and `src/index.ts`: dependency,
  MCP, route, and runtime composition.

### Integration API

- Modify `apps/integration-api/src/contracts.ts`: strict public request schemas.
- Modify `apps/integration-api/src/gateways.ts`: typed Agentic meeting methods and
  Ambient-session call.
- Modify `apps/integration-api/src/service.ts`: start/forward meeting workflow and
  validate all upstream envelopes.
- Modify `apps/integration-api/src/app.ts`: authenticated public routes before
  validation/upstream work.
- Modify `apps/integration-api/src/openapi.ts`: exact meeting schemas and routes.
- Modify `apps/integration-api/src/index.ts`: gateway composition.

### Verification and documentation

- Create `test/meeting-domain.test.ts`, `test/meeting-service.test.ts`,
  `test/meeting-mcp.test.ts`, `test/meeting-runner.test.ts`, and
  `test/meeting-scenario.test.ts`.
- Modify `test/store.test.ts`, `test/http.test.ts`, `test/config.test.ts`, and
  `test/support.ts`.
- Modify `apps/integration-api/src/app.test.ts`, `config.test.ts`, and
  `gateways.test.ts`.
- Modify `docs/contracts.md`, `README.md`, and `docs/corti-handover-runbook.md`.

## Task 1: Meeting domain and durable storage

**Files:**

- Create: `src/domain/meeting.ts`
- Modify: `src/infra/database.ts`
- Modify: `src/infra/store.ts`
- Create: `test/meeting-domain.test.ts`
- Modify: `test/store.test.ts`

- [ ] **Step 1: Write failing domain tests**

Add tests that parse valid records and reject non-final transcript evidence,
uncertain evidence as eligible, duplicate source references, mutable patient
identity, invalid state transitions, and proposal/carry-forward overlap.

```ts
const parsed = patientMeetingSegmentSchema.parse({
  segmentId: randomUUID(),
  meetingId: randomUUID(),
  patientId: "synthetic-karen",
  status: "closed",
  openedBy: "clinician:evelyn",
  openedAt: "2026-08-20T10:01:00.000Z",
  closedAt: "2026-08-20T10:03:00.000Z",
  version: 2,
});
assert.equal(parsed.patientId, "synthetic-karen");
assert.throws(() =>
  meetingTranscriptSchema.parse({
    ...validTranscript,
    isFinal: false,
    eligible: true,
  }),
);
```

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```bash
npm run build
```

Expected: TypeScript `TS2307` for missing `src/domain/meeting.js`.

- [ ] **Step 3: Implement strict meeting schemas**

Define and export these concrete types and schemas:

```ts
export const meetingStatuses = ["recording", "completed", "failed"] as const;
export const patientSegmentStatuses = [
  "recording",
  "closed",
  "reconciling",
  "reconciled",
  "failed",
] as const;
export const carryForwardReasons = [
  "unresolved",
  "not_discussed",
  "overdue",
] as const;

export type WardMeeting = z.infer<typeof wardMeetingSchema>;
export type PatientMeetingSegment = z.infer<typeof patientMeetingSegmentSchema>;
export type MeetingTranscriptEvidence = z.infer<typeof meetingTranscriptSchema>;
export type MeetingReconciliation = z.infer<typeof meetingReconciliationSchema>;
export type CarryForwardWarning = z.infer<typeof carryForwardWarningSchema>;
```

Use `.strict()`, UUID identifiers, immutable patient/meeting identity, ISO
datetimes, positive versions, unique refs, and a refinement requiring
`eligible === false` unless `isFinal === true && audioQuality === "clear"`.

- [ ] **Step 4: Write failing store tests**

Cover restart round-trips, one open segment per meeting, segment patient
immutability, CAS close, no transcript append after close, unscoped transcript
storage, scoped patient reads, previous patient meeting ordering, reconciliation
idempotency, and every new foreign key.

```ts
store.putMeeting(meeting);
store.putPatientMeetingSegment(segment);
assert.throws(
  () => store.putPatientMeetingSegment({ ...other, status: "recording" }),
  /UNIQUE constraint failed/,
);
assert.deepEqual(reopened.listPatientMeetingEvidence(segment.segmentId), [evidence]);
```

- [ ] **Step 5: Add schema and store methods**

Create tables `ward_meetings`, `patient_meeting_segments`,
`meeting_transcript_segments`, `meeting_reconciliations`, and
`meeting_carry_forwards`. Add a partial unique index:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_one_recording_segment
ON patient_meeting_segments(meeting_id)
WHERE status = 'recording';
```

Add typed methods:

```ts
putMeeting(value: WardMeeting): void;
requireMeeting(meetingId: string): WardMeeting;
updateMeeting(value: WardMeeting, expectedVersion: number): WardMeeting;
putPatientMeetingSegment(value: PatientMeetingSegment): void;
requirePatientMeetingSegment(segmentId: string): PatientMeetingSegment;
updatePatientMeetingSegment(value: PatientMeetingSegment, expectedVersion: number): PatientMeetingSegment;
putMeetingTranscript(value: MeetingTranscriptEvidence): void;
listPatientMeetingEvidence(segmentId: string): MeetingTranscriptEvidence[];
getPreviousPatientMeeting(patientId: string, beforeMeetingId: string): PatientMeetingSegment | null;
putMeetingReconciliation(value: MeetingReconciliation): void;
listMeetingCarryForwards(reconciliationId: string): CarryForwardWarning[];
```

Use plain `INSERT` for immutable records and `UPDATE ... WHERE version = ?` for
CAS transitions. Never use `INSERT OR REPLACE` for scoped identities.

- [ ] **Step 6: Run focused and root tests**

```bash
npm run build
node --test build/test/meeting-domain.test.js build/test/store.test.js
npm test
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/domain/meeting.ts src/infra/database.ts src/infra/store.ts \
  test/meeting-domain.test.ts test/store.test.ts
git commit -m "feat: persist ward meeting boundaries"
```

## Task 2: Meeting lifecycle and grounded reconciliation service

**Files:**

- Create: `src/services/meeting-service.ts`
- Modify: `src/services/ledger-service.ts`
- Create: `test/meeting-service.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Cover start, attributed patient selection, unscoped transcript, patient-scoped
final transcript, uncertain transcript ineligibility, close, double-close replay,
completion guard, and exact event ordering.

```ts
const meeting = service.startMeeting({
  wardId: "ward-13",
  interactionId: "interaction-meeting-1",
  idempotencyKey: "meeting-start-0001",
  actor: { type: "clinician", id: "clinician:evelyn" },
  correlationId: "corr-meeting-1",
});
const segment = service.openPatientSegment({
  meetingId: meeting.meetingId,
  patientId: "synthetic-karen",
  expectedMeetingVersion: meeting.version,
  idempotencyKey: "segment-karen-0001",
  actor: { type: "clinician", id: "clinician:evelyn" },
});
assert.equal(segment.status, "recording");
```

- [ ] **Step 2: Verify RED**

```bash
npm run build
```

Expected: `TS2307` for missing `src/services/meeting-service.js`.

- [ ] **Step 3: Implement lifecycle methods**

Create `MeetingService` with:

```ts
startMeeting(input: StartMeetingInput): WardMeeting;
openPatientSegment(input: OpenPatientSegmentInput): PatientMeetingSegment;
appendTranscript(input: AppendMeetingTranscriptInput): MeetingTranscriptEvidence[];
closePatientSegment(input: ClosePatientSegmentInput): PatientMeetingSegment;
completeMeeting(input: CompleteMeetingInput): WardMeetingResponse;
getMeeting(meetingId: string): WardMeetingResponse;
```

Every command uses `store.getProcessedCommand` plus
`store.saveProcessedCommand` inside a transaction, actor and correlation
attribution, expected versions, and one transaction with its audit event.
Closing registers only eligible patient evidence as deterministic
`encounter:meeting-<meetingId>.<segmentId>.<segmentKey>` record items.

- [ ] **Step 4: Write failing reconciliation tests**

Test snapshot inclusion of current evidence, prior patient evidence, latest
rendered handover, and active task versions. Test exact quotes, cross-patient
refs, uncertain refs, stale task/handover/evidence snapshots, duplicate open
tasks, dismissed prior proposals, empty results, atomic rollback, and replay.

```ts
const saved = service.saveReconciliation({
  reconciliationId: request.reconciliationId,
  patientId: "synthetic-karen",
  segmentId: segment.segmentId,
  sourceSnapshotHash: request.sourceSnapshotHash,
  proposals: [groundedPharmacyDraft],
  carryForwards: [{ taskRef: `task:${existing.taskId}@${existing.version}`, reason: "unresolved", sourceRefs: existing.evidenceRefs }],
  idempotencyKey: "reconcile-karen-0001",
  actor: { type: "agent", id: "meeting-agent" },
});
assert.equal(saved.newDraftTasks[0]?.state, "draft");
assert.equal(store.requireTask(existing.taskId).version, existing.version);
```

- [ ] **Step 5: Implement snapshot and atomic save**

Add:

```ts
beginReconciliation(input: BeginMeetingReconciliationInput): ReconciliationRequest;
saveReconciliation(input: SaveMeetingReconciliationInput): MeetingReconciliationResponse;
markReconciliationFailed(input: FailMeetingReconciliationInput): MeetingReconciliationResponse;
```

Build a fixed-order SHA-256 projection. Validate all evidence against stored
patient-scoped exact text. Re-read task and handover versions inside one
`BEGIN IMMEDIATE` transaction. Create proposals via `LedgerService.createDraft`
with `origin: "agent_suggested"`; use existing team eligibility, duplicate,
urgency, deadline, thread, and approval rules. Save carry-forwards without task
mutation. Persist the reconciliation and audit in the same transaction.

- [ ] **Step 6: Run focused and full checks**

```bash
npm run build
node --test build/test/meeting-service.test.js
npm test
npm run lint
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/services/meeting-service.ts src/services/ledger-service.ts \
  test/meeting-service.test.ts
git commit -m "feat: reconcile grounded meeting commitments"
```

## Task 3: Constrained MCP and dedicated Corti Agent

**Files:**

- Create: `src/mcp/meeting-tools.ts`
- Modify: `src/mcp/transport.ts`
- Create: `src/agent/meeting-prompt.ts`
- Create: `src/agent/meeting-runner.ts`
- Modify: `src/agent/definitions.ts`
- Modify: `src/agent/runtime.ts`
- Modify: `src/agent/corti-gateway.ts`
- Modify: `src/config.ts`
- Modify: `.env.example`
- Modify: `scripts/provision-agent.ts`
- Create: `test/meeting-mcp.test.ts`
- Create: `test/meeting-runner.test.ts`
- Modify: `test/config.test.ts`

- [ ] **Step 1: Write failing MCP tests**

Connect a real MCP client through `InMemoryTransport` and assert the exact six
tools, patient/segment scope, read purity, exact source returns, valid empty save,
valid draft/warning save, duplicate/cross-patient/stale rejection, and safe error
payloads.

```ts
assert.deepEqual(
  tools.map((tool) => tool.name).sort(),
  [
    "get_latest_patient_handover",
    "get_meeting_segment",
    "get_previous_patient_meeting",
    "get_task",
    "list_patient_tasks",
    "save_meeting_reconciliation",
  ],
);
```

- [ ] **Step 2: Verify RED and implement MCP surface**

```bash
npm run build
```

Expected: missing `src/mcp/meeting-tools.js`. Implement
`createMeetingReconciliationMcp(records, meetings)` with strict Zod inputs and
the six tools only. Add no publish or task-command tool.

- [ ] **Step 3: Write failing runner and config tests**

Assert a fresh context even when the interaction has an old mapping, exact MCP
URL/name/token, exact prompt grammar, completed-terminal requirement, context
match, durable verification marker, same-key in-progress behavior, safe recovery,
and provisioner output containing three distinct agent IDs.

```ts
assert.match(MEETING_RECONCILIATION_PROMPT, /explicit contiguous quote/i);
assert.match(MEETING_RECONCILIATION_PROMPT, /never publish|cannot publish/i);
assert.match(MEETING_RECONCILIATION_PROMPT, /carry-forward/i);
```

- [ ] **Step 4: Implement runner and provisioning**

Add `MeetingAgentRunner.generate(input)` following `HandoverAgentRunner`'s fresh
context claim and durable verification pattern. Configure:

```ts
CORTI_MEETING_AGENT_ID
CORTI_MEETING_MCP_NAME=follow-through-meeting
MEETING_MCP_PUBLIC_URL
```

Provision a third agent whose MCP server points to `/mcp/meeting`, uses the
existing MCP bearer, and has only the meeting prompt. Do not make a network call
in tests.

- [ ] **Step 5: Run verification**

```bash
npm run build
node --test build/test/meeting-mcp.test.js build/test/meeting-runner.test.js build/test/config.test.js
npm test
npm run lint
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/meeting-tools.ts src/mcp/transport.ts \
  src/agent/meeting-prompt.ts src/agent/meeting-runner.ts \
  src/agent/definitions.ts src/agent/runtime.ts src/agent/corti-gateway.ts \
  src/config.ts .env.example scripts/provision-agent.ts \
  test/meeting-mcp.test.ts test/meeting-runner.test.ts test/config.test.ts
git commit -m "feat: run meeting reconciliation through Corti Agentic"
```

## Task 4: Internal authenticated meeting HTTP lifecycle

**Files:**

- Create: `src/http/meeting-routes.ts`
- Modify: `src/http/app.ts`
- Modify: `src/http/routes.ts`
- Modify: `src/index.ts`
- Modify: `test/http.test.ts`
- Modify: `test/support.ts`

- [ ] **Step 1: Write failing HTTP tests**

Cover bearer/actor before validation, strict request bodies, start, patient
selection, unscoped/scoped final transcript append, close, reconciliation,
complete, GET response, replay, version conflicts, cross-patient evidence,
unverified agent recovery, and safe failures.

```ts
await request(app)
  .post("/api/ward-meetings")
  .set(appHeaders("clinician:evelyn"))
  .send({ wardId: "ward-13", interactionId: "interaction-meeting-1", idempotencyKey: "meeting-start-0001" })
  .expect(201);
```

- [ ] **Step 2: Verify RED**

```bash
npm run build
node --test build/test/http.test.js
```

Expected: meeting routes return 404.

- [ ] **Step 3: Implement routes and runtime wiring**

Mount `/mcp/meeting` with isolated sessions and the existing MCP bearer. Add the
seven internal routes from the design. Inject `MeetingService` and optional
`MeetingAgentRunner` through `AppDependencies`. Return `503
MEETING_AGENT_NOT_CONFIGURED` before creating a reconciliation request when the
runner is absent. Map typed domain errors through the existing safe handler.

- [ ] **Step 4: Run verification and commit**

```bash
npm run build
node --test build/test/http.test.js build/test/meeting-runner.test.js
npm test
npm run lint
git add src/http/meeting-routes.ts src/http/app.ts src/http/routes.ts src/index.ts \
  test/http.test.ts test/support.ts
git commit -m "feat: expose internal ward meeting lifecycle"
```

Expected: all pass and the commit contains only the listed files.

## Task 5: Public integration orchestration

**Files:**

- Modify: `apps/integration-api/src/contracts.ts`
- Modify: `apps/integration-api/src/gateways.ts`
- Modify: `apps/integration-api/src/service.ts`
- Modify: `apps/integration-api/src/app.ts`
- Modify: `apps/integration-api/src/openapi.ts`
- Modify: `apps/integration-api/src/index.ts`
- Modify: `apps/integration-api/src/app.test.ts`
- Modify: `apps/integration-api/src/config.test.ts`
- Modify: `apps/integration-api/src/gateways.test.ts`

- [ ] **Step 1: Write failing gateway and public API tests**

Assert public bearer and actor checks happen before Ambient or Agentic calls;
start calls Ambient once then Agentic once with the exact returned interaction;
the public close operation calls Agentic close and then Agentic reconcile so
drafts are automatic; other lifecycle routes call Agentic only; all upstream
responses are parsed strictly; tokens are not forwarded across trust domains;
4xx/5xx/timeouts map to safe documented errors; and replay statuses remain exact.

```ts
expect(pipeline.createAmbientSession).toHaveBeenCalledWith(
  { encounterIdentifier: "ward-13-meeting-start-0001" },
  { correlationId: expect.any(String), actorId: "clinician:evelyn" },
);
expect(agentic.startWardMeeting).toHaveBeenCalledWith(
  expect.objectContaining({ interactionId: "corti-interaction-1" }),
  expect.objectContaining({ actorId: "clinician:evelyn" }),
);
```

- [ ] **Step 2: Verify RED**

```bash
npm --prefix apps/integration-api test -- --run src/app.test.ts src/gateways.test.ts
```

Expected: missing gateway methods and public routes return 404.

- [ ] **Step 3: Implement strict contracts and gateway methods**

Add typed methods for start, open segment, append transcript, close, reconcile,
complete, and get. Add `PipelineGateway.createAmbientSession`. Use the existing
Agentic service bearer only for internal meeting calls and the pipeline trust
boundary only for Ambient. Never forward the public bearer.

- [ ] **Step 4: Implement service and authenticated routes**

Start orchestration is exactly:

```ts
const ambient = parseAmbientSession(
  await this.pipeline.createAmbientSession(
    { encounterIdentifier: `${input.wardId}-${input.idempotencyKey}` },
    meta,
  ),
);
const meeting = parseMeetingEnvelope(
  await this.agentic.startWardMeeting(
    { ...input, interactionId: ambient.interactionId },
    meta,
  ),
);
return { meeting, ambient };
```

All public `/api/ward-meetings` routes use the existing constant-time integration
bearer guard and `requestMeta` before body parsing or upstream calls. OpenAPI must
define exact nested schemas rather than arbitrary objects.

- [ ] **Step 5: Run integration and repository checks**

```bash
npm --prefix apps/integration-api run typecheck
npm --prefix apps/integration-api test
npm --prefix apps/integration-api run build
npm test
npm run lint
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/integration-api/src/contracts.ts \
  apps/integration-api/src/gateways.ts apps/integration-api/src/service.ts \
  apps/integration-api/src/app.ts apps/integration-api/src/openapi.ts \
  apps/integration-api/src/index.ts apps/integration-api/src/app.test.ts \
  apps/integration-api/src/config.test.ts apps/integration-api/src/gateways.test.ts
git commit -m "feat: orchestrate live ward meeting reconciliation"
```

## Task 6: Deterministic end-to-end scenario and handoff documentation

**Files:**

- Create: `test/meeting-scenario.test.ts`
- Modify: `docs/contracts.md`
- Modify: `README.md`
- Modify: `docs/corti-handover-runbook.md`
- Create: `scripts/smoke-meeting.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing real-service scenario**

Compose the real in-memory app, MeetingService, LedgerService, MCP save path, and
a fake Corti gateway. Record unscoped speech, Karen's current segment, prior
Karen evidence, and one existing task. Assert one new draft, one carry-forward,
no duplicate existing task, exact evidence, no raw audio, task immutability, and
safe event order.

```ts
assert.equal(result.newDraftTasks.length, 1);
assert.equal(result.carryForwards.length, 1);
assert.equal(store.requireTask(existing.taskId).version, existing.version);
assert.deepEqual(
  store.listEvents().map((event) => event.eventType),
  expectedMeetingEventOrder,
);
```

- [ ] **Step 2: Verify RED then complete only missing wiring**

```bash
npm run build
node --test build/test/meeting-scenario.test.js
```

Expected: fail on the first missing end-to-end invariant. Make the smallest
production correction necessary; do not add UI or live network calls.

- [ ] **Step 3: Document exact contracts and smoke procedure**

Document all routes, strict bodies/responses, source-ref grammar, state machine,
automatic-draft versus carry-forward behavior, authentication, errors, MCP mount,
three-agent provisioning output, no-audio-retention rule, and UI handoff. Add
`smoke:meeting` that sends exactly one attributed meeting start/select/transcript/
close/reconcile/complete sequence with no retry loop and prints IDs, states,
draft count, warning count, and credits only.

- [ ] **Step 4: Run final verification twice**

```bash
npm test
npm test
npm run lint
npm --prefix apps/corti-pipeline test
npm --prefix apps/corti-pipeline run typecheck
npm --prefix apps/corti-pipeline run build
npm --prefix apps/integration-api test
npm --prefix apps/integration-api run typecheck
npm --prefix apps/integration-api run build
git diff --check
git status --short
```

Expected: every command passes, no generated database/audio/build artifacts are
staged, and no secret is present.

- [ ] **Step 5: Commit**

```bash
git add test/meeting-scenario.test.ts docs/contracts.md README.md \
  docs/corti-handover-runbook.md scripts/smoke-meeting.ts package.json
git commit -m "docs: add ward meeting reconciliation runbook"
```

## Completion gate

- The meeting lead explicitly selects every patient segment.
- Unscoped speech cannot create patient evidence or tasks.
- Only final clear transcript evidence can support a draft.
- New commitments create existing-ledger `draft` tasks with provisional,
  clinician-editable operational fields.
- Existing work creates carry-forward warnings without task mutation.
- Prior patient meeting evidence, latest handover, and current tasks are included
  in a fixed, stale-safe snapshot.
- The meeting agent has no publish/assign/accept/complete tools.
- All public/internal auth and trust-domain rules hold.
- No UI code, raw audio retention, or live Corti call is introduced.
