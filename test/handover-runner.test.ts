import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { CortiSdkGateway } from "../src/agent/corti-gateway.js";
import {
  buildAgentDefinitions,
  buildProvisioningSummary,
} from "../src/agent/definitions.js";
import { HANDOVER_PROMPT } from "../src/agent/handover-prompt.js";
import { HandoverAgentRunner } from "../src/agent/handover-runner.js";
import type {
  AgentGateway,
  AgentResult,
  AgentSendInput,
} from "../src/agent/runner.js";
import { AgentRunner } from "../src/agent/runner.js";
import { createAgentRunners } from "../src/agent/runtime.js";
import { parseConfig } from "../src/config.js";
import { DomainError } from "../src/domain/errors.js";
import type { HandoverPacket } from "../src/domain/handover.js";
import { seedKaren } from "../src/fixtures/karen.js";
import { DemoClock } from "../src/infra/clock.js";
import { openDatabase } from "../src/infra/database.js";
import { SqliteStore } from "../src/infra/store.js";
import { HandoverService } from "../src/services/handover-service.js";
import {
  handoverAgentVerificationScope,
  verifyHandoverAgentDraft,
} from "../src/services/handover-verification.js";

const NOW = "2026-08-20T10:00:00.000Z";
const PATIENT_ID = "synthetic-karen";
const MCP_TOKEN = "handover-mcp-token";

const PACKET: HandoverPacket = {
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
  outstandingTasks: [],
  awaitingVerification: [],
  escalations: [],
  unknowns: ["The response to the medication change is not documented."],
};

function completed(contextId: string, taskId: string): AgentResult {
  return { contextId, taskId, state: "completed" };
}

function testConfig(overrides: NodeJS.ProcessEnv = {}) {
  return parseConfig({
    APP_BEARER_TOKEN: "app-token",
    MCP_BEARER_TOKEN: "mcp-token",
    APPROVAL_HMAC_SECRET: "approval-secret-at-least-32-characters",
    MCP_PUBLIC_URL: "https://example.test/mcp",
    CORTI_TENANT_NAME: "tenant",
    CORTI_CLIENT_ID: "client",
    CORTI_CLIENT_SECRET: "secret",
    CORTI_ENVIRONMENT: "eu",
    DEMO_MODE: "true",
    ...overrides,
  });
}

function harness(
  t: TestContext,
  store: SqliteStore = new SqliteStore(openDatabase(":memory:")),
) {
  t.after(() => store.close());
  seedKaren(store, NOW);
  const handovers = new HandoverService(
    store,
    new DemoClock(new Date(NOW), true),
  );
  const handover = handovers.beginRequest({
    patientId: PATIENT_ID,
    requestedBy: "clinician-1",
    reason: "on_demand",
    focus: "Medication safety",
    correlationId: "correlation-handover",
    idempotencyKey: "handover-request-1",
  }).handover;
  return { store, handovers, handover };
}

function assertDomainError(
  error: unknown,
  code: string,
  retryable: boolean,
): boolean {
  assert.ok(error instanceof DomainError);
  assert.equal(error.code, code);
  assert.equal(error.retryable, retryable);
  return true;
}

class VerificationMarkerFailureStore extends SqliteStore {
  failMarker = true;

  override saveProcessedCommand(
    scope: string,
    key: string,
    result: unknown,
    createdAt: string,
  ): void {
    if (this.failMarker) throw new Error("verification marker write failed");
    super.saveProcessedCommand(scope, key, result, createdAt);
  }
}

test("handover prompt preserves the exact constrained five-tool contract", () => {
  assert.equal(
    HANDOVER_PROMPT,
    `You are the Follow-Through patient handover agent.

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
- Return safe observable milestones, never hidden reasoning.`,
  );
});

