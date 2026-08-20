import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { DomainError } from "../src/domain/errors.js";
import {
  buildHandoverSourceSnapshot,
  type HandoverPacket,
  type HandoverRecord,
  type HandoverTaskItem,
  handoverRequestHash,
  handoverSourceSnapshotHash,
  type RenderedHandover,
} from "../src/domain/handover.js";
import type { Task } from "../src/domain/types.js";
import { seedKaren } from "../src/fixtures/karen.js";
import { DemoClock } from "../src/infra/clock.js";
import { openDatabase } from "../src/infra/database.js";
import { SqliteStore } from "../src/infra/store.js";
import { HandoverService } from "../src/services/handover-service.js";
import { LedgerService } from "../src/services/ledger-service.js";
import { RecordService } from "../src/services/record-service.js";

const NOW = "2026-08-20T10:00:00.000Z";
const PATIENT_ID = "synthetic-karen";
const HANDOVER_CONTEXT_ID = "ctx-handover";
const LEDGER_CONTEXT_ID = "ctx-karen";
const BEGIN_INPUT = {
  patientId: PATIENT_ID,
  requestedBy: "clinician-1",
  reason: "on_demand" as const,
  focus: "Medication safety",
  correlationId: "corr-1",
  idempotencyKey: "handover-1",
};

function harness(
  t: TestContext,
  store = new SqliteStore(openDatabase(":memory:")),
  registerCleanup = true,
) {
  if (registerCleanup) t.after(() => store.close());
  seedKaren(store, NOW);
  store.putContextMapping(
    LEDGER_CONTEXT_ID,
    "interaction-karen-1",
    PATIENT_ID,
    NOW,
  );
  const clock = new DemoClock(new Date(NOW), true);
  return {
    store,
    clock,
    service: new HandoverService(store, clock),
    ledger: new LedgerService(
      store,
      clock,
      "approval-secret-with-at-least-32-bytes",
    ),
  };
}

function begin(service: HandoverService) {
  return service.beginRequest(BEGIN_INPUT);
}

function assertDomainError(
  operation: () => unknown,
  code: string,
  status: number,
  retryable = false,
): DomainError {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof DomainError);
  assert.equal(caught.code, code);
  assert.equal(caught.status, status);
  assert.equal(caught.retryable, retryable);
  return caught;
}

function taskItem(task: Task): HandoverTaskItem {
  return {
    taskId: task.taskId,
    threadId: task.threadId,
    summary: task.summary,
    state: task.state as HandoverTaskItem["state"],
    targetTeamId: task.targetTeamId,
    assignedMemberId: task.assignedMemberId,
    clinicalUrgency: task.clinicalUrgency,
    acceptBy: task.acceptBy,
    dueBy: task.dueBy,
    version: task.version,
    sourceRefs: [
      "record:medication-1",
      `thread:${task.threadId}@${task.version}`,
      `task:${task.taskId}@${task.version}`,
    ],
  };
}

function packetFor(
  task: Task,
  section:
    | "outstandingTasks"
    | "awaitingVerification"
    | "escalations" = "outstandingTasks",
): HandoverPacket {
  return {
    situation: [
      {
        statement: "Karen has a recent medication change.",
        sourceRefs: ["record:medication-1"],
      },
    ],
    background: [
      {
        statement: "Dizziness was documented after the change.",
        sourceRefs: ["encounter:sentence-42"],
      },
    ],
    currentConcerns: [],
    outstandingTasks: section === "outstandingTasks" ? [taskItem(task)] : [],
    awaitingVerification:
      section === "awaitingVerification" ? [taskItem(task)] : [],
    escalations: section === "escalations" ? [taskItem(task)] : [],
    unknowns: ["The response to the change is not yet documented."],
  };
}

function prepareRequested(
  t: TestContext,
  store?: SqliteStore,
  registerCleanup = true,
) {
  const setup = harness(t, store, registerCleanup);
  const task = setup.ledger.createKarenDraft(
    LEDGER_CONTEXT_ID,
    `task-${Math.random()}`,
  );
  const requested = begin(setup.service).handover;
  setup.store.putContextMapping(
    HANDOVER_CONTEXT_ID,
    requested.interactionId,
    PATIENT_ID,
    NOW,
  );
  return { ...setup, task, requested, packet: packetFor(task) };
}

function savePreparedDraft(
  t: TestContext,
  store?: SqliteStore,
  registerCleanup = true,
) {
  const setup = prepareRequested(t, store, registerCleanup);
  const draft = setup.service.saveDraft({
    handoverId: setup.requested.handoverId,
    patientId: PATIENT_ID,
    contextId: HANDOVER_CONTEXT_ID,
    packet: setup.packet,
  });
  return { ...setup, draft };
}

function renderedFor(packet: HandoverPacket): RenderedHandover {
  return {
    title: "Karen Jensen handover",
    sections: [
      {
        sectionId: "situation",
        heading: "Situation",
        statements: [
          packet.situation[0] as HandoverPacket["situation"][number],
        ],
      },
      ...(packet.unknowns.length > 0
        ? [
            {
              sectionId: "unknowns",
              heading: "Unknowns",
              statements: packet.unknowns.map((statement) => ({
                statement,
                sourceRefs: [],
              })),
            },
          ]
        : []),
    ],
    creditsConsumed: 1.25,
  };
}

function replacePacketTask(
  packet: HandoverPacket,
  patch: Partial<HandoverTaskItem>,
): HandoverPacket {
  const copy = structuredClone(packet);
  const item = copy.outstandingTasks[0];
  assert.ok(item);
  copy.outstandingTasks[0] = { ...item, ...patch };
  return copy;
}

class AuditFailureStore extends SqliteStore {
  failEventType: string | null = null;

  override appendEvent(
    input: Parameters<SqliteStore["appendEvent"]>[0],
  ): ReturnType<SqliteStore["appendEvent"]> {
    if (input.eventType === this.failEventType) {
      throw new Error(`Injected audit failure: ${input.eventType}`);
    }
    return super.appendEvent(input);
  }
}

class AtomicityHookStore extends SqliteStore {
  beforeNextTransaction: (() => void) | null = null;
  beforeNextUpdate: (() => void) | null = null;

  override transaction<T>(operation: () => T): T {
    const hook = this.beforeNextTransaction;
    this.beforeNextTransaction = null;
    hook?.();
    return super.transaction(operation);
  }

