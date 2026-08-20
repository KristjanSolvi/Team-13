import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHandoverSourceSnapshot,
  handoverRequestHash,
  handoverSourceSnapshotHash,
  handoverSourceSnapshotSchema,
  isHandoverTaskActive,
  renderedHandoverSchema,
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
    [
      { itemId: "record-b", sourceRef: "record:b", text: "Second fact" },
      { itemId: "record-a", sourceRef: "record:a", text: "First fact" },
    ],
    [
      { threadId: "thread-b", version: 2 },
      { threadId: "thread-a", version: 1 },
    ],
    [task("task-b", "accepted", 4), task("task-a", "completed", 3)],
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
    [task("task-a", "completed", 3), task("task-b", "accepted", 4)],
  );
  const leftHash = handoverSourceSnapshotHash(left);

  assert.equal(leftHash, handoverSourceSnapshotHash(right));
  assert.equal(
    leftHash,
    "sha256:34ba6714f29ba11a5ac4927466ef3482b3aa1e57906e8d0a8bd73ee9457fa23d",
  );
  assert.match(leftHash, /^sha256:[a-f0-9]{64}$/);
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

test("request hash uses fixed field order and ignores runtime extras", () => {
  const canonical = {
    patientId: "synthetic-karen",
    requestedBy: "clinician:123",
    reason: "on_demand" as const,
    focus: "Medication changes",
  };
  const reorderedWithExtra = {
    runtimeOnly: "ignored",
    focus: canonical.focus,
    reason: canonical.reason,
    requestedBy: canonical.requestedBy,
    patientId: canonical.patientId,
  };

  assert.equal(
    handoverRequestHash(canonical),
    handoverRequestHash(reorderedWithExtra),
  );
});

test("snapshot builder rejects duplicate identifiers regardless of input order", () => {
  const recordItems = [
    { itemId: "record-a", sourceRef: "record:first", text: "First fact" },
    { itemId: "record-a", sourceRef: "record:second", text: "Second fact" },
  ];
  for (const reordered of [recordItems, recordItems.toReversed()]) {
    assert.throws(() => buildHandoverSourceSnapshot(reordered, [], []), {
      name: "TypeError",
      message: "Duplicate record item ID: record-a",
    });
  }

  const threads = [
    { threadId: "thread-a", version: 1 },
    { threadId: "thread-a", version: 2 },
  ];
  for (const reordered of [threads, threads.toReversed()]) {
    assert.throws(() => buildHandoverSourceSnapshot([], reordered, []), {
      name: "TypeError",
      message: "Duplicate thread ID: thread-a",
    });
  }

  const tasks = [task("task-a", "accepted", 1), task("task-a", "completed", 2)];
  for (const reordered of [tasks, tasks.toReversed()]) {
    assert.throws(() => buildHandoverSourceSnapshot([], [], reordered), {
      name: "TypeError",
      message: "Duplicate task ID: task-a",
    });
  }
});

test("source snapshot schema rejects duplicate persisted identifiers", () => {
  const contentHash = `sha256:${"0".repeat(64)}`;
  const cases = [
    {
      message: "Duplicate record item ID: record-a",
      value: {
        recordItems: [
          { itemId: "record-a", sourceRef: "record:first", contentHash },
          { itemId: "record-a", sourceRef: "record:second", contentHash },
        ],
        threads: [],
        tasks: [],
      },
    },
    {
      message: "Duplicate thread ID: thread-a",
      value: {
        recordItems: [],
        threads: [
          { threadId: "thread-a", version: 1 },
          { threadId: "thread-a", version: 2 },
        ],
        tasks: [],
      },
    },
    {
      message: "Duplicate task ID: task-a",
      value: {
        recordItems: [],
        threads: [],
        tasks: [
          { taskId: "task-a", version: 1 },
          { taskId: "task-a", version: 2 },
        ],
      },
    },
  ];

  for (const { message, value } of cases) {
    const result = handoverSourceSnapshotSchema.safeParse(value);
    assert.equal(result.success, false, message);
    if (!result.success) {
      assert.ok(result.error.issues.some((issue) => issue.message === message));
    }
  }
});

