import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { DomainError } from "../src/domain/errors.js";
import type { Member, Task, Team, Thread } from "../src/domain/types.js";
import { seedKaren } from "../src/fixtures/karen.js";
import { openDatabase } from "../src/infra/database.js";
import { type ApprovalRecord, SqliteStore } from "../src/infra/store.js";

const now = "2026-08-20T10:00:00.000Z";

function createStore(t: TestContext): SqliteStore {
  const store = new SqliteStore(openDatabase(":memory:"));
  t.after(() => store.close());
  return store;
}

function createTeam(overrides: Partial<Team> = {}): Team {
  return {
    teamId: "district-nursing",
    name: "District Nursing",
    capabilities: ["blood-pressure"],
    ...overrides,
  };
}

function createMember(overrides: Partial<Member> = {}): Member {
  return {
    memberId: "nurse-a",
    teamId: "district-nursing",
    capabilities: ["blood-pressure"],
    onShift: true,
    available: true,
    openTaskCount: 1,
    capacity: 4,
    tieBreakKey: "a",
    ...overrides,
  };
}

function createThread(overrides: Partial<Thread> = {}): Thread {
  return {
    threadId: "thread-1",
    patientId: "patient-1",
    interactionId: "interaction-1",
    contextId: null,
    summary: "Follow up dizziness",
    evidenceRefs: ["encounter:sentence-42"],
    state: "awaiting_review",
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    taskId: "task-1",
    threadId: "thread-1",
    patientId: "patient-1",
    origin: "agent_suggested",
    summary: "Check blood pressure",
    taskType: "blood-pressure-check",
    evidenceRefs: ["encounter:sentence-42", "record:medication-1"],
    targetTeamId: "district-nursing",
    requiredCapabilities: ["blood-pressure"],
    clinicalUrgency: "medium",
    operationalPriorityScore: 60,
    priorityBreakdown: {
      base: 60,
      deadlinePressure: 0,
      overdue: 0,
      failedOffers: 0,
      total: 60,
      activeTargetAt: "2026-08-20T10:30:00.000Z",
    },
    acceptBy: "2026-08-20T10:30:00.000Z",
    dueBy: "2026-08-22T10:00:00.000Z",
    state: "offered_to_team",
    assignedMemberId: null,
    failedOffers: 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function putTaskPrerequisites(store: SqliteStore): void {
  store.putPatient("patient-1", "Patient One", { synthetic: true });
  store.putTeam(createTeam());
  store.putThread(createThread());
}

test("state and its audit event survive a database restart", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "follow-through-"));
  const databasePath = path.join(directory, "test.sqlite");

  try {
    const firstStore = new SqliteStore(openDatabase(databasePath));
    seedKaren(firstStore, "2026-08-20T10:00:00.000Z");
    firstStore.close();

    const secondStore = new SqliteStore(openDatabase(databasePath));
    try {
      assert.equal(
        secondStore.getPatient("synthetic-karen")?.displayName,
        "Karen Jensen",
      );
      assert.equal(secondStore.listRecordItems("synthetic-karen").length, 2);
      assert.ok(
        secondStore
          .listEvents(0)
          .some((event) => event.eventType === "fixture.seeded"),
      );
    } finally {
      secondStore.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a failed transaction rolls patient state and its event back together", (t) => {
  const store = createStore(t);

  assert.throws(
    () =>
      store.transaction(() => {
        store.putPatient("patient-1", "Patient One", { synthetic: true });
        store.appendEvent({
          eventType: "patient.created",
          occurredAt: now,
          correlationId: "correlation-1",
          patientId: "patient-1",
          interactionId: "interaction-1",
          contextId: null,
          actor: { type: "system", id: "test" },
          payload: { displayName: "Patient One" },
        });
        throw new Error("rollback requested");
      }),
    /rollback requested/,
  );

  assert.equal(store.getPatient("patient-1"), null);
  assert.deepEqual(store.listEvents(0), []);
});

test("nested transactions participate in the outer transaction and restore depth", (t) => {
  const store = createStore(t);

  assert.throws(
    () =>
      store.transaction(() => {
        store.putPatient("patient-1", "Patient One", { synthetic: true });
        store.transaction(() => {
          store.putRecordItem({
            itemId: "item-1",
            patientId: "patient-1",
            itemType: "observation",
            text: "Nested write",
            sourceRef: "record:nested",
            recordedAt: now,
          });
        });
        throw new Error("outer failure");
      }),
    /outer failure/,
  );

  assert.equal(store.getPatient("patient-1"), null);
  assert.deepEqual(store.listRecordItems("patient-1"), []);

  store.transaction(() => {
    store.putPatient("patient-2", "Patient Two", { synthetic: true });
  });
  assert.equal(store.getPatient("patient-2")?.displayName, "Patient Two");
});

test("patient records map JSON and rows while evidence lookup requires every ref", (t) => {
  const store = createStore(t);
  store.putPatient("patient-1", "Original Name", {
    synthetic: true,
    followThroughOwner: null,
  });
  store.putRecordItem({
    itemId: "item-b",
    patientId: "patient-1",
    itemType: "observation",
    text: "Second at same time",
    sourceRef: "record:b",
    recordedAt: "2026-08-20T09:55:00.000Z",
  });
  store.putRecordItem({
    itemId: "item-c",
    patientId: "patient-1",
    itemType: "medication",
    text: "Earlier",
    sourceRef: "record:c",
    recordedAt: "2026-08-18T09:00:00.000Z",
  });
  store.putRecordItem({
    itemId: "item-a",
    patientId: "patient-1",
    itemType: "observation",
    text: "First at same time",
    sourceRef: "record:a",
    recordedAt: "2026-08-20T09:55:00.000Z",
  });

  store.putPatient("patient-1", "Updated Name", {
    synthetic: true,
    followThroughOwner: "nurse-a",
  });

  assert.deepEqual(store.getPatient("patient-1"), {
    patientId: "patient-1",
    displayName: "Updated Name",
    record: { synthetic: true, followThroughOwner: "nurse-a" },
  });
  assert.deepEqual(store.listRecordItems("patient-1"), [
    {
      itemId: "item-c",
      patientId: "patient-1",
      itemType: "medication",
      text: "Earlier",
      sourceRef: "record:c",
      recordedAt: "2026-08-18T09:00:00.000Z",
    },
    {
      itemId: "item-a",
      patientId: "patient-1",
      itemType: "observation",
      text: "First at same time",
      sourceRef: "record:a",
      recordedAt: "2026-08-20T09:55:00.000Z",
    },
    {
      itemId: "item-b",
      patientId: "patient-1",
      itemType: "observation",
      text: "Second at same time",
      sourceRef: "record:b",
      recordedAt: "2026-08-20T09:55:00.000Z",
    },
  ]);
  assert.equal(
    store.hasRecordEvidence("patient-1", ["record:a", "record:c"]),
    true,
  );
  assert.equal(
    store.hasRecordEvidence("patient-1", ["record:a", "record:missing"]),
    false,
  );
  assert.equal(store.hasRecordEvidence("patient-1", []), true);
});

test("teams, members, and context mappings round-trip in stable order", (t) => {
  const store = createStore(t);
  store.putPatient("patient-1", "Patient One", { synthetic: true });
  store.putTeam(
    createTeam({ teamId: "team-z", name: "Z Team", capabilities: [] }),
  );
  store.putTeam(createTeam());
  store.putMember(
    createMember({ memberId: "nurse-b", tieBreakKey: "b", openTaskCount: 2 }),
  );
  store.putMember(
    createMember({
      memberId: "nurse-c",
      tieBreakKey: "a",
      onShift: false,
      available: false,
      capabilities: ["blood-pressure", "home-visit"],
      openTaskCount: 3,
      capacity: 5,
    }),
  );
  store.putMember(createMember());
  store.putContextMapping("context-1", "interaction-1", "patient-1", now);

  assert.deepEqual(store.listTeams(), [
    createTeam(),
    createTeam({
      teamId: "team-z",
      name: "Z Team",
      capabilities: [],
    }),
  ]);
  assert.deepEqual(store.listMembers("district-nursing"), [
    createMember(),
    createMember({
      memberId: "nurse-c",
      tieBreakKey: "a",
      onShift: false,
      available: false,
      capabilities: ["blood-pressure", "home-visit"],
      openTaskCount: 3,
      capacity: 5,
    }),
    createMember({ memberId: "nurse-b", tieBreakKey: "b", openTaskCount: 2 }),
  ]);
  assert.equal(store.patientForContext("context-1"), "patient-1");
  assert.equal(store.patientForContext("missing"), null);
  assert.equal(store.contextForInteraction("interaction-1"), "context-1");
  assert.equal(store.contextForInteraction("missing"), null);
});

test("events map actors, payloads, nullable contexts, and sequence cursors", (t) => {
  const store = createStore(t);
  const first = store.appendEvent({
    eventType: "first",
    occurredAt: now,
    correlationId: "correlation-1",
    patientId: "patient-1",
    interactionId: "interaction-1",
    contextId: null,
    actor: { type: "system", id: "fixture" },
    payload: { count: 1 },
  });
  const second = store.appendEvent({
    eventType: "second",
    occurredAt: "2026-08-20T10:01:00.000Z",
    correlationId: "correlation-2",
    patientId: "patient-1",
    interactionId: "interaction-1",
    contextId: "context-1",
    actor: { type: "clinician", id: "clinician-1" },
    payload: { approved: true },
  });

  assert.equal(first.schemaVersion, "1");
  assert.match(first.eventId, /^[0-9a-f-]{36}$/);
  assert.equal(second.schemaVersion, "1");
  assert.deepEqual(store.listEvents(1), [
    {
      ...second,
      sequence: 2,
    },
  ]);
});

test("threads persist, upsert, and list only open states in stable order", (t) => {
  const store = createStore(t);
  store.putPatient("patient-1", "Patient One", { synthetic: true });
  const threadB = createThread({ threadId: "thread-b" });
  const threadA = createThread({ threadId: "thread-a" });
  store.putThread(
    createThread({
      threadId: "thread-dismissed",
      state: "dismissed",
      createdAt: "2026-08-20T09:00:00.000Z",
    }),
  );
  store.putThread(threadB);
  store.putThread(threadA);
  store.putThread(
    createThread({
      threadId: "thread-verified",
      state: "verified",
      createdAt: "2026-08-20T08:00:00.000Z",
    }),
  );
  const updated = { ...threadA, summary: "Updated summary", version: 2 };
  store.putThread(updated);

  assert.deepEqual(store.getThread("thread-a"), updated);
  assert.equal(store.getThread("missing"), null);
  assert.deepEqual(
    store.listOpenThreads("patient-1").map((thread) => thread.threadId),
    ["thread-a", "thread-b"],
  );
});

test("tasks map every field and use deterministic patient and team ordering", (t) => {
  const store = createStore(t);
  putTaskPrerequisites(store);
  for (const threadId of [
    "thread-a",
    "thread-b",
    "thread-c",
    "thread-d",
    "thread-e",
    "thread-f",
    "thread-g",
  ] as const) {
    store.putThread(createThread({ threadId }));
  }

  const taskB = createTask({
    taskId: "task-b",
    threadId: "thread-b",
    operationalPriorityScore: 80,
    createdAt: "2026-08-20T11:00:00.000Z",
  });
  const taskA = createTask({
    taskId: "task-a",
    threadId: "thread-a",
    operationalPriorityScore: 80,
    createdAt: "2026-08-20T11:00:00.000Z",
  });
  const taskHigher = createTask({
    taskId: "task-higher",
    threadId: "thread-c",
    operationalPriorityScore: 100,
    assignedMemberId: "nurse-a",
    failedOffers: 2,
    version: 3,
    state: "assigned_to_member",
    createdAt: "2026-08-20T12:00:00.000Z",
  });
  const taskDraft = createTask({
    taskId: "task-draft",
    threadId: "thread-d",
    state: "draft",
    createdAt: "2026-08-20T09:00:00.000Z",
  });
  const taskEarlierDue = createTask({
    taskId: "task-earlier-due",
    threadId: "thread-e",
    operationalPriorityScore: 80,
    dueBy: "2026-08-21T10:00:00.000Z",
    createdAt: "2026-08-20T13:00:00.000Z",
  });
  const taskVerified = createTask({
    taskId: "task-verified",
    threadId: "thread-f",
    operationalPriorityScore: 1_000,
    state: "verified",
    createdAt: "2026-08-20T09:30:00.000Z",
  });
  const taskDismissed = createTask({
    taskId: "task-dismissed",
    threadId: "thread-g",
    operationalPriorityScore: 1_000,
    state: "dismissed",
    createdAt: "2026-08-20T09:45:00.000Z",
  });
  store.putTask(taskB);
  store.putTask(taskA);
  store.putTask(taskHigher);
  store.putTask(taskDraft);
  store.putTask(taskEarlierDue);
  store.putTask(taskVerified);
  store.putTask(taskDismissed);

  const updatedHigher = {
    ...taskHigher,
    summary: "Updated blood pressure check",
    version: 4,
  };
  store.putTask(updatedHigher);

  assert.deepEqual(store.getTask("task-higher"), updatedHigher);
  assert.equal(store.getTask("missing"), null);
  assert.deepEqual(
    store.listTeamTasks("district-nursing").map((task) => task.taskId),
    ["task-higher", "task-earlier-due", "task-a", "task-b"],
  );
  assert.deepEqual(
    store.listPatientTasks("patient-1").map((task) => task.taskId),
    [
      "task-draft",
      "task-verified",
      "task-dismissed",
      "task-a",
      "task-b",
      "task-higher",
      "task-earlier-due",
    ],
  );
});

test("approvals round-trip and can only be consumed once", (t) => {
  const store = createStore(t);
  putTaskPrerequisites(store);
  store.putTask(createTask());
  const approval: ApprovalRecord = {
    approvalId: "approval-1",
    taskId: "task-1",
    patientId: "patient-1",
    clinicianId: "clinician-1",
    draftVersion: 4,
    draftHash: "sha256:draft",
    approvedAt: now,
    approvalChannel: "conversation",
    expiresAt: "2026-08-20T10:30:00.000Z",
    consumedAt: null,
  };

  store.saveApproval(approval);
  assert.deepEqual(store.getApproval("approval-1"), approval);
  assert.equal(store.getApproval("missing"), null);

  store.consumeApproval("approval-1", "2026-08-20T10:05:00.000Z");
  store.consumeApproval("approval-1", "2026-08-20T10:06:00.000Z");
  assert.equal(
    store.getApproval("approval-1")?.consumedAt,
    "2026-08-20T10:05:00.000Z",
  );
});

test("task commands persist and replay a task without rerunning the operation", (t) => {
  const store = createStore(t);
  putTaskPrerequisites(store);
  let operations = 0;
  const task = createTask();

  const first = store.runTaskCommand("publish", "key-1", now, () => {
    operations += 1;
    store.putTask(task);
    store.appendEvent({
      eventType: "task.published",
      occurredAt: now,
      correlationId: "correlation-1",
      patientId: "patient-1",
      interactionId: "interaction-1",
      contextId: null,
      actor: { type: "clinician", id: "clinician-1" },
      payload: { taskId: task.taskId },
    });
    return task;
  });
  const replay = store.runTaskCommand("publish", "key-1", now, () => {
    operations += 1;
    return createTask({ taskId: "unexpected" });
  });

  assert.deepEqual(first, task);
  assert.deepEqual(replay, task);
  assert.equal(operations, 1);
  assert.deepEqual(store.getProcessedCommand("publish", "key-1"), {
    taskId: "task-1",
  });
  assert.equal(store.listEvents(0).length, 1);
});

test("a failed task command rolls operation writes back with no replay row", (t) => {
  const store = createStore(t);
  putTaskPrerequisites(store);

  assert.throws(
    () =>
      store.runTaskCommand("publish", "key-failure", now, () => {
        const task = createTask();
        store.putTask(task);
        store.appendEvent({
          eventType: "task.published",
          occurredAt: now,
          correlationId: "correlation-1",
          patientId: "patient-1",
          interactionId: "interaction-1",
          contextId: null,
          actor: { type: "clinician", id: "clinician-1" },
          payload: { taskId: task.taskId },
        });
        throw new Error("command failure");
      }),
    /command failure/,
  );

  assert.equal(store.getTask("task-1"), null);
  assert.deepEqual(store.listEvents(0), []);
  assert.equal(store.getProcessedCommand("publish", "key-failure"), null);
});

test("a replay whose task is missing reports the canonical domain error", (t) => {
  const store = createStore(t);
  store.saveProcessedCommand(
    "publish",
    "key-missing",
    { taskId: "missing" },
    now,
  );

  let caught: unknown;
  try {
    store.runTaskCommand("publish", "key-missing", now, () =>
      createTask({ taskId: "unexpected" }),
    );
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof DomainError);
  assert.equal(caught.code, "TASK_NOT_FOUND");
  assert.equal(caught.message, "Idempotent task result is unavailable");
  assert.equal(caught.retryable, false);
  assert.equal(caught.status, 404);
});

test("every declared foreign key exists and orphan writes are rejected", (t) => {
  const database = openDatabase(":memory:");
  const store = new SqliteStore(database);
  t.after(() => store.close());

  const tables = [
    "approvals",
    "context_mappings",
    "members",
    "patient_record_items",
    "task_declines",
    "tasks",
    "threads",
  ];
  const foreignKeys = tables.flatMap((childTable) =>
    database
      .prepare(`PRAGMA foreign_key_list(${childTable})`)
      .all()
      .map((row) => ({
        childTable,
        childColumn: String(row.from),
        parentTable: String(row.table),
        parentColumn: String(row.to),
      })),
  );
  foreignKeys.sort((left, right) =>
    `${left.childTable}.${left.childColumn}`.localeCompare(
      `${right.childTable}.${right.childColumn}`,
    ),
  );

  assert.deepEqual(foreignKeys, [
    {
      childTable: "approvals",
      childColumn: "task_id",
      parentTable: "tasks",
      parentColumn: "task_id",
    },
    {
      childTable: "context_mappings",
      childColumn: "patient_id",
      parentTable: "patients",
      parentColumn: "patient_id",
    },
    {
      childTable: "members",
      childColumn: "team_id",
      parentTable: "teams",
      parentColumn: "team_id",
    },
    {
      childTable: "patient_record_items",
      childColumn: "patient_id",
      parentTable: "patients",
      parentColumn: "patient_id",
    },
    {
      childTable: "task_declines",
      childColumn: "task_id",
      parentTable: "tasks",
      parentColumn: "task_id",
    },
    {
      childTable: "tasks",
      childColumn: "patient_id",
      parentTable: "patients",
      parentColumn: "patient_id",
    },
    {
      childTable: "tasks",
      childColumn: "target_team_id",
      parentTable: "teams",
      parentColumn: "team_id",
    },
    {
      childTable: "tasks",
      childColumn: "thread_id",
      parentTable: "threads",
      parentColumn: "thread_id",
    },
    {
      childTable: "threads",
      childColumn: "patient_id",
      parentTable: "patients",
      parentColumn: "patient_id",
    },
  ]);

  assert.throws(
    () =>
      store.putRecordItem({
        itemId: "orphan",
        patientId: "missing-patient",
        itemType: "observation",
        text: "Orphaned evidence",
        sourceRef: "record:orphan",
        recordedAt: now,
      }),
    /FOREIGN KEY constraint failed/,
  );
});
