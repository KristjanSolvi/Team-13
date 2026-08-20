# On-Demand Grounded Patient Handover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an attributable, idempotent API that uses a dedicated Corti agent, a constrained patient-scoped MCP server, and Corti Text Generation to return a current evidence-grounded patient handover without changing clinical task state.

**Architecture:** The integration API orchestrates three synchronous internal calls: the agentic service creates and validates a canonical handover packet, the pipeline renders its narrative through Corti Text Generation, and the agentic service finalizes the render only if its source snapshot is still current. A dedicated Corti handover agent connects to `/mcp/handover`, where task mutation tools do not exist. SQLite stores the request, packet, source snapshot, rendered result, and audit events transactionally.

**Tech Stack:** Node.js 22+, TypeScript 5.9, Express, Zod, SQLite, `@modelcontextprotocol/sdk` 1.30, `@corti/sdk` 5.0, Node test runner, Vitest, Biome.

---

## Scope and sequencing

This is one cross-service vertical slice, not three independent features. Each
task below leaves its affected package compiling and has a focused commit. Do
not start whole-meeting capture in this branch.

Before every task:

```bash
git fetch origin --prune
git log --oneline --left-right HEAD...origin/main --max-count=20
```

If `origin/main` has new commits, stop that task before editing, rebase the clean
feature branch, and rerun the last green test command. Do not merge other feature
branches.

## File map

### Agentic service

- Create `src/domain/handover.ts`: canonical handover schemas, types, active-task
  filtering, source snapshots, and canonical hashes.
- Modify `src/infra/database.ts`: add the durable `handovers` table and indexes.
- Modify `src/infra/store.ts`: typed handover persistence and request lookup.
- Create `src/services/handover-service.ts`: request idempotency, grounding
  validation, snapshot consistency, lifecycle, and audit events.
- Modify `src/services/record-service.ts`: patient-scoped active-task read.
- Create `src/mcp/handover-tools.ts`: five-tool handover-only MCP server.
- Modify `src/mcp/tools.ts`: make `get_task` a pure read.
- Modify `src/mcp/transport.ts`: support an explicit mount path.
- Create `src/agent/handover-prompt.ts`: constrained agent prompt.
- Create `src/agent/handover-runner.ts`: fresh-context agent execution and
  persisted-draft verification.
- Modify `src/agent/runner.ts`: move publication-readback audit to the task
  runner after authoritative state verification.
- Modify `src/agent/corti-gateway.ts`: select the MCP name per dedicated agent.
- Modify `src/config.ts`, `.env.example`, `src/index.ts`, and
  `scripts/provision-agent.ts`: configure, construct, and provision the second
  agent and MCP endpoint.
- Create `src/http/handover-routes.ts`: internal draft/finalize endpoints.
- Modify `src/http/app.ts`: compose the handover service, runner, MCP endpoint,
  and routes.
- Modify `test/support.ts`: build the new dependencies in test harnesses.

### Corti pipeline

- Modify `apps/corti-pipeline/src/contracts.ts`: duplicated wire-safe handover
  packet and render result types.
- Create `apps/corti-pipeline/src/handover.ts`: strict normalization,
  deterministic task rendering, and safety evaluation.
- Modify `apps/corti-pipeline/src/gateway.ts`: handover render gateway contract.
- Modify `apps/corti-pipeline/src/corti-gateway.ts`: bounded Guided Documents
  call for handover narrative.
- Modify `apps/corti-pipeline/src/app.ts`: strict
  `POST /api/corti/handovers/render` route.
- Modify `apps/corti-pipeline/docs/api.md`: public pipeline contract.

### Integration API

- Modify `apps/integration-api/src/contracts.ts`: strict public handover request
  schema; do not add the internal renderer to the public pipeline proxy list.
- Modify `apps/integration-api/src/gateways.ts`: typed agentic draft/finalize and
  pipeline render calls.
- Modify `apps/integration-api/src/service.ts`: draft → render → finalize
  orchestration and replay handling.
- Modify `apps/integration-api/src/app.ts`: attributed public endpoint.
- Modify `apps/integration-api/src/openapi.ts`: machine-readable UI contract.
- Modify `apps/integration-api/README.md`: concise usage example.

### Verification and demo documentation

- Create `test/handover-scenario.test.ts`: deterministic agentic-service
  lifecycle scenario.
- Modify `docs/contracts.md`: service boundaries, error codes, and events.
- Modify `docs/runbook.md`: safe local setup and one-call handover demo.
- Modify `package.json`: add the non-looping local handover smoke command.
- Create `scripts/smoke-handover.ts`: one safe public request with redacted
  output.

## Task 1: Canonical handover domain contract

**Files:**

- Create: `src/domain/handover.ts`
- Create: `test/handover-domain.test.ts`

- [x] **Step 1: Write failing domain tests**

Create `test/handover-domain.test.ts` with focused tests for deterministic
sorting, active task filtering, and hash stability:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHandoverSourceSnapshot,
  handoverSourceSnapshotHash,
  isHandoverTaskActive,
} from "../src/domain/handover.js";
import type { Task } from "../src/domain/types.js";

const task = (taskId: string, state: Task["state"], version: number): Task => ({
  taskId,
  threadId: `thread-${taskId}`,
  patientId: "synthetic-karen",
  origin: "agent_suggested",
  summary: "Check blood pressure",
  taskType: "blood-pressure",
  evidenceRefs: ["encounter:sentence-42"],
  targetTeamId: "district-nursing",
  requiredCapabilities: ["blood-pressure"],
  clinicalUrgency: "medium",
  operationalPriorityScore: 50,
  priorityBreakdown: {
    base: 50,
    deadlinePressure: 0,
    overdue: 0,
    failedOffers: 0,
    total: 50,
    activeTargetAt: "2026-08-20T12:00:00.000Z",
  },
  acceptBy: "2026-08-20T12:00:00.000Z",
  dueBy: "2026-08-22T10:00:00.000Z",
  state,
  assignedMemberId: null,
  failedOffers: 0,
  version,
  createdAt: "2026-08-20T10:00:00.000Z",
  updatedAt: "2026-08-20T10:00:00.000Z",
});

test("active handover tasks include completed but exclude terminal states", () => {
  assert.equal(isHandoverTaskActive(task("a", "completed", 2)), true);
  assert.equal(isHandoverTaskActive(task("b", "verified", 3)), false);
  assert.equal(isHandoverTaskActive(task("c", "dismissed", 1)), false);
});

