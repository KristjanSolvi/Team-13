import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type {
  HandoverPacket,
  HandoverTaskItem,
} from "../src/domain/handover.js";
import type { Task } from "../src/domain/types.js";
import { seedKaren } from "../src/fixtures/karen.js";
import { DemoClock } from "../src/infra/clock.js";
import { openDatabase } from "../src/infra/database.js";
import { SqliteStore } from "../src/infra/store.js";
import { createHandoverMcp } from "../src/mcp/handover-tools.js";
import { HandoverService } from "../src/services/handover-service.js";
import { LedgerService } from "../src/services/ledger-service.js";
import { RecordService } from "../src/services/record-service.js";

const NOW = "2026-08-20T10:00:00.000Z";
const PATIENT_ID = "synthetic-karen";
const CONTEXT_ID = "ctx-handover";

interface HandoverMcpHarness {
  store: SqliteStore;
  handovers: HandoverService;
  server: McpServer;
  client: Client;
  handoverId: string;
  task: Task;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireStructured(value: unknown): Record<string, unknown> {
  assert.ok(isObject(value));
  const structured = value.structuredContent;
  assert.ok(isObject(structured));
  return structured;
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
      `thread:${task.threadId}@1`,
      `task:${task.taskId}@${task.version}`,
    ],
  };
}

function packetFor(task: Task): HandoverPacket {
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
    outstandingTasks: [taskItem(task)],
    awaitingVerification: [],
    escalations: [],
    unknowns: ["The response to the medication change is not documented."],
  };
}

async function harness(t: TestContext): Promise<HandoverMcpHarness> {
  const store = new SqliteStore(openDatabase(":memory:"));
  seedKaren(store, NOW);
  store.putContextMapping("ctx-karen", "interaction-karen-1", PATIENT_ID, NOW);
  const clock = new DemoClock(new Date(NOW), true);
  const ledger = new LedgerService(
    store,
    clock,
    "approval-secret-with-at-least-32-bytes",
  );
  const task = ledger.createKarenDraft("ctx-karen", "handover-mcp-task");
  store.putTask({
    ...task,
    taskId: randomUUID(),
    state: "verified",
    version: 2,
  });
  store.putTask({
    ...task,
    taskId: randomUUID(),
    state: "dismissed",
    version: 2,
  });
  const handovers = new HandoverService(store, clock);
  const requested = handovers.beginRequest({
    patientId: PATIENT_ID,
    requestedBy: "clinician-1",
    reason: "on_demand",
    focus: null,
    correlationId: "corr-handover-mcp",
    idempotencyKey: "handover-mcp-request",
  }).handover;
  store.putContextMapping(CONTEXT_ID, requested.interactionId, PATIENT_ID, NOW);
  const server = createHandoverMcp(new RecordService(store), handovers);
  const client = new Client({
    name: "handover-mcp-contract-test",
    version: "1.0.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
    store.close();
  });
  return {
    store,
    handovers,
    server,
    client,
    handoverId: requested.handoverId,
    task,
  };
}

async function callScoped(
  client: Client,
  name: string,
  argumentsValue: Record<string, unknown>,
  contextId = CONTEXT_ID,
) {
  return client.callTool({
    name,
    arguments: argumentsValue,
    _meta: { _contextId: contextId },
  });
}

test("lists exactly the five patient-scoped non-actionable handover tools", async (t) => {
  const { client } = await harness(t);
  const result = await client.listTools();
  const names = result.tools.map((tool) => tool.name).toSorted();

  assert.deepEqual(names, [
    "get_patient_context",
    "get_task",
    "list_open_threads",
    "list_patient_tasks",
    "save_handover_draft",
  ]);
  assert.equal(names.includes("create_task_draft"), false);
  assert.equal(names.includes("publish_team_task"), false);
});

