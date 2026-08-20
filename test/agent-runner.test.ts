import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { type AgentGateway, AgentRunner } from "../src/agent/runner.js";
import { seedKaren } from "../src/fixtures/karen.js";
import { createApp } from "../src/http/app.js";
import { DemoClock } from "../src/infra/clock.js";
import { openDatabase } from "../src/infra/database.js";
import { SqliteStore } from "../src/infra/store.js";
import { LedgerService } from "../src/services/ledger-service.js";
import {
  APP_TOKEN,
  appHeaders,
  close,
  createAppHarness,
  listen,
  MCP_TOKEN,
  UI_ORIGIN,
} from "./support.js";

const PATIENT_ID = "synthetic-karen";
const INTERACTION_ID = "interaction-karen-1";
const EVIDENCE_REF = "encounter:sentence-42";

function result(contextId: string, taskId: string, state: string) {
  return { contextId, taskId, state };
}

class PublishAuditFailureStore extends SqliteStore {
  failPublishVerificationOnce = false;

  override appendEvent(
    input: Parameters<SqliteStore["appendEvent"]>[0],
  ): ReturnType<SqliteStore["appendEvent"]> {
    if (
      this.failPublishVerificationOnce &&
      input.eventType === "task.publish_verified"
    ) {
      this.failPublishVerificationOnce = false;
      throw new Error("Injected publish verification audit failure");
    }
    return super.appendEvent(input);
  }
}

function publicationHarness(
  t: TestContext,
  store: SqliteStore = new SqliteStore(openDatabase(":memory:")),
) {
  t.after(() => store.close());
  seedKaren(store, "2026-08-20T10:00:00.000Z");
  store.putContextMapping(
    "ctx-karen",
    INTERACTION_ID,
    PATIENT_ID,
    "2026-08-20T10:00:00.000Z",
  );
  const ledger = new LedgerService(
    store,
    new DemoClock(new Date("2026-08-20T10:00:00.000Z"), true),
    "approval-secret-with-at-least-32-bytes",
  );
  const draft = ledger.createKarenDraft("ctx-karen", "draft-for-recovery");
  const approval = ledger.approveDraft(
    draft.taskId,
    draft.version,
    "clinician-1",
    "app_one_tap",
    "approve-for-recovery",
  );
  const input = {
    patientId: PATIENT_ID,
    interactionId: INTERACTION_ID,
    taskId: draft.taskId,
    expectedVersion: draft.version,
    approvalProof: approval.proof,
    idempotencyKey: "publish-for-recovery",
  };
  return { store, ledger, draft, input };
}