test("the dedicated Corti gateway attaches the token to the handover MCP name", async () => {
  const config = testConfig();
  const gateway = new CortiSdkGateway(
    "handover-agent",
    config,
    config.handoverMcpName,
  );
  const sent: unknown[] = [];
  Object.defineProperty(gateway, "client", {
    value: {
      agents: {
        async messageSend(...argumentsValue: unknown[]) {
          sent.push(argumentsValue);
          return { message: { contextId: "ctx-handover" } };
        },
      },
    },
  });

  await gateway.send({
    text: "Generate a handover",
    data: { patientId: PATIENT_ID, mcpToken: MCP_TOKEN },
  });

  const call = sent[0] as [
    string,
    {
      message: {
        parts: Array<{ kind: string; data?: Record<string, unknown> }>;
      };
    },
  ];
  assert.equal(call[0], "handover-agent");
  assert.deepEqual(call[1].message.parts.at(-1), {
    kind: "data",
    data: {
      type: "token",
      mcp_name: "follow-through-handover",
      token: MCP_TOKEN,
    },
  });
});

test("the Corti gateway returns terminal non-completed results for typed runner classification", async () => {
  const gateway = new CortiSdkGateway(
    "handover-agent",
    testConfig(),
    "follow-through-handover",
  );

  for (const state of [
    "failed",
    "canceled",
    "rejected",
    "input-required",
    "auth-required",
  ]) {
    const result = {
      contextId: "ctx-terminal",
      taskId: `task-${state}`,
      state,
    };
    assert.deepEqual(await gateway.waitForCompletion(result), result);
  }
});

test("pure provisioning definitions configure exactly one distinct MCP per agent", () => {
  const config = testConfig({
    HANDOVER_MCP_PUBLIC_URL: "https://handover.example/mcp",
    HANDOVER_MCP_NAME: "handover-tools",
  });

  const definitions = buildAgentDefinitions(config);

  assert.equal(
    definitions.task.systemPrompt.includes("publish_team_task"),
    true,
  );
  assert.deepEqual(definitions.task.mcpServers, [
    {
      name: "follow-through-ledger",
      description:
        "Six patient-scoped tools for record investigation and clinician-approved team-task publication.",
      transportType: "streamable_http",
      authorizationType: "bearer",
      url: "https://example.test/mcp",
    },
  ]);
  assert.equal(definitions.handover.systemPrompt, HANDOVER_PROMPT);
  assert.deepEqual(definitions.handover.mcpServers, [
    {
      name: "handover-tools",
      description:
        "Five patient-scoped, non-actionable tools for grounded handover reads and draft persistence.",
      transportType: "streamable_http",
      authorizationType: "bearer",
      url: "https://handover.example/mcp",
    },
  ]);
  assert.deepEqual(
    buildProvisioningSummary(config, "task-agent", "handover-agent"),
    {
      taskAgentId: "task-agent",
      handoverAgentId: "handover-agent",
      taskMcpUrl: "https://example.test/mcp",
      handoverMcpUrl: "https://handover.example/mcp",
    },
  );
});

test("runtime constructs only configured agents with their distinct MCP names", (t) => {
  const store = new SqliteStore(openDatabase(":memory:"));
  t.after(() => store.close());
  const gateway: AgentGateway = {
    async send() {
      return completed("ctx-unused", "unused");
    },
    async waitForCompletion(agentResult) {
      return agentResult;
    },
  };
  const calls: Array<{ agentId: string; mcpName: string }> = [];
  const factory = (agentId: string, mcpName: string) => {
    calls.push({ agentId, mcpName });
    return gateway;
  };

  assert.deepEqual(createAgentRunners(testConfig(), store, factory), {});
  const configured = createAgentRunners(
    testConfig({
      CORTI_AGENT_ID: "task-agent",
      CORTI_HANDOVER_AGENT_ID: "handover-agent",
    }),
    store,
    factory,
  );

  assert.ok(configured.task instanceof AgentRunner);
  assert.ok(configured.handover instanceof HandoverAgentRunner);
  assert.deepEqual(calls, [
    { agentId: "task-agent", mcpName: "follow-through-ledger" },
    { agentId: "handover-agent", mcpName: "follow-through-handover" },
  ]);
});