test("denies missing context and a context scoped to another patient", async (t) => {
  const { client, store } = await harness(t);

  const missing = await client.callTool({
    name: "get_patient_context",
    arguments: { patientId: PATIENT_ID },
  });
  assert.equal(missing.isError, true);
  assert.equal(requireStructured(missing).code, "CONTEXT_REQUIRED");

  store.putPatient("synthetic-other", "Other Patient", { synthetic: true });
  store.putContextMapping(
    "ctx-other",
    "handover:other",
    "synthetic-other",
    NOW,
  );
  const crossPatient = await callScoped(
    client,
    "get_patient_context",
    { patientId: PATIENT_ID },
    "ctx-other",
  );
  assert.equal(crossPatient.isError, true);
  assert.equal(requireStructured(crossPatient).code, "PATIENT_SCOPE_DENIED");
});

test("lists open threads and only active patient tasks", async (t) => {
  const { client, task } = await harness(t);

  const threads = requireStructured(
    await callScoped(client, "list_open_threads", { patientId: PATIENT_ID }),
  ).threads;
  assert.ok(Array.isArray(threads));
  assert.deepEqual(
    threads.map((thread) => (thread as { threadId: string }).threadId),
    [task.threadId],
  );

  const tasks = requireStructured(
    await callScoped(client, "list_patient_tasks", { patientId: PATIENT_ID }),
  ).tasks;
  assert.ok(Array.isArray(tasks));
  assert.deepEqual(
    tasks.map((candidate) => ({
      taskId: (candidate as Task).taskId,
      state: (candidate as Task).state,
    })),
    [{ taskId: task.taskId, state: "draft" }],
  );
});

test("get_task is patient-scoped, active-only, and has no audit side effect", async (t) => {
  const { client, store, task } = await harness(t);
  const before = store.listEvents(0).length;

  const first = await callScoped(client, "get_task", {
    patientId: PATIENT_ID,
    taskId: task.taskId,
  });
  const second = await callScoped(client, "get_task", {
    patientId: PATIENT_ID,
    taskId: task.taskId,
  });

  assert.deepEqual(requireStructured(first), task);
  assert.deepEqual(requireStructured(second), task);
  assert.equal(store.listEvents(0).length, before);

  const missing = await callScoped(client, "get_task", {
    patientId: PATIENT_ID,
    taskId: randomUUID(),
  });
  assert.equal(missing.isError, true);
  assert.equal(requireStructured(missing).code, "TASK_NOT_FOUND");
});

test("saves one grounded packet and replays the same draft idempotently", async (t) => {
  const { client, store, handoverId, task } = await harness(t);
  const argumentsValue = {
    handoverId,
    patientId: PATIENT_ID,
    packet: packetFor(task),
  };

  const first = await callScoped(client, "save_handover_draft", argumentsValue);
  const second = await callScoped(
    client,
    "save_handover_draft",
    argumentsValue,
  );

  assert.equal(first.isError, undefined);
  assert.deepEqual(requireStructured(second), requireStructured(first));
  assert.equal(requireStructured(first).status, "draft");
  assert.equal(
    store
      .listEvents(0)
      .filter((event) => event.eventType === "handover.draft_saved").length,
    1,
  );
});

test("rejects unknown evidence and altered authoritative task fields", async (t) => {
  const { client, store, handoverId, task } = await harness(t);
  const unknownEvidence = packetFor(task);
  unknownEvidence.situation[0] = {
    statement: "Unsupported statement",
    sourceRefs: ["record:unknown"],
  };

  const unknown = await callScoped(client, "save_handover_draft", {
    handoverId,
    patientId: PATIENT_ID,
    packet: unknownEvidence,
  });
  assert.equal(unknown.isError, true);
  assert.equal(requireStructured(unknown).code, "HANDOVER_EVIDENCE_NOT_FOUND");
  assert.equal(store.requireHandover(handoverId).status, "requested");

  const altered = packetFor(task);
  const item = altered.outstandingTasks[0];
  assert.ok(item);
  altered.outstandingTasks[0] = {
    ...item,
    summary: "An invented task summary",
  };
  const mismatch = await callScoped(client, "save_handover_draft", {
    handoverId,
    patientId: PATIENT_ID,
    packet: altered,
  });
  assert.equal(mismatch.isError, true);
  assert.equal(requireStructured(mismatch).code, "HANDOVER_TASK_MISMATCH");
  assert.equal(store.requireHandover(handoverId).status, "requested");
});