test("unregistered evidence is rejected before Corti receives patient-scoped data", async (t) => {
  const calls: unknown[] = [];
  const gateway: AgentGateway = {
    async send(input) {
      calls.push(input);
      return result("ctx-unsafe", "corti-unsafe", "completed");
    },
    async waitForCompletion(agentResult) {
      return agentResult;
    },
  };
  const store = new SqliteStore(openDatabase(":memory:"));
  t.after(() => store.close());
  seedKaren(store, "2026-08-20T10:00:00.000Z");
  const runner = new AgentRunner(gateway, store, "mcp-secret");

  await assert.rejects(
    runner.investigate({
      patientId: PATIENT_ID,
      interactionId: INTERACTION_ID,
      signalText: "Dizziness needs follow-through",
      evidenceRefs: ["encounter:not-registered"],
      idempotencyKey: "candidate-unsafe",
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "Source evidence is unavailable",
  );

  assert.deepEqual(calls, []);
  assert.equal(store.contextForInteraction(INTERACTION_ID), null);
});

test("first investigation completes data-free warmup and maps context before scoped data", async (t) => {
  const calls: Array<{
    text: string;
    contextId?: string;
    data?: Record<string, unknown>;
  }> = [];
  const waits: string[] = [];
  const store = new SqliteStore(openDatabase(":memory:"));
  t.after(() => store.close());
  seedKaren(store, "2026-08-20T10:00:00.000Z");
  const gateway: AgentGateway = {
    async send(input) {
      calls.push(input);
      if (calls.length === 1) {
        assert.equal(input.contextId, undefined);
        assert.equal(input.data, undefined);
        assert.doesNotMatch(input.text, /karen|patient|interaction/i);
        return result("ctx-karen", "corti-warmup", "submitted");
      }
      assert.equal(store.patientForContext("ctx-karen"), PATIENT_ID);
      return result("ctx-karen", "corti-investigate", "submitted");
    },
    async waitForCompletion(agentResult) {
      waits.push(agentResult.taskId ?? "message");
      return { ...agentResult, state: "completed" };
    },
  };
  const runner = new AgentRunner(gateway, store, "mcp-secret");

  const investigation = await runner.investigate({
    patientId: PATIENT_ID,
    interactionId: INTERACTION_ID,
    signalText: "Dizziness needs follow-through",
    evidenceRefs: [EVIDENCE_REF],
    idempotencyKey: "candidate-karen-1",
  });

  assert.equal(investigation.contextId, "ctx-karen");
  assert.equal(store.patientForContext("ctx-karen"), PATIENT_ID);
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.contextId, "ctx-karen");
  assert.deepEqual(calls[1]?.data, {
    patientId: PATIENT_ID,
    interactionId: INTERACTION_ID,
    evidenceRefs: [EVIDENCE_REF],
    idempotencyKey: "candidate-karen-1",
    mcpToken: "mcp-secret",
  });
  assert.deepEqual(waits, ["corti-warmup", "corti-investigate"]);
});

test("mapped interactions reuse their isolated context without another warmup", async (t) => {
  const calls: Array<{
    text: string;
    contextId?: string;
    data?: Record<string, unknown>;
  }> = [];
  const store = new SqliteStore(openDatabase(":memory:"));
  t.after(() => store.close());
  seedKaren(store, "2026-08-20T10:00:00.000Z");
  store.putContextMapping(
    "ctx-karen",
    INTERACTION_ID,
    PATIENT_ID,
    "2026-08-20T10:00:00.000Z",
  );
  const gateway: AgentGateway = {
    async send(input) {
      calls.push(input);
      return result("ctx-karen", "corti-investigate", "completed");
    },
    async waitForCompletion(agentResult) {
      return agentResult;
    },
  };
  const runner = new AgentRunner(gateway, store, "mcp-secret");

  await runner.investigate({
    patientId: PATIENT_ID,
    interactionId: INTERACTION_ID,
    signalText: "Dizziness needs follow-through",
    evidenceRefs: [EVIDENCE_REF],
    idempotencyKey: "candidate-karen-2",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.contextId, "ctx-karen");
});

test("approved publication sends the exact proof and draft version into the mapped context", async (t) => {
  const calls: Array<{
    text: string;
    contextId?: string;
    data?: Record<string, unknown>;
  }> = [];
  const store = new SqliteStore(openDatabase(":memory:"));
  t.after(() => store.close());
  seedKaren(store, "2026-08-20T10:00:00.000Z");
  store.putContextMapping(
    "ctx-karen",
    INTERACTION_ID,
    PATIENT_ID,
    "2026-08-20T10:00:00.000Z",
  );
  const clock = new DemoClock(new Date("2026-08-20T10:00:00.000Z"), true);
  const ledger = new LedgerService(
    store,
    clock,
    "approval-secret-with-at-least-32-bytes",
  );
  const draft = ledger.createKarenDraft("ctx-karen", "draft-for-agent");
  const approval = ledger.approveDraft(
    draft.taskId,
    draft.version,
    "clinician-1",
    "app_one_tap",
    "approve-for-agent",
  );
  const gateway: AgentGateway = {
    async send(input) {
      calls.push(input);
      ledger.publishDraft(
        draft.taskId,
        approval.proof,
        draft.version,
        "publish-for-agent",
      );
      return result("ctx-karen", "corti-publish", "completed");
    },
    async waitForCompletion(agentResult) {
      return agentResult;
    },
  };
  const runner = new AgentRunner(gateway, store, "mcp-secret");

  await runner.publishApproved({
    patientId: PATIENT_ID,
    interactionId: INTERACTION_ID,
    taskId: draft.taskId,
    expectedVersion: draft.version,
    approvalProof: approval.proof,
    idempotencyKey: "publish-for-agent",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.contextId, "ctx-karen");
  assert.deepEqual(calls[0]?.data, {
    patientId: PATIENT_ID,
    interactionId: INTERACTION_ID,
    taskId: draft.taskId,
    expectedVersion: draft.version,
    approvalProof: approval.proof,
    idempotencyKey: "publish-for-agent",
    mcpToken: "mcp-secret",
  });
  const verified = store
    .listEvents(0)
    .filter((event) => event.eventType === "task.publish_verified");
  assert.equal(verified.length, 1);
  assert.deepEqual(verified[0]?.payload, {
    taskId: draft.taskId,
    threadId: draft.threadId,
    state: "offered_to_team",
    version: draft.version + 1,
  });
});

test("a completed Corti response cannot claim publication without committed ledger state", async (t) => {
  const store = new SqliteStore(openDatabase(":memory:"));
  t.after(() => store.close());
  seedKaren(store, "2026-08-20T10:00:00.000Z");
  store.putContextMapping(
    "ctx-karen",
    INTERACTION_ID,
    PATIENT_ID,
    "2026-08-20T10:00:00.000Z",
  );
  const ledger = new LedgerService(
    store,
    new DemoClock(new Date("2026-08-20T10:00:00.000Z"), true),
    "approval-secret-with-at-least-32-bytes",
  );
  const draft = ledger.createKarenDraft("ctx-karen", "draft-uncommitted");
  const approval = ledger.approveDraft(
    draft.taskId,
    draft.version,
    "clinician-1",
    "app_one_tap",
    "approve-uncommitted",
  );
  const gateway: AgentGateway = {
    async send() {
      return result("ctx-karen", "corti-no-tools", "completed");
    },
    async waitForCompletion(agentResult) {
      return agentResult;
    },
  };
  const runner = new AgentRunner(gateway, store, "mcp-secret");

  await assert.rejects(
    runner.publishApproved({
      patientId: PATIENT_ID,
      interactionId: INTERACTION_ID,
      taskId: draft.taskId,
      expectedVersion: draft.version,
      approvalProof: approval.proof,
      idempotencyKey: "publish-uncommitted",
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "Task publication was not committed",
  );
  assert.equal(ledger.getTask(draft.taskId).state, "draft");
});

test("concurrent identical publications persist one verification event and one exact result", async (t) => {
  const { store, ledger, draft, input } = publicationHarness(t);
  let sends = 0;
  const gateway: AgentGateway = {
    async send() {
      sends += 1;
      ledger.publishDraft(
        draft.taskId,
        input.approvalProof,
        draft.version,
        input.idempotencyKey,
      );
      return result("ctx-karen", `corti-publish-${sends}`, "completed");
    },
    async waitForCompletion(agentResult) {
      return agentResult;
    },
  };
  const runner = new AgentRunner(gateway, store, "mcp-secret");

  const results = await Promise.all([
    runner.publishApproved(input),
    runner.publishApproved(input),
  ]);

  assert.equal(sends, 2);
  assert.deepEqual(results[1], results[0]);
  assert.equal(
    store
      .listEvents(0)
      .filter((event) => event.eventType === "task.publish_verified").length,
    1,
  );
  assert.deepEqual(
    store.getProcessedCommand(
      `publish-verified:${draft.taskId}:${draft.version + 1}`,
      input.idempotencyKey,
    ),
    results[0],
  );
});

test("verified publication replay returns its exact result after downstream task progress", async (t) => {
  const { store, ledger, draft, input } = publicationHarness(t);
  let sends = 0;
  const gateway: AgentGateway = {
    async send() {
      sends += 1;
      ledger.publishDraft(
        draft.taskId,
        input.approvalProof,
        draft.version,
        input.idempotencyKey,
      );
      return result("ctx-karen", "corti-publish-exact", "completed");
    },
    async waitForCompletion(agentResult) {
      return agentResult;
    },
  };
  const runner = new AgentRunner(gateway, store, "mcp-secret");
  const published = await runner.publishApproved(input);
  ledger.acceptTask(
    draft.taskId,
    draft.version + 1,
    "nurse-a",
    "accept-after-verification",
  );

  const replay = await runner.publishApproved(input);

  assert.deepEqual(replay, published);
  assert.equal(store.requireTask(draft.taskId).state, "accepted");
  assert.equal(sends, 1);
  assert.equal(
    store
      .listEvents(0)
      .filter((event) => event.eventType === "task.publish_verified").length,
    1,
  );
});

test("lost Corti response recovers an exact processed publication without another agent call", async (t) => {
  const { store, ledger, draft, input } = publicationHarness(t);
  let sends = 0;
  const gateway: AgentGateway = {
    async send() {
      sends += 1;
      ledger.publishDraft(
        draft.taskId,
        input.approvalProof,
        draft.version,
        input.idempotencyKey,
      );
      throw new Error("Corti response was lost");
    },
    async waitForCompletion(agentResult) {
      return agentResult;
    },
  };
  const runner = new AgentRunner(gateway, store, "mcp-secret");

  await assert.rejects(runner.publishApproved(input), /response was lost/);
  assert.equal(store.requireTask(draft.taskId).state, "offered_to_team");
  assert.equal(
    store.getProcessedCommand(
      `publish-verified:${draft.taskId}:${draft.version + 1}`,
      input.idempotencyKey,
    ),
    null,
  );

  const recovered = await runner.publishApproved(input);

  assert.deepEqual(recovered, {
    contextId: "ctx-karen",
    taskId: null,
    state: "completed",
  });
  assert.equal(sends, 1);
  assert.equal(
    store
      .listEvents(0)
      .filter((event) => event.eventType === "task.publish_verified").length,
    1,
  );
});

test("verification audit failure rolls back its marker and retry recovers without Corti", async (t) => {
  const store = new PublishAuditFailureStore(openDatabase(":memory:"));
  const { ledger, draft, input } = publicationHarness(t, store);
  let sends = 0;
  const gateway: AgentGateway = {
    async send() {
      sends += 1;
      ledger.publishDraft(
        draft.taskId,
        input.approvalProof,
        draft.version,
        input.idempotencyKey,
      );
      return result("ctx-karen", "corti-publish", "completed");
    },
    async waitForCompletion(agentResult) {
      return agentResult;
    },
  };
  const runner = new AgentRunner(gateway, store, "mcp-secret");
  store.failPublishVerificationOnce = true;

  await assert.rejects(
    runner.publishApproved(input),
    /verification audit failure/,
  );
  const verificationScope = `publish-verified:${draft.taskId}:${draft.version + 1}`;
  assert.equal(
    store.getProcessedCommand(verificationScope, input.idempotencyKey),
    null,
  );
  assert.equal(
    store
      .listEvents(0)
      .filter((event) => event.eventType === "task.publish_verified").length,
    0,
  );

  const recovered = await runner.publishApproved(input);

  assert.equal(recovered.state, "completed");
  assert.equal(sends, 1);
  assert.deepEqual(
    store.getProcessedCommand(verificationScope, input.idempotencyKey),
    recovered,
  );
  assert.equal(
    store
      .listEvents(0)
      .filter((event) => event.eventType === "task.publish_verified").length,
    1,
  );
});

test("agent-enabled signal route investigates only after source evidence registration", async (t) => {
  const harness = createAppHarness();
  const calls: Array<{
    text: string;
    contextId?: string;
    data?: Record<string, unknown>;
  }> = [];
  const gateway: AgentGateway = {
    async send(input) {
      calls.push(input);
      assert.equal(
        harness.store.hasRecordEvidence(PATIENT_ID, [
          "encounter:candidate-agent.1",
        ]),
        true,
      );
      return result("ctx-karen", "corti-investigate", "completed");
    },
    async waitForCompletion(agentResult) {
      return agentResult;
    },
  };
  const runner = new AgentRunner(gateway, harness.store, MCP_TOKEN);
  const app = createApp({
    store: harness.store,
    clock: harness.clock,
    ledger: harness.ledger,
    handovers: harness.handovers,
    records: harness.records,
    scheduler: harness.scheduler,
    uiOrigin: UI_ORIGIN,
    appBearerToken: APP_TOKEN,
    mcpBearerToken: MCP_TOKEN,
    runner,
  });
  const { server, baseUrl } = await listen(app);
  t.after(async () => {
    await close(server);
    harness.store.close();
  });

  const blocked = await fetch(`${baseUrl}/api/signals`, {
    method: "POST",
    headers: appHeaders("pipeline:candidate-handoff"),
    body: JSON.stringify({
      patientId: PATIENT_ID,
      interactionId: INTERACTION_ID,
      signalText: "A reference without a quote",
      evidenceRefs: ["encounter:reference-only"],
      idempotencyKey: "candidate-reference-only",
    }),
  });
  assert.equal(blocked.status, 202);
  assert.equal(calls.length, 0);

  const investigated = await fetch(`${baseUrl}/api/signals`, {
    method: "POST",
    headers: appHeaders("pipeline:candidate-handoff"),
    body: JSON.stringify({
      patientId: PATIENT_ID,
      interactionId: INTERACTION_ID,
      signalText: "Dizziness needs follow-through",
      evidenceRefs: ["encounter:candidate-agent.1"],
      sourceEvidence: [
        {
          evidenceRef: "encounter:candidate-agent.1",
          sourceQuote: "I feel dizzy when I stand up.",
        },
      ],
      idempotencyKey: "candidate-agent-ready",
    }),
  });

  assert.equal(investigated.status, 202);
  assert.equal(calls.length, 1);
  const response = await investigated.json();
  assert.deepEqual(
    { ...response, signalEventId: "event-id" },
    {
      signalEventId: "event-id",
      contextId: "ctx-karen",
      cortiTaskId: "corti-investigate",
      agentState: "completed",
    },
  );
});
