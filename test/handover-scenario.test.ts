import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { HandoverAgentRunner } from "../src/agent/handover-runner.js";
import type {
  AgentGateway,
  AgentResult,
  AgentSendInput,
} from "../src/agent/runner.js";
import type {
  HandoverPacket,
  HandoverTaskItem,
  RenderedHandover,
} from "../src/domain/handover.js";
import type { Task } from "../src/domain/types.js";
import { seedKaren } from "../src/fixtures/karen.js";
import { createApp } from "../src/http/app.js";
import { DemoClock } from "../src/infra/clock.js";
import { openDatabase } from "../src/infra/database.js";
import { SqliteStore } from "../src/infra/store.js";
import { DemoAudienceService } from "../src/services/demo-audience-service.js";
import { HandoverService } from "../src/services/handover-service.js";
import { LedgerService } from "../src/services/ledger-service.js";
import { RecordService } from "../src/services/record-service.js";
import { SchedulerService } from "../src/services/scheduler-service.js";
import { APP_TOKEN, MCP_TOKEN, UI_ORIGIN, close, listen } from "./support.js";

const NOW = "2026-08-20T10:00:00.000Z";
const PATIENT_ID = "synthetic-karen";
const LEDGER_CONTEXT_ID = "ctx-karen";

interface HandoverEnvelope {
  handover: {
    handoverId: string;
    version: number;
    sourceSnapshotHash: string;
    packet: HandoverPacket;
    rendered: RenderedHandover | null;
    activity: Array<{ eventType: string }>;
  };
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
      "encounter:sentence-42",
      `thread:${task.threadId}@${task.version}`,
      `task:${task.taskId}@${task.version}`,
    ],
  };
}

function packetFor(task: Task): HandoverPacket {
  return {
    situation: [
      {
        statement: "Dizziness since medication change",
        sourceRefs: ["encounter:sentence-42"],
      },
    ],
    background: [
      {
        statement: "Amlodipine changed",
        sourceRefs: ["record:medication-1"],
      },
    ],
    currentConcerns: [],
    outstandingTasks: [taskItem(task)],
    awaitingVerification: [],
    escalations: [],
    unknowns: ["The outcome of the blood-pressure check is not documented."],
  };
}

function renderedFor(packet: HandoverPacket): RenderedHandover {
  const task = packet.outstandingTasks[0];
  assert.ok(task);
  return {
    title: "Current patient handover",
    sections: [
      {
        sectionId: "situation",
        heading: "Situation",
        statements: packet.situation,
      },
      {
        sectionId: "outstanding-tasks",
        heading: "Outstanding tasks",
        statements: [
          {
            statement: `${task.summary} — state: ${task.state}; team: ${task.targetTeamId}; owner: ${task.assignedMemberId ?? "unassigned"}; urgency: ${task.clinicalUrgency}; accept by: ${task.acceptBy}; due by: ${task.dueBy}.`,
            sourceRefs: task.sourceRefs,
          },
        ],
      },
      {
        sectionId: "unknowns",
        heading: "Unknowns",
        statements: packet.unknowns.map((statement) => ({
          statement,
          sourceRefs: [],
        })),
      },
    ],
    creditsConsumed: 0,
  };
}

class DraftSavingGateway implements AgentGateway {
  private warmupCount = 0;

  constructor(
    private readonly store: SqliteStore,
    private readonly handovers: HandoverService,
  ) {}

  async send(input: AgentSendInput): Promise<AgentResult> {
    if (input.contextId === undefined) {
      this.warmupCount += 1;
      return {
        contextId: `ctx-handover-${this.warmupCount}`,
        taskId: `corti-warmup-${this.warmupCount}`,
        state: "submitted",
      };
    }

    const handoverId = input.data?.handoverId;
    const patientId = input.data?.patientId;
    assert.ok(typeof handoverId === "string");
    assert.equal(patientId, PATIENT_ID);
    assert.ok(typeof patientId === "string");
    const task = this.store.listPatientTasks(PATIENT_ID)[0];
    assert.ok(task);
    this.handovers.saveDraft({
      handoverId,
      patientId,
      contextId: input.contextId,
      packet: packetFor(task),
    });
    return {
      contextId: input.contextId,
      taskId: `corti-handover-${this.warmupCount}`,
      state: "submitted",
    };
  }

  async waitForCompletion(result: AgentResult): Promise<AgentResult> {
    return { ...result, state: "completed" };
  }
}

function requestHeaders(actorId = "clinician-1"): Record<string, string> {
  return {
    authorization: `Bearer ${APP_TOKEN}`,
    "content-type": "application/json",
    "x-actor-id": actorId,
    "x-correlation-id": "handover-scenario",
  };
}