test("a handover always uses a fresh data-free context and verifies one persisted draft", async (t) => {
  const { store, handovers, handover } = harness(t);
  store.putContextMapping("ctx-stale", handover.interactionId, PATIENT_ID, NOW);
  const calls: AgentSendInput[] = [];
  const gateway: AgentGateway = {
    async send(input) {
      calls.push(input);
      if (calls.length === 1) {
        assert.equal(input.contextId, undefined);
        assert.equal(input.data, undefined);
        assert.doesNotMatch(input.text, /patient|karen|handover/i);
        return { contextId: "ctx-fresh", taskId: "warmup", state: "submitted" };
      }
      assert.equal(
        store.contextForInteraction(handover.interactionId),
        "ctx-fresh",
      );
      handovers.saveDraft({
        handoverId: handover.handoverId,
        patientId: PATIENT_ID,
        contextId: "ctx-fresh",
        packet: PACKET,
      });
      return {
        contextId: "ctx-fresh",
        taskId: "generate",
        state: "submitted",
      };
    },
    async waitForCompletion(result) {
      return { ...result, state: "completed" };
    },
  };

  const generated = await new HandoverAgentRunner(
    gateway,
    store,
    MCP_TOKEN,
  ).generate({
    handoverId: handover.handoverId,
    patientId: PATIENT_ID,
    reason: "on_demand",
    focus: "Medication safety",
    idempotencyKey: "handover-request-1",
  });

  assert.equal(generated.status, "draft");
  assert.equal(generated.contextId, "ctx-fresh");
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.contextId, "ctx-fresh");
  assert.match(calls[1]?.text ?? "", /emphasis.*never.*evidence/i);
  assert.deepEqual(calls[1]?.data, {
    handoverId: handover.handoverId,
    patientId: PATIENT_ID,
    interactionId: `handover:${handover.handoverId}`,
    reason: "on_demand",
    focusEmphasis: "Medication safety",
    idempotencyKey: "handover-request-1",
    mcpToken: MCP_TOKEN,
  });
  assert.equal(Object.hasOwn(calls[1]?.data ?? {}, "focus"), false);
  assert.equal(store.patientForContext("ctx-fresh"), PATIENT_ID);
  assert.equal(store.patientForContext("ctx-stale"), null);
  assert.equal(
    store.listEvents(0).some((event) => event.eventType.startsWith("task.")),
    false,
  );
  const verificationScope = handoverAgentVerificationScope(handover.handoverId);
  const expectedMarker = {
    handoverId: handover.handoverId,
    contextId: "ctx-fresh",
    version: generated.version,
  };
  assert.deepEqual(
    store.getProcessedCommand(verificationScope, "handover-request-1"),
    expectedMarker,
  );
  assert.deepEqual(
    verifyHandoverAgentDraft(store, {
      handoverId: handover.handoverId,
      contextId: "ctx-fresh",
      idempotencyKey: "handover-request-1",
    }),
    generated,
  );
  assert.deepEqual(
    store.getProcessedCommand(verificationScope, "handover-request-1"),
    expectedMarker,
  );
});

test("handover verification marker writes fail atomically and retry idempotently", async (t) => {
  const store = new VerificationMarkerFailureStore(openDatabase(":memory:"));
  const { handovers, handover } = harness(t, store);
  let calls = 0;
  const gateway: AgentGateway = {
    async send() {
      calls += 1;
      if (calls === 1) return completed("ctx-marker", "warmup");
      handovers.saveDraft({
        handoverId: handover.handoverId,
        patientId: PATIENT_ID,
        contextId: "ctx-marker",
        packet: PACKET,
      });
      return completed("ctx-marker", "generate");
    },
    async waitForCompletion(result) {
      return result;
    },
  };

  await assert.rejects(
    new HandoverAgentRunner(gateway, store, MCP_TOKEN).generate({
      handoverId: handover.handoverId,
      patientId: PATIENT_ID,
      reason: "on_demand",
      focus: "Medication safety",
      idempotencyKey: "handover-request-1",
    }),
    /verification marker write failed/,
  );
  const draft = store.requireHandover(handover.handoverId);
  assert.equal(draft.status, "draft");
  assert.equal(
    store.getProcessedCommand(
      handoverAgentVerificationScope(handover.handoverId),
      "handover-request-1",
    ),
    null,
  );

  store.failMarker = false;
  const first = verifyHandoverAgentDraft(store, {
    handoverId: handover.handoverId,
    contextId: "ctx-marker",
    idempotencyKey: "handover-request-1",
  });
  const replay = verifyHandoverAgentDraft(store, {
    handoverId: handover.handoverId,
    contextId: "ctx-marker",
    idempotencyKey: "handover-request-1",
  });
  assert.deepEqual(first, draft);
  assert.deepEqual(replay, draft);
  assert.deepEqual(
    store.getProcessedCommand(
      handoverAgentVerificationScope(handover.handoverId),
      "handover-request-1",
    ),
    {
      handoverId: handover.handoverId,
      contextId: "ctx-marker",
      version: draft.version,
    },
  );
});

