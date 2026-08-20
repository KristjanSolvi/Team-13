import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHandoverSourceSnapshot,
  handoverSourceSnapshotHash,
  isHandoverTaskActive,
} from "../src/domain/handover.js";
import type { Task } from "../src/domain/types.js";

function task(taskId: string, state: Task["state"], version: number): Task {
  return {
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
  };
}

test("active handover tasks include completed but exclude terminal states", () => {
  assert.equal(isHandoverTaskActive(task("a", "completed", 2)), true);
  assert.equal(isHandoverTaskActive(task("b", "verified", 3)), false);
  assert.equal(isHandoverTaskActive(task("c", "dismissed", 1)), false);
});

test("source snapshot arrays are deterministic under reordered inputs", () => {
  const left = buildHandoverSourceSnapshot(
    [
      { itemId: "a-record", sourceRef: "record:a", text: "Second fact" },
      { itemId: "Z-record", sourceRef: "record:Z", text: "First fact" },
    ],
    [
      { threadId: "a-thread", version: 2 },
      { threadId: "Z-thread", version: 1 },
    ],
    [
      task("a-task", "accepted", 4),
      task("Z-task", "completed", 3),
      task("terminal-task", "verified", 5),
    ],
  );
  const right = buildHandoverSourceSnapshot(
    [
      { itemId: "Z-record", sourceRef: "record:Z", text: "First fact" },
      { itemId: "a-record", sourceRef: "record:a", text: "Second fact" },
    ],
    [
      { threadId: "Z-thread", version: 1 },
      { threadId: "a-thread", version: 2 },
    ],
    [
      task("terminal-task", "dismissed", 5),
      task("Z-task", "completed", 3),
      task("a-task", "accepted", 4),
    ],
  );

  assert.deepEqual(left, right);
  assert.deepEqual(
    left.recordItems.map(({ itemId }) => itemId),
    ["Z-record", "a-record"],
  );
  assert.deepEqual(
    left.threads.map(({ threadId }) => threadId),
    ["Z-thread", "a-thread"],
  );
  assert.deepEqual(
    left.tasks.map(({ taskId }) => taskId),
    ["Z-task", "a-task"],
  );
});

test("snapshot hash is stable and uses the sha256 contract", () => {
  const left = buildHandoverSourceSnapshot(
    [{ itemId: "record-a", sourceRef: "record:a", text: "First fact" }],
    [{ threadId: "thread-a", version: 1 }],
    [task("task-a", "completed", 3)],
  );
  const right = buildHandoverSourceSnapshot(
    [{ itemId: "record-a", sourceRef: "record:a", text: "First fact" }],
    [{ threadId: "thread-a", version: 1 }],
    [task("task-a", "completed", 3)],
  );

  assert.equal(
    handoverSourceSnapshotHash(left),
    handoverSourceSnapshotHash(right),
  );
  assert.match(handoverSourceSnapshotHash(left), /^sha256:[a-f0-9]{64}$/);
});

test("changing record text changes that record's content hash", () => {
  const before = buildHandoverSourceSnapshot(
    [{ itemId: "record-a", sourceRef: "record:a", text: "First fact" }],
    [],
    [],
  );
  const after = buildHandoverSourceSnapshot(
    [{ itemId: "record-a", sourceRef: "record:a", text: "Changed fact" }],
    [],
    [],
  );

  assert.notEqual(
    before.recordItems[0]?.contentHash,
    after.recordItems[0]?.contentHash,
  );
});