async function requestDraft(baseUrl: string, idempotencyKey: string) {
  const response = await fetch(
    `${baseUrl}/api/patients/${PATIENT_ID}/handover-drafts`,
    {
      method: "POST",
      headers: requestHeaders(),
      body: JSON.stringify({
        idempotencyKey,
        reason: "on_demand",
        focus: "Medication safety and current follow-through",
      }),
    },
  );
  assert.equal(response.status, 201);
  return (await response.json()) as HandoverEnvelope;
}

async function finalize(
  baseUrl: string,
  draft: HandoverEnvelope["handover"],
): Promise<Response> {
  return fetch(`${baseUrl}/api/handovers/${draft.handoverId}/finalize`, {
    method: "POST",
    headers: requestHeaders(),
    body: JSON.stringify({
      expectedVersion: draft.version,
      sourceSnapshotHash: draft.sourceSnapshotHash,
      rendered: renderedFor(draft.packet),
    }),
  });
}

function scenario(t: TestContext) {
  const store = new SqliteStore(openDatabase(":memory:"));
  t.after(() => store.close());
  seedKaren(store, NOW);
  store.putContextMapping(
    LEDGER_CONTEXT_ID,
    "interaction-karen-1",
    PATIENT_ID,
    NOW,
  );
  const clock = new DemoClock(new Date(NOW), true);
  const ledger = new LedgerService(
    store,
    clock,
    "approval-secret-with-at-least-32-bytes",
  );
  const handovers = new HandoverService(store, clock);
  const gateway = new DraftSavingGateway(store, handovers);
  const handoverRunner = new HandoverAgentRunner(gateway, store, MCP_TOKEN);
  const app = createApp({
    store,
    clock,
    ledger,
    handovers,
    records: new RecordService(store),
    scheduler: new SchedulerService(store, clock),
    demoAudience: new DemoAudienceService(store, clock),
    uiOrigin: UI_ORIGIN,
    appBearerToken: APP_TOKEN,
    mcpBearerToken: MCP_TOKEN,
    handoverRunner,
  });
  return { app, store, ledger };
}

test("grounded handover runs through the real app without mutating task state", async (t) => {
  const { app, store, ledger } = scenario(t);
  const task = ledger.createKarenDraft(LEDGER_CONTEXT_ID, "scenario-task");
  const taskBeforeHandover = store.requireTask(task.taskId);
  const { server, baseUrl } = await listen(app);
  t.after(async () => close(server));

  const firstDraft = await requestDraft(baseUrl, "scenario-handover-1");
  assert.deepEqual(firstDraft.handover.packet.situation, [
    {
      statement: "Dizziness since medication change",
      sourceRefs: ["encounter:sentence-42"],
    },
  ]);
  assert.deepEqual(firstDraft.handover.packet.outstandingTasks, [
    taskItem(taskBeforeHandover),
  ]);
  assert.deepEqual(store.requireTask(task.taskId), taskBeforeHandover);

  const finalizedResponse = await finalize(baseUrl, firstDraft.handover);
  assert.equal(finalizedResponse.status, 201);
  const finalized = (await finalizedResponse.json()) as HandoverEnvelope;
  assert.deepEqual(
    finalized.handover.rendered,
    renderedFor(firstDraft.handover.packet),
  );
  assert.deepEqual(store.requireTask(task.taskId), taskBeforeHandover);
  assert.deepEqual(
    finalized.handover.activity.map(({ eventType }) => eventType),
    [
      "handover.requested",
      "handover.context_initialized",
      "handover.sources_retrieved",
      "handover.draft_saved",
      "handover.render_requested",
      "handover.rendered",
    ],
  );

  const secondDraft = await requestDraft(baseUrl, "scenario-handover-2");
  const beforeExplicitChange = store.requireTask(task.taskId);
  assert.deepEqual(beforeExplicitChange, taskBeforeHandover);
  const changed = ledger.correctDraft(
    task.taskId,
    beforeExplicitChange.version,
    { summary: "Check seated and standing blood pressure within 48 hours" },
    { type: "clinician", id: "clinician-1" },
  );
  assert.equal(changed.state, beforeExplicitChange.state);
  assert.equal(changed.version, beforeExplicitChange.version + 1);

  const staleFinalization = await finalize(baseUrl, secondDraft.handover);
  assert.equal(staleFinalization.status, 409);
  assert.deepEqual(await staleFinalization.json(), {
    error: {
      code: "HANDOVER_SOURCE_CHANGED",
      message: "Handover sources changed after the draft was saved",
      retryable: true,
    },
  });
});