test("source snapshot and hash are stable across input ordering", () => {
  const left = buildHandoverSourceSnapshot(
    [
      { itemId: "record-b", sourceRef: "record:b", text: "Second fact" },
      { itemId: "record-a", sourceRef: "record:a", text: "First fact" },
    ],
    [
      { threadId: "thread-b", version: 2 },
      { threadId: "thread-a", version: 1 },
    ],
    [task("b", "accepted", 4), task("a", "completed", 3)],
  );
  const right = buildHandoverSourceSnapshot(
    [
      { itemId: "record-a", sourceRef: "record:a", text: "First fact" },
      { itemId: "record-b", sourceRef: "record:b", text: "Second fact" },
    ],
    [
      { threadId: "thread-a", version: 1 },
      { threadId: "thread-b", version: 2 },
    ],
    [task("a", "completed", 3), task("b", "accepted", 4)],
  );
  assert.deepEqual(left, right);
  assert.equal(handoverSourceSnapshotHash(left), handoverSourceSnapshotHash(right));
  assert.match(handoverSourceSnapshotHash(left), /^sha256:[a-f0-9]{64}$/);
  const changed = buildHandoverSourceSnapshot(
    [{ itemId: "record-a", sourceRef: "record:a", text: "Changed fact" }],
    [],
    [],
  );
  assert.notEqual(
    changed.recordItems[0]?.contentHash,
    left.recordItems.find((item) => item.itemId === "record-a")?.contentHash,
  );
});
```

- [x] **Step 2: Run the focused test and confirm RED**

Run:

```bash
npx tsx --test test/handover-domain.test.ts
```

Expected: failure because `src/domain/handover.ts` does not exist.

- [x] **Step 3: Add the canonical schemas and snapshot helpers**

Create `src/domain/handover.ts`. Export these exact public contracts and use Zod
schemas as the JSON boundary:

```ts
import { createHash } from "node:crypto";
import { z } from "zod";

import type { Task } from "./types.js";

export const handoverReasons = ["assignment", "on_demand"] as const;
export type HandoverReason = (typeof handoverReasons)[number];

export const groundedStatementSchema = z.object({
  statement: z.string().trim().min(1).max(1_000),
  sourceRefs: z.array(z.string().min(1).max(240)).min(1).max(20),
});

export const handoverTaskItemSchema = z.object({
  taskId: z.string().uuid(),
  threadId: z.string().uuid(),
  summary: z.string().min(1).max(240),
  state: z.enum([
    "draft",
    "offered_to_team",
    "assigned_to_member",
    "accepted",
    "completed",
    "escalated",
  ]),
  targetTeamId: z.string().min(1).max(160),
  assignedMemberId: z.string().min(1).max(160).nullable(),
  clinicalUrgency: z.enum(["high", "medium", "routine"]),
  acceptBy: z.string().datetime(),
  dueBy: z.string().datetime(),
  version: z.number().int().positive(),
  sourceRefs: z.array(z.string().min(1).max(240)).min(1).max(20),
});

export const handoverPacketSchema = z.object({
  situation: z.array(groundedStatementSchema).max(20),
  background: z.array(groundedStatementSchema).max(20),
  currentConcerns: z.array(groundedStatementSchema).max(20),
  outstandingTasks: z.array(handoverTaskItemSchema).max(50),
  awaitingVerification: z.array(handoverTaskItemSchema).max(50),
  escalations: z.array(handoverTaskItemSchema).max(50),
  unknowns: z.array(z.string().trim().min(1).max(500)).max(20),
});

export const renderedHandoverSchema = z.object({
  title: z.string().min(1).max(160),
  sections: z.array(z.object({
    sectionId: z.string().min(1).max(80),
    heading: z.string().min(1).max(160),
    statements: z.array(groundedStatementSchema).max(50),
  })).max(10),
  creditsConsumed: z.number().nonnegative(),
});

export const handoverSourceSnapshotSchema = z.object({
  recordItems: z.array(z.object({
    itemId: z.string(),
    sourceRef: z.string(),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })),
  threads: z.array(z.object({ threadId: z.string(), version: z.number().int() })),
  tasks: z.array(z.object({ taskId: z.string(), version: z.number().int() })),
});

export type GroundedStatement = z.infer<typeof groundedStatementSchema>;
export type HandoverTaskItem = z.infer<typeof handoverTaskItemSchema>;
export type HandoverPacket = z.infer<typeof handoverPacketSchema>;
export type RenderedHandover = z.infer<typeof renderedHandoverSchema>;
export type HandoverSourceSnapshot = z.infer<typeof handoverSourceSnapshotSchema>;
export type HandoverStatus = "requested" | "draft" | "rendered" | "failed";

export interface HandoverRecord {
  handoverId: string;
  patientId: string;
  interactionId: string;
  contextId: string | null;
  requestedBy: string;
  reason: HandoverReason;
  focus: string | null;
  correlationId: string;
  idempotencyKey: string;
  requestHash: string;
  status: HandoverStatus;
  version: number;
  packet: HandoverPacket | null;
  rendered: RenderedHandover | null;
  sourceSnapshot: HandoverSourceSnapshot | null;
  sourceSnapshotHash: string | null;
  createdAt: string;
  updatedAt: string;
  generatedAt: string | null;
}

export function isHandoverTaskActive(value: Task): boolean {
  return value.state !== "verified" && value.state !== "dismissed";
}

export function buildHandoverSourceSnapshot(
  recordItems: Array<{ itemId: string; sourceRef: string; text: string }>,
  threads: Array<{ threadId: string; version: number }>,
  tasks: Task[],
): HandoverSourceSnapshot {
  return {
    recordItems: recordItems.map(({ itemId, sourceRef, text }) => ({
      itemId,
      sourceRef,
      contentHash: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    })).toSorted((a, b) => a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0),
    threads: threads.map(({ threadId, version }) => ({ threadId, version }))
      .toSorted((a, b) => a.threadId < b.threadId ? -1 : a.threadId > b.threadId ? 1 : 0),
    tasks: tasks.filter(isHandoverTaskActive)
      .map(({ taskId, version }) => ({ taskId, version }))
      .toSorted((a, b) => a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0),
  };
}