for (const scenario of [
  {
    name: "a mismatched completed context",
    scopedResult: completed("ctx-other", "generate"),
    code: "AGENT_CONTEXT_MISMATCH",
  },
  {
    name: "an incomplete Corti task",
    scopedResult: {
      contextId: "ctx-fresh",
      taskId: "generate",
      state: "failed",
    },
    code: "AGENT_TASK_INCOMPLETE",
  },
] as const) {
  test(`rejects ${scenario.name}`, async (t) => {
    const { store, handover } = harness(t);
    let callCount = 0;
    const gateway: AgentGateway = {
      async send() {
        callCount += 1;
        return callCount === 1
          ? completed("ctx-fresh", "warmup")
          : scenario.scopedResult;
      },
      async waitForCompletion(result) {
        return result;
      },
    };

    await assert.rejects(
      new HandoverAgentRunner(gateway, store, MCP_TOKEN).generate({
        handoverId: handover.handoverId,
        patientId: PATIENT_ID,
        reason: "on_demand",
        focus: "Medication safety",
        idempotencyKey: "handover-request-1",
      }),
      (error) => assertDomainError(error, scenario.code, true),
    );
    assert.equal(
      store.requireHandover(handover.handoverId).status,
      "requested",
    );
  });
}

test("rejects a completed Corti result when no draft was persisted", async (t) => {
  const { store, handover } = harness(t);
  let callCount = 0;
  const gateway: AgentGateway = {
    async send() {
      callCount += 1;
      return completed("ctx-fresh", callCount === 1 ? "warmup" : "generate");
    },
    async waitForCompletion(result) {
      return result;
    },
  };

  await assert.rejects(
    new HandoverAgentRunner(gateway, store, MCP_TOKEN).generate({
      handoverId: handover.handoverId,
      patientId: PATIENT_ID,
      reason: "on_demand",
      focus: "Medication safety",
      idempotencyKey: "handover-request-1",
    }),
    (error) => assertDomainError(error, "HANDOVER_DRAFT_UNCONFIRMED", true),
  );
});

test("rejects a warmup context that is already mapped", async (t) => {
  const { store, handover } = harness(t);
  store.putContextMapping("ctx-reused", "interaction-other", PATIENT_ID, NOW);
  const gateway: AgentGateway = {
    async send() {
      return completed("ctx-reused", "warmup");
    },
    async waitForCompletion(result) {
      return result;
    },
  };

  await assert.rejects(
    new HandoverAgentRunner(gateway, store, MCP_TOKEN).generate({
      handoverId: handover.handoverId,
      patientId: PATIENT_ID,
      reason: "on_demand",
      focus: "Medication safety",
      idempotencyKey: "handover-request-1",
    }),
    (error) =>
      assertDomainError(error, "AGENT_CONTEXT_INITIALIZATION_FAILED", true),
  );
  assert.equal(store.contextForInteraction("interaction-other"), "ctx-reused");
  assert.equal(store.contextForInteraction(handover.interactionId), null);
});

test("rejects a second agent run after a draft has already been saved", async (t) => {
  const { store, handovers, handover } = harness(t);
  store.putContextMapping("ctx-first", handover.interactionId, PATIENT_ID, NOW);
  handovers.saveDraft({
    handoverId: handover.handoverId,
    patientId: PATIENT_ID,
    contextId: "ctx-first",
    packet: PACKET,
  });
  let callCount = 0;
  const gateway: AgentGateway = {
    async send() {
      callCount += 1;
      return completed("ctx-never", "never");
    },
    async waitForCompletion(result) {
      return result;
    },
  };

  await assert.rejects(
    new HandoverAgentRunner(gateway, store, MCP_TOKEN).generate({
      handoverId: handover.handoverId,
      patientId: PATIENT_ID,
      reason: "on_demand",
      focus: "Medication safety",
      idempotencyKey: "handover-request-1",
    }),
    (error) => assertDomainError(error, "HANDOVER_DRAFT_CONFLICT", false),
  );
  assert.equal(callCount, 0);
});