test("source snapshot schema rejects empty or oversized refs and nonpositive versions", () => {
  const contentHash = `sha256:${"0".repeat(64)}`;
  const invalidSnapshots = [
    {
      recordItems: [{ itemId: "", sourceRef: "record:a", contentHash }],
      threads: [],
      tasks: [],
    },
    {
      recordItems: [{ itemId: "record-a", sourceRef: "", contentHash }],
      threads: [],
      tasks: [],
    },
    {
      recordItems: [
        { itemId: "x".repeat(241), sourceRef: "record:a", contentHash },
      ],
      threads: [],
      tasks: [],
    },
    {
      recordItems: [
        { itemId: "record-a", sourceRef: "x".repeat(241), contentHash },
      ],
      threads: [],
      tasks: [],
    },
    {
      recordItems: [],
      threads: [{ threadId: "", version: 1 }],
      tasks: [],
    },
    {
      recordItems: [],
      threads: [{ threadId: "x".repeat(241), version: 1 }],
      tasks: [],
    },
    {
      recordItems: [],
      threads: [{ threadId: "thread-a", version: 0 }],
      tasks: [],
    },
    {
      recordItems: [],
      threads: [],
      tasks: [{ taskId: "", version: 1 }],
    },
    {
      recordItems: [],
      threads: [],
      tasks: [{ taskId: "x".repeat(241), version: 1 }],
    },
    {
      recordItems: [],
      threads: [],
      tasks: [{ taskId: "task-a", version: -1 }],
    },
  ];

  for (const snapshot of invalidSnapshots) {
    assert.equal(
      handoverSourceSnapshotSchema.safeParse(snapshot).success,
      false,
    );
  }
});

test("rendered handover schema rejects whitespace-only display labels", () => {
  const invalidRenderedHandovers = [
    { title: "   ", sections: [], creditsConsumed: 0 },
    {
      title: "Current handover",
      sections: [{ sectionId: "   ", heading: "Situation", statements: [] }],
      creditsConsumed: 0,
    },
    {
      title: "Current handover",
      sections: [{ sectionId: "situation", heading: "   ", statements: [] }],
      creditsConsumed: 0,
    },
  ];

  for (const rendered of invalidRenderedHandovers) {
    assert.equal(renderedHandoverSchema.safeParse(rendered).success, false);
  }
});

test("rendered handover schema returns trimmed display labels", () => {
  const rendered = renderedHandoverSchema.parse({
    title: "  Current handover  ",
    sections: [
      {
        sectionId: "  situation  ",
        heading: "  Situation  ",
        statements: [],
      },
    ],
    creditsConsumed: 0,
  });

  assert.equal(rendered.title, "Current handover");
  assert.equal(rendered.sections[0]?.sectionId, "situation");
  assert.equal(rendered.sections[0]?.heading, "Situation");
});

test("rendered handover schema permits ungrounded statements only in unknowns", () => {
  const valid = renderedHandoverSchema.safeParse({
    title: "Current handover",
    sections: [
      {
        sectionId: "unknowns",
        heading: "Unknowns",
        statements: [
          {
            statement: "The response is not yet documented.",
            sourceRefs: [],
          },
        ],
      },
    ],
    creditsConsumed: 0,
  });
  assert.equal(valid.success, true);

  const unknownWithEvidence = renderedHandoverSchema.safeParse({
    title: "Current handover",
    sections: [
      {
        sectionId: "unknowns",
        heading: "Unknowns",
        statements: [
          {
            statement: "The response is not yet documented.",
            sourceRefs: ["record:medication-1"],
          },
        ],
      },
    ],
    creditsConsumed: 0,
  });
  assert.equal(unknownWithEvidence.success, false);

  const ungroundedClinicalStatement = renderedHandoverSchema.safeParse({
    title: "Current handover",
    sections: [
      {
        sectionId: "situation",
        heading: "Situation",
        statements: [
          {
            statement: "Karen has a recent medication change.",
            sourceRefs: [],
          },
        ],
      },
    ],
    creditsConsumed: 0,
  });
  assert.equal(ungroundedClinicalStatement.success, false);
});