export function handoverSourceSnapshotHash(value: HandoverSourceSnapshot): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function handoverRequestHash(value: {
  patientId: string;
  requestedBy: string;
  reason: HandoverReason;
  focus: string | null;
}): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
```

Use the same code-point comparator for all snapshot arrays; do not use
locale-dependent sorting.

- [x] **Step 4: Run the focused test and root build**

```bash
npx tsx --test test/handover-domain.test.ts
npm run build
```

Expected: both commands pass.

- [x] **Step 5: Commit the domain contract**

```bash
git add src/domain/handover.ts test/handover-domain.test.ts
git commit -m "feat: define grounded handover contract"
```

## Task 2: Durable handover request and result storage

**Files:**

- Modify: `src/infra/database.ts`
- Modify: `src/infra/store.ts`
- Modify: `test/store.test.ts`

- [x] **Step 1: Add failing persistence tests**

Append tests that create a `requested` record, retrieve it by ID and by
`requestedBy + idempotencyKey`, update it to `draft`, close the database, reopen
it, and assert the packet and snapshot survived. Add foreign-key coverage for an
unknown patient and unique-key coverage for concurrent request identity.

Use this persisted shape in the fixture:

```ts
const requestedHandover: HandoverRecord = {
  handoverId: "0d771b25-d46a-4eaf-9529-2dfead81aeba",
  patientId: "synthetic-karen",
  interactionId: "handover:0d771b25-d46a-4eaf-9529-2dfead81aeba",
  contextId: null,
  requestedBy: "clinician-1",
  reason: "assignment",
  focus: "Medication changes",
  correlationId: "corr-handover-1",
  idempotencyKey: "handover-karen-001",
  requestHash: "sha256:request",
  status: "requested",
  version: 1,
  packet: null,
  rendered: null,
  sourceSnapshot: null,
  sourceSnapshotHash: null,
  createdAt: "2026-08-20T10:00:00.000Z",
  updatedAt: "2026-08-20T10:00:00.000Z",
  generatedAt: null,
};
```

- [x] **Step 2: Confirm the store tests fail**

```bash
npm run build
node --test build/test/store.test.js
```

Expected: compile failure because `putHandover`, `getHandover`, and
`getHandoverByRequest` are missing.

- [x] **Step 3: Add the SQLite table**

Add this statement to `openDatabase` after `processed_commands`:

```sql
CREATE TABLE IF NOT EXISTS handovers (
  handover_id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(patient_id),
  interaction_id TEXT NOT NULL UNIQUE,
  context_id TEXT,
  requested_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  focus TEXT,
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  packet_json TEXT,
  rendered_json TEXT,
  source_snapshot_json TEXT,
  source_snapshot_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  generated_at TEXT,
  UNIQUE (requested_by, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_handovers_patient_created
  ON handovers(patient_id, created_at, handover_id);
```

- [x] **Step 4: Add typed store mapping and methods**

Import the handover schemas/types into `src/infra/store.ts`. Add a strict
`mapHandover` that parses nullable JSON with `handoverPacketSchema`,
`renderedHandoverSchema`, and `handoverSourceSnapshotSchema`. Add these methods:

```ts
putHandover(value: HandoverRecord): void
updateHandover(value: HandoverRecord, expectedVersion: number): HandoverRecord
getHandover(handoverId: string): HandoverRecord | null
requireHandover(handoverId: string): HandoverRecord
getHandoverByRequest(requestedBy: string, idempotencyKey: string): HandoverRecord | null
listPatientHandovers(patientId: string): HandoverRecord[]
```

`putHandover` is creation-only. The unique request key remains enforced by
SQLite, not by a check-then-insert race. `updateHandover` requires
`value.version === expectedVersion + 1`, rejects changes to request identity,
and performs a parameterized lifecycle-only update with
`WHERE handover_id = ? AND version = ?`. It may update context, status, packet,
render, snapshot, version, and update/generation timestamps; it preserves
patient, interaction, requester, reason, focus, correlation, idempotency key,
request hash, and creation time. A stale write returns `VERSION_CONFLICT` and
cannot alter the winner.

- [x] **Step 5: Run focused and full store checks**

```bash
npm run build
node --test build/test/store.test.js
npm test
```

Expected: all commands pass and no `.sqlite`, `-wal`, or `-shm` files appear in
the worktree.

- [x] **Step 6: Commit persistence**

```bash
git add src/infra/database.ts src/infra/store.ts test/store.test.ts
git commit -m "feat: persist grounded handovers"
```

## Task 3: Handover lifecycle, grounding, and source consistency

**Files:**

- Create: `src/services/handover-service.ts`
- Create: `test/handover-service.test.ts`
- Modify: `src/services/record-service.ts`

- [x] **Step 1: Write failing service tests**

Cover these concrete cases with an in-memory seeded store and fixed
`DemoClock`:

```ts
test("beginRequest is attributable and rejects changed idempotent content", () => {});
test("a requested handover reports HANDOVER_IN_PROGRESS", () => {});
test("saveDraft validates every narrative evidence reference", () => {});
test("task references cannot support clinical narrative", () => {});
test("saveDraft rejects copied task fields that differ from the ledger", () => {});
test("saveDraft rejects task and record references from another patient", () => {});
test("finalize rejects a changed source snapshot", () => {});
test("finalize saves one exact render idempotently", () => {});
test("a draft replay does not request another agent run", () => {});
```

Use a real Karen task from `LedgerService` so task IDs, states, versions, and
deadlines are authoritative rather than invented test doubles.

- [x] **Step 2: Run the focused test and confirm RED**

```bash
npx tsx --test test/handover-service.test.ts
```

Expected: failure because `HandoverService` does not exist.

- [x] **Step 3: Add the patient-scoped active-task read**

Add this method to `RecordService`:

```ts
listPatientTasks(contextId: string, patientId: string): Task[] {
  this.requirePatient(contextId, patientId);
  return this.store.listPatientTasks(patientId).filter(isHandoverTaskActive);
}
```

Import `Task` and `isHandoverTaskActive`. This method is the only list used by
the handover MCP tool.

- [x] **Step 4: Implement request and snapshot lifecycle**

Create `HandoverService` with this public surface:

```ts
export interface BeginHandoverInput {
  patientId: string;
  requestedBy: string;
  reason: HandoverReason;
  focus: string | null;
  correlationId: string;
  idempotencyKey: string;
}

export interface SaveHandoverDraftInput {
  handoverId: string;
  patientId: string;
  contextId: string;
  packet: HandoverPacket;
}

export class HandoverService {
  constructor(
    private readonly store: SqliteStore,
    private readonly clock: DemoClock,
  ) {}

  beginRequest(input: BeginHandoverInput): {
    handover: HandoverRecord;
    replayed: boolean;
  }

  saveDraft(input: SaveHandoverDraftInput): HandoverRecord

  finalize(
    handoverId: string,
    expectedVersion: number,
    expectedSnapshotHash: string,
    rendered: RenderedHandover,
  ): HandoverRecord

  markRenderRequested(handoverId: string): HandoverRecord

  markFailed(handoverId: string, code: string, retryable: boolean): void

  response(handover: HandoverRecord): Record<string, unknown>
}
```

`beginRequest` must:

1. require the patient;
2. calculate `handoverRequestHash` from patient, requester, reason, and focus;
3. retrieve the unique requester/idempotency record;
4. return `replayed: true` for `draft` or `rendered` with the same hash;
5. throw `HANDOVER_IN_PROGRESS` for the same `requested` row;
6. throw `IDEMPOTENCY_CONFLICT` when the hash differs;
7. throw `HANDOVER_RETRY_REQUIRES_NEW_KEY` for an agent-failed row;
8. insert a `requested` row and `handover.requested` event in one transaction.

`saveDraft` must build the current snapshot, validate the packet, set the mapped
context, move `requested → draft`, increment the version, and append
`handover.draft_saved` in one transaction.

An exact repeat of `saveDraft` against the same draft, context, packet, and
snapshot returns the saved record. A different second packet or context fails
with `HANDOVER_DRAFT_CONFLICT`.

Use this validation split:

```ts
const clinicalRefs = new Set(
  store.listRecordItems(patientId).map((item) => item.sourceRef),
);
const threadRefs = new Set(
  store.listOpenThreads(patientId).map(
    (thread) => `thread:${thread.threadId}@${thread.version}`,
  ),
);
const activeTasks = store.listPatientTasks(patientId).filter(isHandoverTaskActive);
const taskRefs = new Set(
  activeTasks.map((task) => `task:${task.taskId}@${task.version}`),
);
```

Every narrative `sourceRefs` entry must be in `clinicalRefs`. Every task item
must contain its exact `task:<id>@<version>` reference and equal the ledger
projection for summary, thread, state, team, member, urgency, acceptance time,
deadline, and version. Put `completed` tasks only in `awaitingVerification`,
`escalated` tasks only in `escalations`, and all other active states only in
`outstandingTasks`. Reject duplicates across task sections.

`finalize` must rebuild and hash the snapshot before any update. A mismatch
appends `handover.source_changed`, then throws retryable
`HANDOVER_SOURCE_CHANGED` with status 409. An already rendered record replays
only when the expected version, snapshot hash, and rendered JSON match exactly.
It never overwrites a different render. Successful finalization writes the
render and `handover.rendered` event atomically.

`markRenderRequested` accepts only a draft, appends
`handover.render_requested`, and returns the unchanged draft/version. This event
may occur more than once when a saved packet is retried after a renderer outage.

`response` must map safe `handover.*` events for this handover to activity items
containing event type, occurrence time, actor, and non-sensitive payload. It must
never include prompts, credentials, or opaque Corti metadata.

- [x] **Step 5: Run focused and root checks**

```bash
npx tsx --test test/handover-service.test.ts
npm run check
```

Expected: all tests and Biome checks pass.

- [x] **Step 6: Commit the service**

```bash
git add src/services/handover-service.ts src/services/record-service.ts test/handover-service.test.ts
git commit -m "feat: validate grounded handover lifecycle"
```

## Task 4: Dedicated handover MCP surface

**Files:**

- Create: `src/mcp/handover-tools.ts`
- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/transport.ts`
- Modify: `src/http/app.ts`
- Modify: `test/mcp.test.ts`
- Create: `test/handover-mcp.test.ts`

- [x] **Step 1: Write failing MCP contract tests**

Create an in-memory MCP client harness for `createHandoverMcp` and assert the
tool names exactly:

```ts
assert.deepEqual(result.tools.map((tool) => tool.name).toSorted(), [
  "get_patient_context",
  "get_task",
  "list_open_threads",
  "list_patient_tasks",
  "save_handover_draft",
]);
```

Add tests that:

- deny a missing context and another patient's context;
- return active tasks but omit verified and dismissed tasks;
- save one valid packet and replay it idempotently;
- reject unknown clinical evidence and altered task fields;
- prove `create_task_draft` and `publish_team_task` are absent;
- prove repeated `get_task` calls do not create `task.publish_verified` events.

Update the existing publication MCP test to expect zero verification events
from raw `get_task` reads.

- [x] **Step 2: Confirm RED**

```bash
npm run build
node --test build/test/handover-mcp.test.js build/test/mcp.test.js
```

Expected: compile failure because the handover MCP factory is missing and the
old `get_task` side effect still violates the new assertion.

- [x] **Step 3: Make MCP transport path explicit**

Change the signature without breaking the default:

```ts
export function mountMcp(
  router: Router,
  createServer: () => McpServer,
  bearerToken: string,
  routePath = "/mcp",
): void
```

Use `routePath` in the POST, GET, and DELETE registrations. Keep independent
session maps inside each `mountMcp` call so task-agent and handover-agent session
IDs cannot cross endpoints.

- [x] **Step 4: Remove the read side effect from the task MCP**

In `get_task`, keep patient-scope validation and `ledger.getTask(taskId)`, then
return it directly. Remove `task.publish_verified` event emission. Do not alter
the publication tool.

- [x] **Step 5: Implement `createHandoverMcp`**

Register exactly the five tested tools. Reuse the existing structured success
and safe error response pattern. The draft tool schema is:

```ts
{
  handoverId: z.string().uuid(),
  patientId: z.string().min(1).max(160),
  packet: handoverPacketSchema,
}
```

Its handler must first call `records.getPatientContext(contextId, patientId)`,
then call:

```ts
handovers.saveDraft({ handoverId, patientId, contextId, packet });
```

Mark `save_handover_draft` as non-destructive and idempotent, but not read-only.
Do not import `LedgerService` state-changing methods into this file.

- [x] **Step 6: Mount the constrained endpoint**

Add `handovers: HandoverService` to `AppDependencies`, then mount:

```ts
mountMcp(
  app,
  () => createHandoverMcp(dependencies.records, dependencies.handovers),
  dependencies.mcpBearerToken,
  "/mcp/handover",
);
```

Keep the existing `/mcp` mount unchanged. Add HTTP tests proving both endpoints
require the bearer and list different tool sets.

- [x] **Step 7: Run MCP and full root checks**

```bash
npm run build
node --test build/test/mcp.test.js build/test/handover-mcp.test.js build/test/http.test.js
npm run check
```

Expected: all tests pass; the task MCP still exposes six tools and the handover
MCP exposes exactly five.

- [x] **Step 8: Commit the constrained MCP server**

```bash
git add src/mcp/handover-tools.ts src/mcp/tools.ts src/mcp/transport.ts src/http/app.ts test/mcp.test.ts test/handover-mcp.test.ts
git commit -m "feat: expose constrained handover MCP"
```

## Task 5: Dedicated Corti handover agent and fresh-context runner

**Files:**

- Create: `src/agent/handover-prompt.ts`
- Create: `src/agent/handover-runner.ts`
- Create: `test/handover-runner.test.ts`
- Modify: `src/agent/runner.ts`
- Modify: `src/agent/corti-gateway.ts`
- Modify: `src/config.ts`
- Modify: `test/config.test.ts`
- Modify: `.env.example`
- Modify: `scripts/provision-agent.ts`
- Modify: `src/index.ts`

- [x] **Step 1: Write failing runner and configuration tests**

Test that every new handover:

- performs a data-free warmup without an existing context;
- maps the returned fresh context to `handover:<handoverId>`;
- labels `focus` as emphasis rather than evidence;
- passes the handover MCP name/token data;
- rejects a mismatched or incomplete Corti result;
- rejects a completed Corti result when no draft was persisted;
- rejects a second draft save;
- emits no task state-changing event.

Add config assertions for:

```ts
handoverMcpName: "follow-through-handover"
handoverMcpPublicUrl: "https://example.test/mcp/handover"
cortiHandoverAgentId: undefined
```

- [x] **Step 2: Confirm RED**

```bash
npm run build
```

Expected: compile failure for the missing runner and config keys.

- [x] **Step 3: Add the handover prompt**

Export `HANDOVER_PROMPT` with this exact behavioral contract:

```ts
export const HANDOVER_PROMPT = `You are the Follow-Through patient handover agent.

Create one concise, current, patient-scoped handover draft. A request focus is emphasis only and is never clinical evidence.

You have exactly five tools:
- get_patient_context
- list_open_threads
- list_patient_tasks
- get_task
- save_handover_draft

Call them in that order, calling get_task once for each returned active task, then save_handover_draft exactly once.

Rules:
- Use only registered record evidence for clinical statements.
- Copy task state, team, member, urgency, acceptBy, dueBy, and version exactly from get_task.
- Put completed tasks under awaitingVerification and escalated tasks under escalations.
- State unavailable information as unknown; never infer that missing data is normal or safe.
- Do not diagnose, recommend treatment, claim discharge readiness, or claim task completion beyond authoritative state.
- You cannot create, publish, approve, assign, accept, complete, verify, dismiss, or reopen work.
- Return safe observable milestones, never hidden reasoning.`;
```

- [x] **Step 4: Implement the fresh-context runner**

Create `HandoverAgentRunner` with:

```ts
export interface GenerateHandoverInput {
  handoverId: string;
  patientId: string;
  reason: HandoverReason;
  focus: string | null;
  idempotencyKey: string;
}

export class HandoverAgentRunner {
  constructor(
    private readonly gateway: AgentGateway,
    private readonly store: SqliteStore,
    private readonly mcpToken: string,
  ) {}

  async generate(input: GenerateHandoverInput): Promise<HandoverRecord>
}
```

`generate` always sends the existing data-free warmup prompt without a
`contextId`, waits for completion, writes a context mapping for
`handover:<handoverId>`, sends the scoped generation request, verifies same
context and completed state, then requires the handover row to be `draft` with
that context. Never reuse `AgentRunner.ensureContext`.

- [x] **Step 5: Move task publication readback auditing into `AgentRunner`**

After `publishApproved` verifies `offered_to_team` and `version + 1`, append one
`task.publish_verified` event there. This preserves the existing publication
audit while keeping the MCP read pure. Adjust the runner test to expect one
event after publication and the MCP test to expect none after arbitrary reads.

- [x] **Step 6: Parameterize the Corti gateway MCP name**

Change the constructor to:

```ts
constructor(
  private readonly agentId: string,
  config: AppConfig,
  mcpName = config.mcpName,
) {
  this.mcpName = mcpName;
}
```

The token data must use the instance MCP name, ensuring the handover bearer is
attached to `follow-through-handover` rather than the task MCP name.

- [x] **Step 7: Add configuration and provisioning**

Add:

```dotenv
HANDOVER_MCP_PUBLIC_URL=
HANDOVER_MCP_NAME=follow-through-handover
CORTI_HANDOVER_AGENT_ID=
```

Parse the URL override as optional. When blank or absent, derive it by appending
`/handover` to `MCP_PUBLIC_URL`'s normalized path, so a task URL ending in `/mcp`
automatically becomes `/mcp/handover`. In `scripts/provision-agent.ts`, create
or update both agents and print only:

```json
{
  "taskAgentId": "agent-task-example",
  "handoverAgentId": "agent-handover-example",
  "taskMcpUrl": "https://follow-through.example/mcp",
  "handoverMcpUrl": "https://follow-through.example/mcp/handover"
}
```

The handover agent definition uses `HANDOVER_PROMPT` and a single MCP server
whose description says it has five patient-scoped, non-actionable handover
tools. Do not run the provisioning script in automated verification.

Construct `HandoverService` unconditionally in `src/index.ts`. Construct
`HandoverAgentRunner` only when `cortiHandoverAgentId` is non-empty, using the
handover MCP name.

- [x] **Step 8: Run focused and full root checks**

```bash
npm run build
node --test build/test/handover-runner.test.js build/test/agent-runner.test.js build/test/config.test.js
npm run check
```

Expected: all pass without a network call or Corti credit use.

- [x] **Step 9: Commit the dedicated agent**

```bash
git add .env.example src/agent/handover-prompt.ts src/agent/handover-runner.ts src/agent/runner.ts src/agent/corti-gateway.ts src/config.ts src/index.ts scripts/provision-agent.ts test/handover-runner.test.ts test/agent-runner.test.ts test/config.test.ts
git commit -m "feat: run handovers through dedicated Corti agent"
```

## Task 6: Agentic handover HTTP contract

**Files:**

- Create: `src/http/handover-routes.ts`
- Modify: `src/http/app.ts`
- Modify: `src/http/routes.ts`
- Modify: `test/support.ts`
- Modify: `test/http.test.ts`

- [x] **Step 1: Write failing HTTP tests**

Cover:

- bearer and `X-Actor-Id` requirements;
- strict reason, focus, and idempotency validation;
- `201` for a new draft and `200` for replay;
- no runner call when a draft/result already exists;
- `503 CORTI_HANDOVER_AGENT_NOT_CONFIGURED` before creating a request row;
- agent failure produces safe error/audit state;
- finalization validates expected version, snapshot hash, and rendered schema;
- source change returns retryable 409;
- response activity contains safe milestones but no source prose or tokens.

The fake runner should call `handovers.saveDraft` so the route test proves the
same postcondition as the real runner.

- [x] **Step 2: Confirm RED**

```bash
npm run build
```

Expected: compile failure because the routes and runner dependency are absent.

- [x] **Step 3: Add internal routes**

Mount these routes under the existing authenticated `/api` router:

```http
POST /api/patients/:patientId/handover-drafts
POST /api/handovers/:handoverId/finalize
GET  /api/handovers/:handoverId
```

The draft request schema is:

```ts
z.object({
  reason: z.enum(handoverReasons),
  focus: z.string().trim().min(1).max(500).nullable().default(null),
  idempotencyKey: z.string().min(8).max(200),
})
```

The finalization schema is:

```ts
z.object({
  expectedVersion: z.number().int().positive(),
  sourceSnapshotHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  rendered: renderedHandoverSchema,
})
```

Return draft envelopes as:

```ts
{
  replayed: boolean,
  lifecycleStatus: "draft" | "rendered",
  handover: handovers.response(record),
}
```

Immediately before returning a `draft` lifecycle envelope, call
`markRenderRequested`. Do not emit that event for an already rendered replay.

`handover.status` in the safe projection is always `"draft"`; add
`renderingStatus: "pending" | "rendered"` for display. The internal
`lifecycleStatus` lets the integration service decide whether rendering is
needed and is stripped from the public response. Do not expose the request hash.
`GET` must enforce that the handover exists and return the same safe response
projection.

Both the draft and finalization routes return this envelope. The safe handover
projection includes `handoverId`, `patientId`, `status`, `renderingStatus`,
`reason`, `requestedBy`, `generatedAt`, `version`, `sourceSnapshotHash`,
`packet`, nullable `rendered`, and `activity`.

- [x] **Step 4: Compose dependencies and test harness**

Add `handovers: HandoverService` and optional `handoverRunner` to
`AppDependencies`. Mount the handover routes from `src/http/routes.ts` after app
authentication is installed. Update `createAppHarness` to create and return the
service even when no live runner is configured.

- [x] **Step 5: Run HTTP and root checks**

```bash
npm run build
node --test build/test/http.test.js build/test/handover-runner.test.js
npm run check
```

Expected: all pass.

- [x] **Step 6: Commit the agentic HTTP boundary**

```bash
git add src/http/handover-routes.ts src/http/app.ts src/http/routes.ts test/support.ts test/http.test.ts
git commit -m "feat: expose internal handover lifecycle"
```

## Task 7: Corti Text Generation handover renderer

**Files:**

- Modify: `apps/corti-pipeline/src/contracts.ts`
- Create: `apps/corti-pipeline/src/handover.ts`
- Create: `apps/corti-pipeline/src/handover.test.ts`
- Modify: `apps/corti-pipeline/src/gateway.ts`
- Modify: `apps/corti-pipeline/src/corti-gateway.ts`
- Modify: `apps/corti-pipeline/src/app.ts`
- Modify: `apps/corti-pipeline/src/app.test.ts`
- Modify: `apps/corti-pipeline/docs/api.md`

- [x] **Step 1: Write RED normalization and safety tests**

Add tests for:

- valid generated narrative grouped into Situation, Background, and Current
  concerns;
- an output source ref not present in the input;
- task/version refs used as narrative clinical evidence;
- generated diagnosis, treatment recommendation, discharge-ready claim, and
  unsupported lifecycle claim;
- deterministic rendering of task state, team, owner, urgency, `acceptBy`, and
  `dueBy` directly from the packet;
- empty or malformed Guided Documents output.

Use a generated candidate shape like:

```ts
[
  {
    section: "situation",
    text: "Karen reports dizziness after the medication change.",
    sourceRefs: ["encounter:sentence-42"],
  },
]
```

- [x] **Step 2: Confirm RED**

```bash
npm --prefix apps/corti-pipeline test -- src/handover.test.ts
```

Expected: failure because `src/handover.ts` is missing.

- [x] **Step 3: Add duplicated wire types and strict normalizer**

In pipeline contracts, duplicate only the cross-process wire shape from
`src/domain/handover.ts`; do not import outside the package. Export:

```ts
export interface RenderHandoverInput {
  handoverId: string;
  patientId: string;
  sourceSnapshotHash: string;
  packet: HandoverPacket;
}

export interface RenderedHandover {
  title: string;
  sections: Array<{
    sectionId: string;
    heading: string;
    statements: Array<{ statement: string; sourceRefs: string[] }>;
  }>;
  creditsConsumed: number;
}
```

In `handover.ts`, parse generated output with Zod, allow narrative source refs
only from the packet's narrative statements, and create task section statements
deterministically. Use the source statement text as the allowed basis for
existing lifecycle checks. Reject these generated patterns unless they occur in
that basis:

```ts
const forbiddenClinicalClaims = [
  /\bdiagnos(?:is|ed)\b/i,
  /\brecommend(?:ed|ation)?\b/i,
  /\b(?:fit|ready|clear) for discharge\b/i,
];
```

Task section text must be built locally with one stable formatter, not accepted
from the model:

```ts
`${task.summary} — state: ${task.state}; team: ${task.targetTeamId}; owner: ${task.assignedMemberId ?? "unassigned"}; urgency: ${task.clinicalUrgency}; accept by: ${task.acceptBy}; due by: ${task.dueBy}.`
```

- [x] **Step 4: Add the gateway method and Corti call**

Extend `CortiGateway`:

```ts
renderHandover(input: RenderHandoverInput): Promise<RenderedHandover>;
```

Implement it with `client.documents.generate`. Send only the three narrative
sections and their refs in context JSON. Use a dynamic template named
`Follow-Through Grounded Patient Handover` whose output schema is an array of
objects with `section`, `text`, and `sourceRefs`. The system instructions must
state that refs are copied verbatim, unknowns are preserved, and no clinical or
operational facts may be added. Pass the raw structured output to the strict
normalizer, then append deterministic task sections.

Do not invoke Text Generation when all three narrative sections are empty. In
that case return only deterministic task and unknown sections with
`creditsConsumed: 0`.

- [x] **Step 5: Add the strict HTTP route**

Add `POST /api/corti/handovers/render`. Validate the complete nested packet,
UUID, patient ID, and snapshot hash before calling the gateway. Add
`/api/corti/handovers/render` to the pipeline API documentation with a complete
request/response example.

- [x] **Step 6: Run pipeline checks**

```bash
npm --prefix apps/corti-pipeline run typecheck
npm --prefix apps/corti-pipeline test
npm --prefix apps/corti-pipeline run build:pipeline
```

Expected: all pass; fake gateway tests use no network or credits.

- [x] **Step 7: Commit the renderer**

```bash
git add apps/corti-pipeline/src/contracts.ts apps/corti-pipeline/src/handover.ts apps/corti-pipeline/src/handover.test.ts apps/corti-pipeline/src/gateway.ts apps/corti-pipeline/src/corti-gateway.ts apps/corti-pipeline/src/app.ts apps/corti-pipeline/src/app.test.ts apps/corti-pipeline/docs/api.md
git commit -m "feat: render grounded handovers with Corti"
```

## Task 8: Public integration orchestration

**Files:**

- Modify: `apps/integration-api/src/contracts.ts`
- Modify: `apps/integration-api/src/gateways.ts`
- Modify: `apps/integration-api/src/service.ts`
- Modify: `apps/integration-api/src/app.ts`
- Modify: `apps/integration-api/src/openapi.ts`
- Modify: `apps/integration-api/test/gateways.test.ts`
- Modify: `apps/integration-api/test/app.test.ts`
- Modify: `apps/integration-api/test/http-boundary.test.ts`
- Modify: `apps/integration-api/README.md`

- [x] **Step 1: Write failing orchestration tests**

Test these exact paths:

1. New request calls agentic draft, pipeline render, and agentic finalize in
   order and returns 201.
2. A rendered replay returns 200 and does not call the pipeline or finalize.
3. A draft replay after render failure calls render/finalize but does not start
   another agent run.
4. Draft failure prevents pipeline and finalize calls.
5. Render failure prevents finalize and propagates a safe retryable error.
6. Finalize source conflict returns retryable 409 without stale content.
7. Missing/malformed actor, reason, focus, and key fail before upstream calls.
8. Gateways forward server credentials only to agentic internal routes, never
   to the pipeline. The internal handover renderer is not added to
   `pipelineProxyPaths` and therefore cannot be invoked through the generic
   public Corti proxy loop.

- [x] **Step 2: Confirm RED**

```bash
npm --prefix apps/integration-api test -- test/app.test.ts test/gateways.test.ts
```

Expected: failures for missing gateway methods and public route.

- [x] **Step 3: Add gateway methods**

Extend `AgenticGateway`:

```ts
createHandoverDraft(
  patientId: string,
  input: { reason: "assignment" | "on_demand"; focus: string | null; idempotencyKey: string },
  meta: RequestMeta,
): Promise<unknown>;

finalizeHandover(
  handoverId: string,
  input: { expectedVersion: number; sourceSnapshotHash: string; rendered: unknown },
  meta: RequestMeta,
): Promise<unknown>;
```

Extend `PipelineGateway` with:

```ts
renderHandover(input: unknown, meta: RequestMeta): Promise<unknown>;
```

The HTTP implementations call the exact internal paths from Task 6 and Task 7.
Agentic calls include its bearer; pipeline calls do not.

- [x] **Step 4: Implement orchestration**

Add:

```ts
async requestHandover(
  patientId: string,
  input: HandoverRequest,
  meta: Required<Pick<RequestMeta, "actorId" | "correlationId">>,
): Promise<{ status: 200 | 201; body: unknown }>
```

Strictly validate the agentic envelope as an object containing `replayed`,
`lifecycleStatus`, and a handover with `handoverId`, public `status`, `version`,
`sourceSnapshotHash`, and `packet`. If `lifecycleStatus` is `rendered`, strip the
internal field and return the handover directly with 200. If it is `draft`, call
`pipeline.renderHandover`, then `agentic.finalizeHandover`. Pass only the
handover ID, patient ID, packet, and snapshot hash to the pipeline. Strip the
finalization envelope and return 200 for replay or 201 for a newly finalized
request.

- [x] **Step 5: Add public route and OpenAPI**

Add:

```http
POST /api/patients/{patientId}/handovers
```

Require the same actor regex as task commands. Parse:

```ts
z.object({
  idempotencyKey: z.string().min(8).max(200),
  reason: z.enum(["assignment", "on_demand"]),
  focus: z.string().trim().min(1).max(500).nullable().default(null),
})
```

Document 200, 201, 400, 403, 409, 502, 503, and 504 responses in OpenAPI. Add
a README curl example with no real bearer value.

- [x] **Step 6: Run integration checks**

```bash
npm --prefix apps/integration-api run typecheck
npm --prefix apps/integration-api test
npm --prefix apps/integration-api run build
```

Expected: all pass with strict orchestration order and no network calls.

- [x] **Step 7: Commit public orchestration**

```bash
git add apps/integration-api/src/contracts.ts apps/integration-api/src/gateways.ts apps/integration-api/src/service.ts apps/integration-api/src/app.ts apps/integration-api/src/openapi.ts apps/integration-api/test/gateways.test.ts apps/integration-api/test/app.test.ts apps/integration-api/test/http-boundary.test.ts apps/integration-api/README.md
git commit -m "feat: orchestrate on-demand patient handovers"
```

## Task 9: End-to-end scenario, contracts, and safe runbook

**Files:**

- Create: `test/handover-scenario.test.ts`
- Modify: `docs/contracts.md`
- Modify: `docs/runbook.md`
- Modify: `package.json` only if a local smoke script is added
- Create: `scripts/smoke-handover.ts`

- [x] **Step 1: Write the deterministic scenario test**

Use the real in-memory agentic app and a fake `AgentGateway`. In its scoped send,
call the same `HandoverService.saveDraft` operation the MCP tool performs. Assert:

1. the returned packet cites Karen's registered encounter evidence;
2. the current blood-pressure task is represented with exact ledger values;
3. finalization succeeds when sources are unchanged;
4. changing the task version before a second finalization produces
   `HANDOVER_SOURCE_CHANGED`;
5. no task state changed during handover generation;
6. the audit event order is requested, context initialized, sources retrieved,
   draft saved, render requested, rendered.

- [x] **Step 2: Run the complete scenario**

```bash
npm run build
node --test build/test/handover-scenario.test.js
```

Expected: pass. If the scenario exposes a contract mismatch, fix the owning
service and retain the end-to-end assertion.

- [x] **Step 3: Document the final contracts**

In `docs/contracts.md`, document:

- public and internal endpoints;
- the five handover MCP tools and separation from task mutation;
- draft/rendered lifecycle;
- source ref rules;
- `HANDOVER_IN_PROGRESS`, `IDEMPOTENCY_CONFLICT`,
  `HANDOVER_SOURCE_CHANGED`, grounding errors, and upstream errors;
- safe event names.

In `docs/runbook.md`, document this local order:

```bash
npm install
npm --prefix apps/corti-pipeline install
npm --prefix apps/integration-api install
npm run check
npm --prefix apps/corti-pipeline run typecheck
npm --prefix apps/corti-pipeline test
npm --prefix apps/integration-api run typecheck
npm --prefix apps/integration-api test
```

Then document tunnel exposure of both `/mcp` and `/mcp/handover`, one manual
`npm run agent:provision`, copying both returned agent IDs into an untracked
`.env`, restarting the agentic service, and making exactly one attributed public
handover POST. Warn that provisioning and the live request use Corti resources
and are never run by the test suite.

- [x] **Step 4: Add the one-call smoke helper**

Create `scripts/smoke-handover.ts` with exactly one POST, no retry loop, and
redacted output:

```ts
const baseUrl = process.env.INTEGRATION_API_BASE_URL ?? "http://127.0.0.1:8790";
const patientId = process.env.HANDOVER_PATIENT_ID ?? "synthetic-karen";
const actorId = process.env.HANDOVER_ACTOR_ID ?? "clinician:demo";
const response = await fetch(
  new URL(`/api/patients/${encodeURIComponent(patientId)}/handovers`, baseUrl),
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-actor-id": actorId,
      "x-correlation-id": "handover-smoke-1",
    },
    body: JSON.stringify({
      idempotencyKey: "handover-smoke-1",
      reason: "on_demand",
      focus: null,
    }),
  },
);
const body: unknown = await response.json();
if (!response.ok || typeof body !== "object" || body === null) {
  throw new Error(`Handover smoke failed with HTTP ${response.status}`);
}
const value = body as Record<string, unknown>;
console.log(JSON.stringify({
  handoverId: value.handoverId,
  patientId: value.patientId,
  status: value.status,
  sourceSnapshotHash: value.sourceSnapshotHash,
}, null, 2));
```

The output is limited to:

```json
{
  "handoverId": "0d771b25-d46a-4eaf-9529-2dfead81aeba",
  "patientId": "synthetic-karen",
  "status": "draft",
  "sourceSnapshotHash": "sha256:0000000000000000000000000000000000000000000000000000000000000000"
}
```

Add `"smoke:handover": "tsx scripts/smoke-handover.ts"` to `package.json`.
Do not print tokens, source prose, prompts, full records, or the full response.

- [x] **Step 5: Run all verification twice where nondeterminism matters**

```bash
git diff --check
npm run check
npm test
npm --prefix apps/corti-pipeline run typecheck
npm --prefix apps/corti-pipeline test
npm --prefix apps/corti-pipeline run build:pipeline
npm --prefix apps/integration-api run typecheck
npm --prefix apps/integration-api test
npm --prefix apps/integration-api run build
git status --short
```

Expected: every command exits 0; the second root test run has the same result;
the worktree contains no database artifacts, secrets, generated build output, or
unrelated UI changes.

- [x] **Step 6: Commit docs and scenario**

```bash
git add test/handover-scenario.test.ts docs/contracts.md docs/runbook.md scripts/smoke-handover.ts package.json
git commit -m "docs: add grounded handover runbook"
```

## Task 10: Review, synchronize with `main`, and merge-ready handoff

**Files:** No planned product changes.

- [ ] **Step 1: Fetch and compare with current main**

```bash
git fetch origin --prune
git log --oneline --left-right HEAD...origin/main --max-count=40
git diff --stat origin/main...HEAD
```

Expected: only this feature's commits appear on the left. If main advanced,
rebase now and rerun every command from Task 9 Step 5.

- [ ] **Step 2: Review the feature boundary**

Inspect:

```bash
git diff --check origin/main...HEAD
git diff --name-status origin/main...HEAD
git status --short --branch
```

Expected: no whole-meeting capture, no UI implementation, no real credentials,
no generated SQLite/build files, and no changes from unfinished feature
branches.

- [ ] **Step 3: Verify the no-mutation guarantee**

Run the dedicated MCP and scenario tests again and inspect the registered tool
names:

```bash
npm run build
node --test build/test/handover-mcp.test.js build/test/handover-scenario.test.js
```

Expected: the handover MCP has five tools, no task mutation tool, and the task
state/version before and after the scenario are identical.

- [ ] **Step 4: Push the completed feature branch**

Only after every verification command is green:

```bash
git push -u origin feature/on-demand-patient-handover
```

Report the pushed commit range, exact test counts, whether a live Corti call was
made, and the current `origin/main` SHA. Merge into `main` through the team's
normal protected-branch workflow, then delete the feature branch only after the
merge is visible on `origin/main`.