  override updateHandover(
    value: HandoverRecord,
    expectedVersion: number,
  ): HandoverRecord {
    const hook = this.beforeNextUpdate;
    this.beforeNextUpdate = null;
    hook?.();
    return super.updateHandover(value, expectedVersion);
  }
}

function fileStores(): {
  primary: AtomicityHookStore;
  competitor: SqliteStore;
  cleanup: () => void;
} {
  const directory = mkdtempSync(path.join(tmpdir(), "handover-atomicity-"));
  const databasePath = path.join(directory, "test.sqlite");
  const primary = new AtomicityHookStore(openDatabase(databasePath));
  const competitorDatabase = openDatabase(databasePath);
  competitorDatabase.exec("PRAGMA busy_timeout = 0");
  const competitor = new SqliteStore(competitorDatabase);
  return {
    primary,
    competitor,
    cleanup: () => {
      primary.close();
      competitor.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("beginRequest creates an attributable requested handover and safe event", (t) => {
  const { store, service } = harness(t);

  const result = begin(service);

  assert.equal(result.replayed, false);
  assert.equal(result.handover.patientId, "synthetic-karen");
  assert.equal(result.handover.requestedBy, "clinician-1");
  assert.equal(result.handover.status, "requested");
  assert.equal(result.handover.version, 1);
  assert.equal(
    result.handover.interactionId,
    `handover:${result.handover.handoverId}`,
  );
  assert.deepEqual(
    store.requireHandover(result.handover.handoverId),
    result.handover,
  );
  const event = store.listEvents(0).at(-1);
  assert.equal(event?.eventType, "handover.requested");
  assert.deepEqual(event?.actor, { type: "clinician", id: "clinician-1" });
  assert.deepEqual(event?.payload, {
    handoverId: result.handover.handoverId,
    reason: "on_demand",
    focusProvided: true,
    status: "requested",
    version: 1,
  });
  assert.equal(JSON.stringify(event).includes("Medication safety"), false);
});

test("beginRequest rejects a missing patient with the canonical error", (t) => {
  const { service } = harness(t);

  assert.throws(
    () =>
      service.beginRequest({
        patientId: "missing",
        requestedBy: "clinician-1",
        reason: "assignment",
        focus: null,
        correlationId: "corr-missing",
        idempotencyKey: "handover-missing",
      }),
    (error) =>
      error instanceof DomainError &&
      error.code === "PATIENT_NOT_FOUND" &&
      error.status === 404 &&
      error.retryable === false,
  );
});

test("beginRequest enforces idempotency across every lifecycle state", (t) => {
  const { service } = harness(t);
  const requested = begin(service).handover;

  assertDomainError(() => begin(service), "HANDOVER_IN_PROGRESS", 409, true);
  assertDomainError(
    () =>
      service.beginRequest({
        ...BEGIN_INPUT,
        focus: "A different request",
      }),
    "IDEMPOTENCY_CONFLICT",
    409,
  );
  service.markFailed(requested.handoverId, "PIPELINE_DOWN", true);
  assertDomainError(
    () => begin(service),
    "HANDOVER_RETRY_REQUIRES_NEW_KEY",
    409,
  );
});

test("beginRequest replays completed draft and rendered results", (t) => {
  const setup = savePreparedDraft(t);
  const draftReplay = begin(setup.service);
  assert.equal(draftReplay.replayed, true);
  assert.deepEqual(draftReplay.handover, setup.draft);

  const rendered = renderedFor(setup.packet);
  const finalized = setup.service.finalize(
    setup.draft.handoverId,
    setup.draft.version,
    setup.draft.sourceSnapshotHash as string,
    rendered,
  );
  const renderedReplay = begin(setup.service);
  assert.equal(renderedReplay.replayed, true);
  assert.deepEqual(renderedReplay.handover, finalized);
});

test("beginRequest resolves a durable unique-request race through the winner", (t) => {
  class HiddenWinnerStore extends SqliteStore {
    hideNextLookup = true;

    override getHandoverByRequest(
      requestedBy: string,
      idempotencyKey: string,
    ): HandoverRecord | null {
      if (this.hideNextLookup) {
        this.hideNextLookup = false;
        return null;
      }
      return super.getHandoverByRequest(requestedBy, idempotencyKey);
    }
  }

  const store = new HiddenWinnerStore(openDatabase(":memory:"));
  t.after(() => store.close());
  seedKaren(store, NOW);
  const winnerId = "11111111-1111-4111-8111-111111111111";
  const winner: HandoverRecord = {
    handoverId: winnerId,
    patientId: PATIENT_ID,
    interactionId: `handover:${winnerId}`,
    contextId: null,
    requestedBy: BEGIN_INPUT.requestedBy,
    reason: BEGIN_INPUT.reason,
    focus: BEGIN_INPUT.focus,
    correlationId: "durable-winner",
    idempotencyKey: BEGIN_INPUT.idempotencyKey,
    requestHash: handoverRequestHash(BEGIN_INPUT),
    status: "requested",
    version: 1,
    packet: null,
    rendered: null,
    sourceSnapshot: null,
    sourceSnapshotHash: null,
    createdAt: NOW,
    updatedAt: NOW,
    generatedAt: null,
  };
  store.putHandover(winner);
  const service = new HandoverService(store, { now: () => new Date(NOW) });

  assertDomainError(
    () => service.beginRequest(BEGIN_INPUT),
    "HANDOVER_IN_PROGRESS",
    409,
    true,
  );
  assert.deepEqual(store.requireHandover(winnerId), winner);
});

test("saveDraft stores the canonical snapshot and appends only safe events atomically", (t) => {
  const setup = prepareRequested(t);
  const before = setup.store.listEvents(0).length;

  const draft = setup.service.saveDraft({
    handoverId: setup.requested.handoverId,
    patientId: PATIENT_ID,
    contextId: HANDOVER_CONTEXT_ID,
    packet: setup.packet,
  });

  const expectedSnapshot = buildHandoverSourceSnapshot(
    setup.store.listRecordItems(PATIENT_ID),
    setup.store.listOpenThreads(PATIENT_ID),
    setup.store.listPatientTasks(PATIENT_ID),
  );
  assert.equal(draft.status, "draft");
  assert.equal(draft.version, 2);
  assert.deepEqual(draft.packet, setup.packet);
  assert.deepEqual(draft.sourceSnapshot, expectedSnapshot);
  assert.equal(
    draft.sourceSnapshotHash,
    handoverSourceSnapshotHash(expectedSnapshot),
  );
  const events = setup.store.listEvents(0).slice(before);
  assert.deepEqual(
    events.map(({ eventType }) => eventType),
    ["handover.sources_retrieved", "handover.draft_saved"],
  );
  const serialized = JSON.stringify(events);
  for (const prohibited of [
    BEGIN_INPUT.focus,
    "Karen has a recent medication change.",
    setup.task.summary,
    "Amlodipine changed",
    "record:medication-1",
  ]) {
    assert.equal(serialized.includes(prohibited), false, prohibited);
  }
});

test("saveDraft fails closed on absent, unknown, cross-patient, and non-clinical narrative evidence", (t) => {
  const setup = prepareRequested(t);
  setup.store.putPatient("synthetic-other", "Other", { synthetic: true });
  setup.store.putRecordItem({
    itemId: "other-record",
    patientId: "synthetic-other",
    itemType: "observation",
    text: "Other patient prose",
    sourceRef: "record:other-patient",
    recordedAt: NOW,
  });
  const taskRef = `task:${setup.task.taskId}@${setup.task.version}`;
  const invalidRefs = [
    "record:missing",
    "record:other-patient",
    taskRef,
    `thread:${setup.task.threadId}@${setup.task.version}`,
  ];

  for (const sourceRef of invalidRefs) {
    const packet = structuredClone(setup.packet);
    const statement = packet.situation[0];
    assert.ok(statement);
    statement.sourceRefs = [sourceRef];
    assertDomainError(
      () =>
        setup.service.saveDraft({
          handoverId: setup.requested.handoverId,
          patientId: PATIENT_ID,
          contextId: HANDOVER_CONTEXT_ID,
          packet,
        }),
      "HANDOVER_EVIDENCE_NOT_FOUND",
      409,
    );
  }

  const absent = structuredClone(setup.packet) as unknown as {
    situation: Array<{ statement: string; sourceRefs: string[] }>;
  } & HandoverPacket;
  const statement = absent.situation[0];
  assert.ok(statement);
  statement.sourceRefs = [];
  assert.throws(() =>
    setup.service.saveDraft({
      handoverId: setup.requested.handoverId,
      patientId: PATIENT_ID,
      contextId: HANDOVER_CONTEXT_ID,
      packet: absent,
    }),
  );
  assert.equal(
    setup.store.requireHandover(setup.requested.handoverId).status,
    "requested",
  );
});

test("saveDraft requires the exact task reference and rejects stale or foreign task references", (t) => {
  const setup = prepareRequested(t);
  const withoutOwnRef = replacePacketTask(setup.packet, {
    sourceRefs: ["record:medication-1"],
  });
  assertDomainError(
    () =>
      setup.service.saveDraft({
        handoverId: setup.requested.handoverId,
        patientId: PATIENT_ID,
        contextId: HANDOVER_CONTEXT_ID,
        packet: withoutOwnRef,
      }),
    "HANDOVER_EVIDENCE_NOT_FOUND",
    409,
  );

  const staleRef = replacePacketTask(setup.packet, {
    sourceRefs: [
      "record:medication-1",
      `task:${setup.task.taskId}@${setup.task.version}`,
      `task:${setup.task.taskId}@999`,
    ],
  });
  assertDomainError(
    () =>
      setup.service.saveDraft({
        handoverId: setup.requested.handoverId,
        patientId: PATIENT_ID,
        contextId: HANDOVER_CONTEXT_ID,
        packet: staleRef,
      }),
    "HANDOVER_EVIDENCE_NOT_FOUND",
    409,
  );
});

test("saveDraft rejects cross-patient task items and task source references without mutation", (t) => {
  const setup = prepareRequested(t);
  setup.store.putPatient("synthetic-other", "Other Patient", {
    synthetic: true,
  });
  const karenThread = setup.store.requireThread(setup.task.threadId);
  const foreignThread = {
    ...karenThread,
    threadId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    patientId: "synthetic-other",
    interactionId: "interaction-other",
    contextId: null,
    version: 4,
  };
  setup.store.putThread(foreignThread);
  const foreignTask: Task = {
    ...setup.task,
    taskId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    threadId: foreignThread.threadId,
    patientId: foreignThread.patientId,
    version: foreignThread.version,
  };
  setup.store.putTask(foreignTask);
  const foreignTaskRef = `task:${foreignTask.taskId}@${foreignTask.version}`;

  const foreignItemPacket = structuredClone(setup.packet);
  foreignItemPacket.outstandingTasks.push(taskItem(foreignTask));
  assertDomainError(
    () =>
      setup.service.saveDraft({
        handoverId: setup.requested.handoverId,
        patientId: PATIENT_ID,
        contextId: HANDOVER_CONTEXT_ID,
        packet: foreignItemPacket,
      }),
    "HANDOVER_TASK_SET_MISMATCH",
    409,
  );

  const secondRequested = setup.service.beginRequest({
    ...BEGIN_INPUT,
    correlationId: "corr-cross-patient-ref",
    idempotencyKey: "handover-cross-patient-ref",
  }).handover;
  const secondContextId = "ctx-handover-cross-patient-ref";
  setup.store.putContextMapping(
    secondContextId,
    secondRequested.interactionId,
    PATIENT_ID,
    NOW,
  );
  const foreignRefPacket = structuredClone(setup.packet);
  const karenTaskItem = foreignRefPacket.outstandingTasks[0];
  assert.ok(karenTaskItem);
  karenTaskItem.sourceRefs.push(foreignTaskRef);
  assertDomainError(
    () =>
      setup.service.saveDraft({
        handoverId: secondRequested.handoverId,
        patientId: PATIENT_ID,
        contextId: secondContextId,
        packet: foreignRefPacket,
      }),
    "HANDOVER_EVIDENCE_NOT_FOUND",
    409,
  );

  assert.deepEqual(
    setup.store.requireHandover(setup.requested.handoverId),
    setup.requested,
  );
  assert.deepEqual(
    setup.store.requireHandover(secondRequested.handoverId),
    secondRequested,
  );
  const testedHandoverIds = new Set([
    setup.requested.handoverId,
    secondRequested.handoverId,
  ]);
  assert.deepEqual(
    setup.store
      .listEvents(0)
      .filter(
        (event) =>
          testedHandoverIds.has(String(event.payload.handoverId)) &&
          (event.eventType === "handover.sources_retrieved" ||
            event.eventType === "handover.draft_saved"),
      ),
    [],
  );
});

test("saveDraft rejects every copied authoritative task field mismatch", (t) => {
  const setup = prepareRequested(t);
  const mismatches: Array<Partial<HandoverTaskItem>> = [
    { threadId: "22222222-2222-4222-8222-222222222222" },
    { summary: "Altered summary" },
    { state: "accepted" },
    { targetTeamId: "another-team" },
    { assignedMemberId: "another-member" },
    { clinicalUrgency: "high" },
    { acceptBy: "2026-08-20T11:00:00.000Z" },
    { dueBy: "2026-08-23T10:00:00.000Z" },
    { version: setup.task.version + 1 },
  ];

  for (const mismatch of mismatches) {
    assertDomainError(
      () =>
        setup.service.saveDraft({
          handoverId: setup.requested.handoverId,
          patientId: PATIENT_ID,
          contextId: HANDOVER_CONTEXT_ID,
          packet: replacePacketTask(setup.packet, mismatch),
        }),
      "HANDOVER_TASK_MISMATCH",
      409,
    );
  }
  assertDomainError(
    () =>
      setup.service.saveDraft({
        handoverId: setup.requested.handoverId,
        patientId: PATIENT_ID,
        contextId: HANDOVER_CONTEXT_ID,
        packet: replacePacketTask(setup.packet, {
          taskId: "33333333-3333-4333-8333-333333333333",
        }),
      }),
    "HANDOVER_TASK_SET_MISMATCH",
    409,
  );
});

test("saveDraft enforces task section semantics for active states", (t) => {
  const setup = prepareRequested(t);
  const cases: Array<{
    state: Task["state"];
    correct: "outstandingTasks" | "awaitingVerification" | "escalations";
    wrong: "outstandingTasks" | "awaitingVerification" | "escalations";
  }> = [
    { state: "accepted", correct: "outstandingTasks", wrong: "escalations" },
    {
      state: "completed",
      correct: "awaitingVerification",
      wrong: "outstandingTasks",
    },
    { state: "escalated", correct: "escalations", wrong: "outstandingTasks" },
  ];

  for (const { state, correct, wrong } of cases) {
    const current = setup.store.requireTask(setup.task.taskId);
    const changed = { ...current, state, version: current.version + 1 };
    setup.store.putTask(changed);
    const correctPacket = packetFor(changed, correct);
    assertDomainError(
      () =>
        setup.service.saveDraft({
          handoverId: setup.requested.handoverId,
          patientId: PATIENT_ID,
          contextId: HANDOVER_CONTEXT_ID,
          packet: {
            ...correctPacket,
            [correct]: [],
            [wrong]: [taskItem(changed)],
          },
        }),
      "HANDOVER_SECTION_MISMATCH",
      409,
    );
  }
});

test("saveDraft requires every active task exactly once and rejects unknown or terminal tasks", (t) => {
  const omitted = prepareRequested(t);
  const noTasks = {
    ...omitted.packet,
    outstandingTasks: [],
  };
  assertDomainError(
    () =>
      omitted.service.saveDraft({
        handoverId: omitted.requested.handoverId,
        patientId: PATIENT_ID,
        contextId: HANDOVER_CONTEXT_ID,
        packet: noTasks,
      }),
    "HANDOVER_TASK_SET_MISMATCH",
    409,
  );

  const duplicate = prepareRequested(t);
  const duplicated = structuredClone(duplicate.packet);
  duplicated.awaitingVerification = [
    duplicated.outstandingTasks[0] as HandoverTaskItem,
  ];
  assertDomainError(
    () =>
      duplicate.service.saveDraft({
        handoverId: duplicate.requested.handoverId,
        patientId: PATIENT_ID,
        contextId: HANDOVER_CONTEXT_ID,
        packet: duplicated,
      }),
    "HANDOVER_TASK_SET_MISMATCH",
    409,
  );

  const extra = prepareRequested(t);
  const extraPacket = structuredClone(extra.packet);
  extraPacket.outstandingTasks.push({
    ...taskItem(extra.task),
    taskId: "44444444-4444-4444-8444-444444444444",
    sourceRefs: ["task:44444444-4444-4444-8444-444444444444@1"],
  });
  assertDomainError(
    () =>
      extra.service.saveDraft({
        handoverId: extra.requested.handoverId,
        patientId: PATIENT_ID,
        contextId: HANDOVER_CONTEXT_ID,
        packet: extraPacket,
      }),
    "HANDOVER_TASK_SET_MISMATCH",
    409,
  );

  const terminal = prepareRequested(t);
  terminal.store.putTask({ ...terminal.task, state: "verified", version: 2 });
  assertDomainError(
    () =>
      terminal.service.saveDraft({
        handoverId: terminal.requested.handoverId,
        patientId: PATIENT_ID,
        contextId: HANDOVER_CONTEXT_ID,
        packet: terminal.packet,
      }),
    "HANDOVER_TASK_SET_MISMATCH",
    409,
  );
});

test("saveDraft denies wrong patient, context patient, and interaction scope", (t) => {
  const wrongPatient = prepareRequested(t);
  assertDomainError(
    () =>
      wrongPatient.service.saveDraft({
        handoverId: wrongPatient.requested.handoverId,
        patientId: "synthetic-other",
        contextId: HANDOVER_CONTEXT_ID,
        packet: wrongPatient.packet,
      }),
    "PATIENT_SCOPE_DENIED",
    403,
  );

  const wrongContextPatient = prepareRequested(t);
  wrongContextPatient.store.putPatient("synthetic-other", "Other", {});
  wrongContextPatient.store.putContextMapping(
    "ctx-other-patient",
    "interaction-other-patient",
    "synthetic-other",
    NOW,
  );
  assertDomainError(
    () =>
      wrongContextPatient.service.saveDraft({
        handoverId: wrongContextPatient.requested.handoverId,
        patientId: PATIENT_ID,
        contextId: "ctx-other-patient",
        packet: wrongContextPatient.packet,
      }),
    "PATIENT_SCOPE_DENIED",
    403,
  );

  const wrongInteraction = prepareRequested(t);
  wrongInteraction.store.putContextMapping(
    "ctx-other-interaction",
    "interaction-other",
    PATIENT_ID,
    NOW,
  );
  assertDomainError(
    () =>
      wrongInteraction.service.saveDraft({
        handoverId: wrongInteraction.requested.handoverId,
        patientId: PATIENT_ID,
        contextId: "ctx-other-interaction",
        packet: wrongInteraction.packet,
      }),
    "CONTEXT_INTERACTION_MISMATCH",
    403,
  );
});

test("saveDraft exact replay emits nothing while any second draft change conflicts", (t) => {
  const setup = savePreparedDraft(t);
  const eventCount = setup.store.listEvents(0).length;
  assert.deepEqual(
    setup.service.saveDraft({
      handoverId: setup.draft.handoverId,
      patientId: PATIENT_ID,
      contextId: HANDOVER_CONTEXT_ID,
      packet: setup.packet,
    }),
    setup.draft,
  );
  assert.equal(setup.store.listEvents(0).length, eventCount);

  const changedPacket = structuredClone(setup.packet);
  changedPacket.unknowns.push("Changed agent output");
  assertDomainError(
    () =>
      setup.service.saveDraft({
        handoverId: setup.draft.handoverId,
        patientId: PATIENT_ID,
        contextId: HANDOVER_CONTEXT_ID,
        packet: changedPacket,
      }),
    "HANDOVER_DRAFT_CONFLICT",
    409,
  );
  assertDomainError(
    () =>
      setup.service.saveDraft({
        handoverId: setup.draft.handoverId,
        patientId: PATIENT_ID,
        contextId: "ctx-second",
        packet: setup.packet,
      }),
    "HANDOVER_DRAFT_CONFLICT",
    409,
  );
  setup.store.putRecordItem({
    ...(setup.store.listRecordItems(PATIENT_ID)[0] as ReturnType<
      SqliteStore["listRecordItems"]
    >[number]),
    text: "Changed source text",
  });
  assertDomainError(
    () =>
      setup.service.saveDraft({
        handoverId: setup.draft.handoverId,
        patientId: PATIENT_ID,
        contextId: HANDOVER_CONTEXT_ID,
        packet: setup.packet,
      }),
    "HANDOVER_DRAFT_CONFLICT",
    409,
  );
});

test("saveDraft waiter re-reads and replays a durable identical winner", (t) => {
  const { primary, competitor, cleanup } = fileStores();
  t.after(cleanup);
  const setup = prepareRequested(t, primary, false);
  const winnerService = new HandoverService(competitor, setup.clock);
  const input = {
    handoverId: setup.requested.handoverId,
    patientId: PATIENT_ID,
    contextId: HANDOVER_CONTEXT_ID,
    packet: setup.packet,
  };
  let winner: HandoverRecord | null = null;
  primary.beforeNextTransaction = () => {
    winner = winnerService.saveDraft(input);
  };

  const replay = setup.service.saveDraft(input);

  assert.deepEqual(replay, winner);
  assert.deepEqual(
    competitor
      .listEvents(0)
      .filter(
        ({ eventType, payload }) =>
          payload.handoverId === setup.requested.handoverId &&
          (eventType === "handover.sources_retrieved" ||
            eventType === "handover.draft_saved"),
      )
      .map(({ eventType }) => eventType),
    ["handover.sources_retrieved", "handover.draft_saved"],
  );
});

test("finalize waiter re-reads and replays a durable identical winner", (t) => {
  const { primary, competitor, cleanup } = fileStores();
  t.after(cleanup);
  const setup = savePreparedDraft(t, primary, false);
  const winnerService = new HandoverService(competitor, setup.clock);
  const rendered = renderedFor(setup.packet);
  let winner: HandoverRecord | null = null;
  primary.beforeNextTransaction = () => {
    winner = winnerService.finalize(
      setup.draft.handoverId,
      setup.draft.version,
      setup.draft.sourceSnapshotHash as string,
      rendered,
    );
  };

  const replay = setup.service.finalize(
    setup.draft.handoverId,
    setup.draft.version,
    setup.draft.sourceSnapshotHash as string,
    rendered,
  );

  assert.deepEqual(replay, winner);
  assert.equal(
    competitor
      .listEvents(0)
      .filter(
        ({ eventType, payload }) =>
          payload.handoverId === setup.draft.handoverId &&
          eventType === "handover.rendered",
      ).length,
    1,
  );
});

test("audit failures roll draft and rendered state back with their success events", (t) => {
  const draftFailureStore = new AuditFailureStore(openDatabase(":memory:"));
  const draftSetup = prepareRequested(t, draftFailureStore);
  draftFailureStore.failEventType = "handover.draft_saved";

  assert.throws(
    () =>
      draftSetup.service.saveDraft({
        handoverId: draftSetup.requested.handoverId,
        patientId: PATIENT_ID,
        contextId: HANDOVER_CONTEXT_ID,
        packet: draftSetup.packet,
      }),
    /Injected audit failure: handover\.draft_saved/,
  );
  assert.deepEqual(
    draftFailureStore.requireHandover(draftSetup.requested.handoverId),
    draftSetup.requested,
  );
  assert.deepEqual(
    draftFailureStore
      .listEvents(0)
      .filter(({ eventType }) =>
        ["handover.sources_retrieved", "handover.draft_saved"].includes(
          eventType,
        ),
      ),
    [],
  );

  const renderFailureStore = new AuditFailureStore(openDatabase(":memory:"));
  const renderSetup = savePreparedDraft(t, renderFailureStore);
  renderFailureStore.failEventType = "handover.rendered";

  assert.throws(
    () =>
      renderSetup.service.finalize(
        renderSetup.draft.handoverId,
        renderSetup.draft.version,
        renderSetup.draft.sourceSnapshotHash as string,
        renderedFor(renderSetup.packet),
      ),
    /Injected audit failure: handover\.rendered/,
  );
  assert.deepEqual(
    renderFailureStore.requireHandover(renderSetup.draft.handoverId),
    renderSetup.draft,
  );
  assert.equal(
    renderFailureStore
      .listEvents(0)
      .some(({ eventType }) => eventType === "handover.rendered"),
    false,
  );
});

test("outer write lock blocks patient source changes immediately before draft and render CAS", (t) => {
  const { primary, competitor, cleanup } = fileStores();
  t.after(cleanup);
  const setup = prepareRequested(t, primary, false);
  const recordItem = competitor.listRecordItems(PATIENT_ID)[0];
  assert.ok(recordItem);
  const blockedErrors: unknown[] = [];
  primary.beforeNextUpdate = () => {
    try {
      competitor.putRecordItem({
        ...recordItem,
        text: "Competing write before draft CAS",
      });
    } catch (error) {
      blockedErrors.push(error);
    }
  };

  const draft = setup.service.saveDraft({
    handoverId: setup.requested.handoverId,
    patientId: PATIENT_ID,
    contextId: HANDOVER_CONTEXT_ID,
    packet: setup.packet,
  });
  assert.equal(blockedErrors.length, 1);
  assert.ok(blockedErrors[0] instanceof Error);
  assert.equal(draft.status, "draft");

  primary.beforeNextUpdate = () => {
    try {
      competitor.putRecordItem({
        ...recordItem,
        text: "Competing write before render CAS",
      });
    } catch (error) {
      blockedErrors.push(error);
    }
  };
  const finalized = setup.service.finalize(
    draft.handoverId,
    draft.version,
    draft.sourceSnapshotHash as string,
    renderedFor(setup.packet),
  );

  assert.equal(blockedErrors.length, 2);
  assert.ok(blockedErrors[1] instanceof Error);
  assert.equal(finalized.status, "rendered");
  const currentSnapshot = buildHandoverSourceSnapshot(
    primary.listRecordItems(PATIENT_ID),
    primary.listOpenThreads(PATIENT_ID),
    primary.listPatientTasks(PATIENT_ID),
  );
  assert.equal(
    finalized.sourceSnapshotHash,
    handoverSourceSnapshotHash(currentSnapshot),
  );
});

test("finalize renders atomically when sources are unchanged and rejects new source refs", (t) => {
  const setup = savePreparedDraft(t);
  const rendered = renderedFor(setup.packet);
  const finalized = setup.service.finalize(
    setup.draft.handoverId,
    setup.draft.version,
    setup.draft.sourceSnapshotHash as string,
    rendered,
  );

  assert.equal(finalized.status, "rendered");
  assert.equal(finalized.version, setup.draft.version + 1);
  assert.deepEqual(finalized.rendered, rendered);
  assert.equal(finalized.generatedAt, NOW);
  const event = setup.store.listEvents(0).at(-1);
  assert.equal(event?.eventType, "handover.rendered");
  assert.deepEqual(event?.actor, {
    type: "system",
    id: "pipeline:text-generation",
  });
  assert.deepEqual(event?.payload, {
    handoverId: setup.draft.handoverId,
    sourceSnapshotHash: setup.draft.sourceSnapshotHash,
    version: finalized.version,
    creditsConsumed: rendered.creditsConsumed,
    sectionCount: rendered.sections.length,
  });

  const rejected = savePreparedDraft(t);
  const unknown = renderedFor(rejected.packet);
  const renderedStatement = unknown.sections[0]?.statements[0];
  assert.ok(renderedStatement);
  renderedStatement.sourceRefs = ["record:not-in-packet"];
  assertDomainError(
    () =>
      rejected.service.finalize(
        rejected.draft.handoverId,
        rejected.draft.version,
        rejected.draft.sourceSnapshotHash as string,
        unknown,
      ),
    "HANDOVER_EVIDENCE_NOT_FOUND",
    409,
  );
});

test("finalize preserves packet unknowns exactly as ungrounded statements", (t) => {
  const setup = savePreparedDraft(t);
  const rendered = renderedFor(setup.packet);

  const finalized = setup.service.finalize(
    setup.draft.handoverId,
    setup.draft.version,
    setup.draft.sourceSnapshotHash as string,
    rendered,
  );

  assert.deepEqual(
    finalized.rendered?.sections.find(
      ({ sectionId }) => sectionId === "unknowns",
    )?.statements,
    setup.packet.unknowns.map((statement) => ({
      statement,
      sourceRefs: [],
    })),
  );
});

test("finalize rejects omitted, added, duplicated, or rewritten unknowns", (t) => {
  const cases: Array<{
    label: string;
    mutate: (rendered: RenderedHandover) => void;
  }> = [
    {
      label: "omitted section",
      mutate: (rendered) => {
        rendered.sections = rendered.sections.filter(
          ({ sectionId }) => sectionId !== "unknowns",
        );
      },
    },
    {
      label: "added statement",
      mutate: (rendered) => {
        const unknowns = rendered.sections.find(
          ({ sectionId }) => sectionId === "unknowns",
        );
        assert.ok(unknowns);
        unknowns.statements.push({
          statement: "A new unsupported unknown.",
          sourceRefs: [],
        });
      },
    },
    {
      label: "duplicated statement",
      mutate: (rendered) => {
        const unknowns = rendered.sections.find(
          ({ sectionId }) => sectionId === "unknowns",
        );
        assert.ok(unknowns);
        const statement = unknowns.statements[0];
        assert.ok(statement);
        unknowns.statements.push(structuredClone(statement));
      },
    },
    {
      label: "rewritten statement",
      mutate: (rendered) => {
        const unknowns = rendered.sections.find(
          ({ sectionId }) => sectionId === "unknowns",
        );
        assert.ok(unknowns);
        const statement = unknowns.statements[0];
        assert.ok(statement);
        statement.statement = "The response is probably normal.";
      },
    },
    {
      label: "duplicate unknowns section",
      mutate: (rendered) => {
        const unknowns = rendered.sections.find(
          ({ sectionId }) => sectionId === "unknowns",
        );
        assert.ok(unknowns);
        rendered.sections.push(structuredClone(unknowns));
      },
    },
  ];

  for (const { label, mutate } of cases) {
    const setup = savePreparedDraft(t);
    const rendered = renderedFor(setup.packet);
    mutate(rendered);

    assertDomainError(
      () =>
        setup.service.finalize(
          setup.draft.handoverId,
          setup.draft.version,
          setup.draft.sourceSnapshotHash as string,
          rendered,
        ),
      "HANDOVER_EVIDENCE_NOT_FOUND",
      409,
    );
    assert.equal(
      setup.store.requireHandover(setup.draft.handoverId).status,
      "draft",
      label,
    );
  }
});

test("finalize preserves the exact ordering of distinct packet unknowns", (t) => {
  const unknowns = [
    "The response to the change is not yet documented.",
    "The next blood pressure reading is not yet available.",
  ];
  const accepted = prepareRequested(t);
  accepted.packet.unknowns = unknowns;
  const acceptedDraft = accepted.service.saveDraft({
    handoverId: accepted.requested.handoverId,
    patientId: PATIENT_ID,
    contextId: HANDOVER_CONTEXT_ID,
    packet: accepted.packet,
  });
  assert.equal(
    accepted.service.finalize(
      acceptedDraft.handoverId,
      acceptedDraft.version,
      acceptedDraft.sourceSnapshotHash as string,
      renderedFor(accepted.packet),
    ).status,
    "rendered",
  );

  const rejected = prepareRequested(t);
  rejected.packet.unknowns = unknowns;
  const rejectedDraft = rejected.service.saveDraft({
    handoverId: rejected.requested.handoverId,
    patientId: PATIENT_ID,
    contextId: HANDOVER_CONTEXT_ID,
    packet: rejected.packet,
  });
  const reversed = renderedFor(rejected.packet);
  const renderedUnknowns = reversed.sections.find(
    ({ sectionId }) => sectionId === "unknowns",
  );
  assert.ok(renderedUnknowns);
  renderedUnknowns.statements.reverse();
  const eventsBefore = rejected.store.listEvents(0);

  assertDomainError(
    () =>
      rejected.service.finalize(
        rejectedDraft.handoverId,
        rejectedDraft.version,
        rejectedDraft.sourceSnapshotHash as string,
        reversed,
      ),
    "HANDOVER_EVIDENCE_NOT_FOUND",
    409,
  );
  assert.deepEqual(
    rejected.store.requireHandover(rejectedDraft.handoverId),
    rejectedDraft,
  );
  assert.deepEqual(rejected.store.listEvents(0), eventsBefore);
});

test("finalize omits the unknowns section when the packet has no unknowns", (t) => {
  const setup = prepareRequested(t);
  setup.packet.unknowns = [];
  const draft = setup.service.saveDraft({
    handoverId: setup.requested.handoverId,
    patientId: PATIENT_ID,
    contextId: HANDOVER_CONTEXT_ID,
    packet: setup.packet,
  });
  const rendered = renderedFor(setup.packet);

  assert.equal(
    rendered.sections.some(({ sectionId }) => sectionId === "unknowns"),
    false,
  );
  assert.equal(
    setup.service.finalize(
      draft.handoverId,
      draft.version,
      draft.sourceSnapshotHash as string,
      rendered,
    ).status,
    "rendered",
  );

  const rejected = prepareRequested(t);
  rejected.packet.unknowns = [];
  const rejectedDraft = rejected.service.saveDraft({
    handoverId: rejected.requested.handoverId,
    patientId: PATIENT_ID,
    contextId: HANDOVER_CONTEXT_ID,
    packet: rejected.packet,
  });
  const withEmptyUnknowns = renderedFor(rejected.packet);
  withEmptyUnknowns.sections.push({
    sectionId: "unknowns",
    heading: "Unknowns",
    statements: [],
  });
  assertDomainError(
    () =>
      rejected.service.finalize(
        rejectedDraft.handoverId,
        rejectedDraft.version,
        rejectedDraft.sourceSnapshotHash as string,
        withEmptyUnknowns,
      ),
    "HANDOVER_EVIDENCE_NOT_FOUND",
    409,
  );
});

test("finalize detects record, thread, and task source changes and emits a durable safe event", (t) => {
  const cases: Array<{
    label: string;
    mutate: (setup: ReturnType<typeof savePreparedDraft>) => void;
  }> = [
    {
      label: "record",
      mutate: ({ store }) => {
        const item = store.listRecordItems(PATIENT_ID)[0];
        assert.ok(item);
        store.putRecordItem({ ...item, text: "Source changed after drafting" });
      },
    },
    {
      label: "thread",
      mutate: ({ store, task }) => {
        const thread = store.requireThread(task.threadId);
        store.setThreadState(thread.threadId, thread.version, "tracking", NOW);
      },
    },
    {
      label: "task",
      mutate: ({ ledger, task }) => {
        ledger.correctDraft(
          task.taskId,
          task.version,
          { summary: "Changed task summary" },
          { type: "clinician", id: "clinician-1" },
        );
      },
    },
  ];

  for (const currentCase of cases) {
    const setup = savePreparedDraft(t);
    currentCase.mutate(setup);
    assertDomainError(
      () =>
        setup.service.finalize(
          setup.draft.handoverId,
          setup.draft.version,
          setup.draft.sourceSnapshotHash as string,
          renderedFor(setup.packet),
        ),
      "HANDOVER_SOURCE_CHANGED",
      409,
      true,
    );
    assert.equal(
      setup.store.requireHandover(setup.draft.handoverId).status,
      "draft",
      currentCase.label,
    );
    const event = setup.store.listEvents(0).at(-1);
    assert.equal(event?.eventType, "handover.source_changed");
    assert.equal(event?.payload.handoverId, setup.draft.handoverId);
    assert.equal(
      JSON.stringify(event).includes("Source changed after drafting"),
      false,
    );
    assert.notEqual(
      event?.payload.currentSnapshotHash,
      event?.payload.expectedSnapshotHash,
    );
  }
});

test("finalize supports exact lost-response replay and conflicts on changed render, version, or hash", (t) => {
  const setup = savePreparedDraft(t);
  const rendered = renderedFor(setup.packet);
  const finalized = setup.service.finalize(
    setup.draft.handoverId,
    setup.draft.version,
    setup.draft.sourceSnapshotHash as string,
    rendered,
  );
  const eventCount = setup.store.listEvents(0).length;

  assert.deepEqual(
    setup.service.finalize(
      setup.draft.handoverId,
      setup.draft.version,
      setup.draft.sourceSnapshotHash as string,
      rendered,
    ),
    finalized,
  );
  assert.equal(setup.store.listEvents(0).length, eventCount);

  const changedRender = structuredClone(rendered);
  changedRender.title = "Changed title";
  for (const [version, hash, output] of [
    [setup.draft.version, setup.draft.sourceSnapshotHash, changedRender],
    [finalized.version, setup.draft.sourceSnapshotHash, rendered],
    [setup.draft.version, `sha256:${"f".repeat(64)}`, rendered],
  ] as const) {
    assertDomainError(
      () =>
        setup.service.finalize(
          setup.draft.handoverId,
          version,
          hash as string,
          output,
        ),
      "HANDOVER_FINALIZE_CONFLICT",
      409,
    );
  }
});

test("markRenderRequested is retryable for drafts, replays rendered, and rejects other states", (t) => {
  const requestedSetup = prepareRequested(t);
  assertDomainError(
    () =>
      requestedSetup.service.markRenderRequested(
        requestedSetup.requested.handoverId,
      ),
    "HANDOVER_RENDER_REQUEST_CONFLICT",
    409,
  );

  const setup = savePreparedDraft(t);
  const before = setup.store.listEvents(0).length;
  assert.deepEqual(
    setup.service.markRenderRequested(setup.draft.handoverId),
    setup.draft,
  );
  assert.deepEqual(
    setup.service.markRenderRequested(setup.draft.handoverId),
    setup.draft,
  );
  assert.deepEqual(
    setup.store
      .listEvents(0)
      .slice(before)
      .map(({ eventType }) => eventType),
    ["handover.render_requested", "handover.render_requested"],
  );

  const finalized = setup.service.finalize(
    setup.draft.handoverId,
    setup.draft.version,
    setup.draft.sourceSnapshotHash as string,
    renderedFor(setup.packet),
  );
  const renderedEventCount = setup.store.listEvents(0).length;
  assert.deepEqual(
    setup.service.markRenderRequested(finalized.handoverId),
    finalized,
  );
  assert.equal(setup.store.listEvents(0).length, renderedEventCount);
});

test("markFailed is idempotent for requested work and never erases draft or rendered output", (t) => {
  const requested = prepareRequested(t);
  requested.service.markFailed(
    requested.requested.handoverId,
    "PIPELINE_DOWN",
    true,
  );
  const failed = requested.store.requireHandover(
    requested.requested.handoverId,
  );
  assert.equal(failed.status, "failed");
  assert.equal(failed.version, 2);
  assert.equal(
    requested.store.listEvents(0).at(-1)?.eventType,
    "handover.failed",
  );
  const failedEventCount = requested.store.listEvents(0).length;
  requested.service.markFailed(failed.handoverId, "PIPELINE_DOWN", true);
  assert.equal(requested.store.listEvents(0).length, failedEventCount);

  const draft = savePreparedDraft(t);
  assertDomainError(
    () => draft.service.markFailed(draft.draft.handoverId, "LATE", false),
    "HANDOVER_FAILURE_CONFLICT",
    409,
  );
  assert.deepEqual(
    draft.store.requireHandover(draft.draft.handoverId),
    draft.draft,
  );

  const rendered = draft.service.finalize(
    draft.draft.handoverId,
    draft.draft.version,
    draft.draft.sourceSnapshotHash as string,
    renderedFor(draft.packet),
  );
  assertDomainError(
    () => draft.service.markFailed(rendered.handoverId, "LATER", false),
    "HANDOVER_FAILURE_CONFLICT",
    409,
  );
  assert.deepEqual(draft.store.requireHandover(rendered.handoverId), rendered);
});

test("response exposes only the safe public projection and handover activity", (t) => {
  const setup = savePreparedDraft(t);
  setup.service.markRenderRequested(setup.draft.handoverId);
  const response = setup.service.response(setup.draft);

  assert.deepEqual(Object.keys(response).toSorted(), [
    "activity",
    "generatedAt",
    "handoverId",
    "packet",
    "patientId",
    "reason",
    "rendered",
    "renderingStatus",
    "requestedBy",
    "sourceSnapshotHash",
    "status",
    "version",
  ]);
  assert.equal(response.status, "draft");
  assert.equal(response.renderingStatus, "pending");
  assert.equal(response.generatedAt, null);
  assert.deepEqual(response.packet, setup.packet);
  const activity = response.activity as Array<Record<string, unknown>>;
  assert.ok(activity.length >= 4);
  assert.ok(
    activity.every((entry) => String(entry.eventType).startsWith("handover.")),
  );
  const serializedActivity = JSON.stringify(activity);
  for (const prohibited of [
    BEGIN_INPUT.focus,
    setup.task.summary,
    "Amlodipine changed",
    "approval-secret-with-at-least-32-bytes",
  ]) {
    assert.equal(serializedActivity.includes(prohibited), false, prohibited);
  }
  for (const forbidden of [
    "requestHash",
    "focus",
    "correlationId",
    "idempotencyKey",
    "sourceSnapshot",
  ]) {
    assert.equal(forbidden in response, false);
  }

  const rendered = setup.service.finalize(
    setup.draft.handoverId,
    setup.draft.version,
    setup.draft.sourceSnapshotHash as string,
    renderedFor(setup.packet),
  );
  const renderedResponse = setup.service.response(rendered);
  assert.equal(renderedResponse.status, "draft");
  assert.equal(renderedResponse.renderingStatus, "rendered");
  assert.deepEqual(renderedResponse.rendered, rendered.rendered);

  const requested = prepareRequested(t);
  assertDomainError(
    () => requested.service.response(requested.requested),
    "HANDOVER_RESPONSE_UNAVAILABLE",
    409,
  );
});

test("RecordService listPatientTasks is scoped and retains completed but excludes terminal tasks", (t) => {
  const setup = prepareRequested(t);
  const records = new RecordService(setup.store);
  const base = setup.task;
  const variants: Task[] = [
    {
      ...base,
      taskId: "11111111-1111-4111-8111-111111111111",
      state: "completed",
    },
    {
      ...base,
      taskId: "22222222-2222-4222-8222-222222222222",
      state: "verified",
    },
    {
      ...base,
      taskId: "33333333-3333-4333-8333-333333333333",
      state: "dismissed",
    },
  ];
  for (const task of variants) setup.store.putTask(task);

  assert.deepEqual(
    records
      .listPatientTasks(HANDOVER_CONTEXT_ID, PATIENT_ID)
      .map(({ state }) => state)
      .toSorted(),
    ["completed", "draft"],
  );
  assertDomainError(
    () => records.listPatientTasks("ctx-missing", PATIENT_ID),
    "PATIENT_SCOPE_DENIED",
    403,
  );
});
