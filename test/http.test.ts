import assert from "node:assert/strict";
import test from "node:test";

import {
  type GenerateHandoverInput,
  HandoverAgentRunner,
} from "../src/agent/handover-runner.js";
import type { AgentGateway } from "../src/agent/runner.js";
import { DomainError } from "../src/domain/errors.js";
import type {
  HandoverPacket,
  HandoverRecord,
  RenderedHandover,
} from "../src/domain/handover.js";
import {
  claimHandoverAgentContext,
  verifyHandoverAgentDraft,
} from "../src/services/handover-verification.js";
import {
  appHeaders,
  close,
  createAppHarness,
  listen,
  MCP_TOKEN,
  UI_ORIGIN,
} from "./support.js";

const HANDOVER_PACKET: HandoverPacket = {
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
  unknowns: ["The response to the change is not documented."],
};

const RENDERED_HANDOVER: RenderedHandover = {
  title: "Karen Jensen handover",
  sections: [
    {
      sectionId: "situation",
      heading: "Situation",
      statements: HANDOVER_PACKET.situation,
    },
    {
      sectionId: "unknowns",
      heading: "Unknowns",
      statements: HANDOVER_PACKET.unknowns.map((statement) => ({
        statement,
        sourceRefs: [],
      })),
    },
  ],
  creditsConsumed: 0.5,
};

interface HandoverEnvelope {
  replayed: boolean;
  lifecycleStatus: "draft" | "rendered";
  handover: {
    handoverId: string;
    patientId: string;
    status: "draft";
    renderingStatus: "pending" | "rendered";
    reason: "assignment" | "on_demand";
    requestedBy: string;
    generatedAt: string | null;
    version: number;
    sourceSnapshotHash: string;
    packet: HandoverPacket;
    rendered: RenderedHandover | null;
    activity: Array<{
      eventType: string;
      payload: Record<string, unknown>;
    }>;
  };
}

function handoverRequest(overrides: Record<string, unknown> = {}) {
  return {
    reason: "on_demand",
    focus: "Medication safety",
    idempotencyKey: "handover-http-001",
    ...overrides,
  };
}

function createSavingHandoverHarness(
  hooks: {
    afterSave?: (input: GenerateHandoverInput) => Promise<void> | void;
    afterVerification?: (input: GenerateHandoverInput) => Promise<void> | void;
  } = {},
) {
  let implementation:
    | ((input: GenerateHandoverInput) => Promise<HandoverRecord>)
    | undefined;
  let calls = 0;
  const runner = {
    async generate(input: GenerateHandoverInput): Promise<HandoverRecord> {
      calls += 1;
      assert.ok(implementation);
      return implementation(input);
    },
  };
  const harness = createAppHarness({ handoverRunner: runner });
  implementation = async (input) => {
    const contextId = `ctx-http-${input.handoverId}`;
    assert.equal(
      claimHandoverAgentContext(harness.store, {
        handoverId: input.handoverId,
        contextId,
        occurredAt: harness.clock.now().toISOString(),
      }),
      true,
    );
    const saved = harness.handovers.saveDraft({
      handoverId: input.handoverId,
      patientId: input.patientId,
      contextId,
      packet: HANDOVER_PACKET,
    });
    await hooks.afterSave?.(input);
    verifyHandoverAgentDraft(harness.store, {
      handoverId: input.handoverId,
      contextId,
      idempotencyKey: input.idempotencyKey,
    });
    await hooks.afterVerification?.(input);
    return saved;
  };
  return { ...harness, runnerCalls: () => calls };
}

function rpcHeaders(sessionId?: string, authenticated = true): Headers {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  });
  if (authenticated) headers.set("authorization", `Bearer ${MCP_TOKEN}`);
  if (sessionId !== undefined) headers.set("mcp-session-id", sessionId);
  return headers;
}

async function initializeMcp(baseUrl: string, path: string, id: number) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: rpcHeaders(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "http-contract-test", version: "1.0.0" },
      },
    }),
  });
  assert.equal(response.status, 200);
  const sessionId = response.headers.get("mcp-session-id");
  assert.ok(sessionId);
  return sessionId;
}

async function listMcpTools(
  baseUrl: string,
  path: string,
  sessionId: string,
  id: number,
) {
  const initialized = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: rpcHeaders(sessionId),
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  });
  assert.equal(initialized.status, 202);
  const listed = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: rpcHeaders(sessionId),
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list" }),
  });
  assert.equal(listed.status, 200);
  const result = (await listed.json()) as {
    result: { tools: Array<{ name: string }> };
  };
  return result.result.tools.map((tool) => tool.name).toSorted();
}

test("handover draft creation requires service auth, attribution, and a configured runner", async (t) => {
  const configured = createSavingHandoverHarness();
  const configuredServer = await listen(configured.app);
  const unconfigured = createAppHarness();
  const unconfiguredServer = await listen(unconfigured.app);
  t.after(async () => {
    await close(configuredServer.server);
    configured.store.close();
    await close(unconfiguredServer.server);
    unconfigured.store.close();
  });

  const unauthenticated = await fetch(
    `${configuredServer.baseUrl}/api/patients/synthetic-karen/handover-drafts`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(handoverRequest()),
    },
  );
  assert.equal(unauthenticated.status, 401);

  const unattributed = await fetch(
    `${configuredServer.baseUrl}/api/patients/synthetic-karen/handover-drafts`,
    {
      method: "POST",
      headers: appHeaders(),
      body: JSON.stringify(handoverRequest()),
    },
  );
  assert.equal(unattributed.status, 400);
  assert.equal(
    ((await unattributed.json()) as { error: { code: string } }).error.code,
    "ACTOR_REQUIRED",
  );

  const unavailable = await fetch(
    `${unconfiguredServer.baseUrl}/api/patients/synthetic-karen/handover-drafts`,
    {
      method: "POST",
      headers: appHeaders("clinician-1"),
      body: JSON.stringify(handoverRequest()),
    },
  );
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    error: {
      code: "CORTI_HANDOVER_AGENT_NOT_CONFIGURED",
      message: "Corti handover generation is not configured",
      retryable: false,
    },
  });
  assert.equal(
    unconfigured.store.listPatientHandovers("synthetic-karen").length,
    0,
  );
  assert.equal(configured.runnerCalls(), 0);
});

test("handover draft requests strictly validate reason, focus, and idempotency", async (t) => {
  const harness = createSavingHandoverHarness();
  const { server, baseUrl } = await listen(harness.app);
  t.after(async () => {
    await close(server);
    harness.store.close();
  });

  const invalidBodies = [
    handoverRequest({ reason: "discharge" }),
    handoverRequest({ focus: "   " }),
    handoverRequest({ idempotencyKey: "short" }),
    handoverRequest({ unexpected: true }),
  ];
  for (const body of invalidBodies) {
    const response = await fetch(
      `${baseUrl}/api/patients/synthetic-karen/handover-drafts`,
      {
        method: "POST",
        headers: appHeaders("clinician-1"),
        body: JSON.stringify(body),
      },
    );
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(
      ((await response.json()) as { error: { code: string } }).error.code,
      "VALIDATION_ERROR",
    );
  }
  assert.equal(harness.runnerCalls(), 0);
  assert.equal(harness.store.listPatientHandovers("synthetic-karen").length, 0);
});

test("handover draft creation and replay expose only the safe lifecycle envelope", async (t) => {
  const harness = createSavingHandoverHarness();
  const { server, baseUrl } = await listen(harness.app);
  t.after(async () => {
    await close(server);
    harness.store.close();
  });
  const url = `${baseUrl}/api/patients/synthetic-karen/handover-drafts`;
  const request = {
    method: "POST",
    headers: appHeaders("clinician-1"),
    body: JSON.stringify(handoverRequest()),
  };

  const created = await fetch(url, request);
  assert.equal(created.status, 201);
  const createdBody = (await created.json()) as HandoverEnvelope;
  assert.equal(createdBody.replayed, false);
  assert.equal(createdBody.lifecycleStatus, "draft");
  assert.equal(createdBody.handover.patientId, "synthetic-karen");
  assert.equal(createdBody.handover.status, "draft");
  assert.equal(createdBody.handover.renderingStatus, "pending");
  assert.equal(createdBody.handover.requestedBy, "clinician-1");
  assert.equal(createdBody.handover.version, 2);
  assert.deepEqual(createdBody.handover.packet, HANDOVER_PACKET);
  assert.equal("requestHash" in createdBody.handover, false);
  assert.equal("focus" in createdBody.handover, false);
  assert.deepEqual(
    createdBody.handover.activity.map(({ eventType }) => eventType),
    [
      "handover.requested",
      "handover.context_initialized",
      "handover.sources_retrieved",
      "handover.draft_saved",
      "handover.render_requested",
    ],
  );
  const serializedActivity = JSON.stringify(createdBody.handover.activity);
  assert.doesNotMatch(
    serializedActivity,
    /Medication safety|Karen has|mcp-secret/,
  );
  assert.equal(harness.runnerCalls(), 1);

  const replay = await fetch(url, request);
  assert.equal(replay.status, 200);
  const replayBody = (await replay.json()) as HandoverEnvelope;
  assert.equal(replayBody.replayed, true);
  assert.equal(replayBody.lifecycleStatus, "draft");
  assert.equal(harness.runnerCalls(), 1);
  assert.equal(
    replayBody.handover.activity.filter(
      ({ eventType }) => eventType === "handover.render_requested",
    ).length,
    2,
  );
});

test("handover finalization validates input, replays exactly, and supports safe GET", async (t) => {
  const harness = createSavingHandoverHarness();
  const { server, baseUrl } = await listen(harness.app);
  t.after(async () => {
    await close(server);
    harness.store.close();
  });
  const draftResponse = await fetch(
    `${baseUrl}/api/patients/synthetic-karen/handover-drafts`,
    {
      method: "POST",
      headers: appHeaders("clinician-1"),
      body: JSON.stringify(handoverRequest()),
    },
  );
  const draft = (await draftResponse.json()) as HandoverEnvelope;
  const finalizeUrl = `${baseUrl}/api/handovers/${draft.handover.handoverId}/finalize`;
  const validBody = {
    expectedVersion: draft.handover.version,
    sourceSnapshotHash: draft.handover.sourceSnapshotHash,
    rendered: RENDERED_HANDOVER,
  };

  const noActor = await fetch(finalizeUrl, {
    method: "POST",
    headers: appHeaders(),
    body: JSON.stringify(validBody),
  });
  assert.equal(noActor.status, 400);
  assert.equal(
    ((await noActor.json()) as { error: { code: string } }).error.code,
    "ACTOR_REQUIRED",
  );

  for (const body of [
    { ...validBody, expectedVersion: 0 },
    { ...validBody, sourceSnapshotHash: "not-a-hash" },
    { ...validBody, rendered: { title: "Incomplete" } },
    { ...validBody, unexpected: true },
  ]) {
    const invalid = await fetch(finalizeUrl, {
      method: "POST",
      headers: appHeaders("pipeline:text-generation"),
      body: JSON.stringify(body),
    });
    assert.equal(invalid.status, 400, JSON.stringify(body));
    assert.equal(
      ((await invalid.json()) as { error: { code: string } }).error.code,
      "VALIDATION_ERROR",
    );
  }

  for (const body of [
    { ...validBody, expectedVersion: validBody.expectedVersion + 1 },
    { ...validBody, sourceSnapshotHash: `sha256:${"f".repeat(64)}` },
  ]) {
    const conflict = await fetch(finalizeUrl, {
      method: "POST",
      headers: appHeaders("pipeline:text-generation"),
      body: JSON.stringify(body),
    });
    assert.equal(conflict.status, 409);
    assert.equal(
      ((await conflict.json()) as { error: { code: string } }).error.code,
      "HANDOVER_FINALIZE_CONFLICT",
    );
  }

  const finalizationRequest = () =>
    fetch(finalizeUrl, {
      method: "POST",
      headers: appHeaders("pipeline:text-generation"),
      body: JSON.stringify(validBody),
    });
  const finalizationResponses = await Promise.all([
    finalizationRequest(),
    finalizationRequest(),
  ]);
  assert.deepEqual(
    finalizationResponses.map(({ status }) => status).toSorted(),
    [200, 201],
  );
  const finalizationBodies = (await Promise.all(
    finalizationResponses.map((response) => response.json()),
  )) as HandoverEnvelope[];
  assert.deepEqual(
    finalizationBodies.map(({ replayed }) => replayed).toSorted(),
    [false, true],
  );
  const finalizedBody = finalizationBodies.find(({ replayed }) => !replayed);
  assert.ok(finalizedBody);
  assert.equal(finalizedBody.replayed, false);
  assert.equal(finalizedBody.lifecycleStatus, "rendered");
  assert.equal(finalizedBody.handover.status, "draft");
  assert.equal(finalizedBody.handover.renderingStatus, "rendered");
  assert.deepEqual(finalizedBody.handover.rendered, RENDERED_HANDOVER);
  assert.equal(
    harness.store
      .listEvents(0)
      .filter(({ eventType }) => eventType === "handover.rendered").length,
    1,
  );

  const getResponse = await fetch(
    `${baseUrl}/api/handovers/${draft.handover.handoverId}`,
    { headers: appHeaders() },
  );
  assert.equal(getResponse.status, 200);
  const projection = (await getResponse.json()) as HandoverEnvelope["handover"];
  assert.equal(projection.handoverId, draft.handover.handoverId);
  assert.equal(projection.status, "draft");
  assert.equal(projection.renderingStatus, "rendered");
  assert.equal("requestHash" in projection, false);

  const renderedDraftReplay = await fetch(
    `${baseUrl}/api/patients/synthetic-karen/handover-drafts`,
    {
      method: "POST",
      headers: appHeaders("clinician-1"),
      body: JSON.stringify(handoverRequest()),
    },
  );
  assert.equal(renderedDraftReplay.status, 200);
  const renderedDraftBody =
    (await renderedDraftReplay.json()) as HandoverEnvelope;
  assert.equal(renderedDraftBody.lifecycleStatus, "rendered");
  assert.equal(harness.runnerCalls(), 1);
  assert.equal(
    renderedDraftBody.handover.activity.filter(
      ({ eventType }) => eventType === "handover.render_requested",
    ).length,
    1,
  );
});

test("handover finalization fails retryably when patient sources changed", async (t) => {
  const harness = createSavingHandoverHarness();
  const { server, baseUrl } = await listen(harness.app);
  t.after(async () => {
    await close(server);
    harness.store.close();
  });
  const draftResponse = await fetch(
    `${baseUrl}/api/patients/synthetic-karen/handover-drafts`,
    {
      method: "POST",
      headers: appHeaders("clinician-1"),
      body: JSON.stringify(handoverRequest()),
    },
  );
  const draft = (await draftResponse.json()) as HandoverEnvelope;
  const record = harness.store
    .listRecordItems("synthetic-karen")
    .find(({ sourceRef }) => sourceRef === "record:medication-1");
  assert.ok(record);
  harness.store.putRecordItem({ ...record, text: "Source changed later" });

  const response = await fetch(
    `${baseUrl}/api/handovers/${draft.handover.handoverId}/finalize`,
    {
      method: "POST",
      headers: appHeaders("pipeline:text-generation"),
      body: JSON.stringify({
        expectedVersion: draft.handover.version,
        sourceSnapshotHash: draft.handover.sourceSnapshotHash,
        rendered: RENDERED_HANDOVER,
      }),
    },
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: {
      code: "HANDOVER_SOURCE_CHANGED",
      message: "Handover sources changed after the draft was saved",
      retryable: true,
    },
  });
  assert.equal(
    harness.store.requireHandover(draft.handover.handoverId).status,
    "draft",
  );
  assert.equal(
    harness.store
      .listEvents(0)
      .filter(({ eventType }) => eventType === "handover.source_changed")
      .length,
    1,
  );
});

test("handover agent failures persist only a safe failed state and audit milestone", async (t) => {
  const runner = {
    async generate(): Promise<HandoverRecord> {
      throw new Error("mcp-secret sensitive Corti detail");
    },
  };
  const harness = createAppHarness({ handoverRunner: runner });
  const { server, baseUrl } = await listen(harness.app);
  t.after(async () => {
    await close(server);
    harness.store.close();
  });

  const response = await fetch(
    `${baseUrl}/api/patients/synthetic-karen/handover-drafts`,
    {
      method: "POST",
      headers: appHeaders("clinician-1"),
      body: JSON.stringify(
        handoverRequest({ idempotencyKey: "handover-http-failure" }),
      ),
    },
  );
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.deepEqual(body, {
    error: {
      code: "CORTI_HANDOVER_AGENT_FAILED",
      message:
        "Corti handover generation failed; retry with a new idempotency key",
      retryable: true,
    },
  });
  assert.doesNotMatch(
    JSON.stringify(body),
    /mcp-secret|sensitive Corti detail/,
  );

  const [failed] = harness.store.listPatientHandovers("synthetic-karen");
  assert.ok(failed);
  assert.equal(failed.status, "failed");
  const event = harness.store
    .listEvents(0)
    .find(({ eventType }) => eventType === "handover.failed");
  assert.ok(event);
  assert.deepEqual(event.payload, {
    handoverId: failed.handoverId,
    code: "CORTI_HANDOVER_AGENT_FAILED",
    retryable: true,
    status: "failed",
    version: 2,
  });
  assert.doesNotMatch(
    JSON.stringify(event),
    /mcp-secret|sensitive Corti detail/,
  );
});

test("typed Corti failures reject a saved draft and require a new idempotency key", async (t) => {
  const cases = [
    {
      code: "AGENT_TASK_INCOMPLETE",
      message: "Corti did not complete the requested handover",
    },
    {
      code: "AGENT_CONTEXT_MISMATCH",
      message: "Corti returned a different handover context",
    },
  ];

  for (const [index, current] of cases.entries()) {
    const harness = createSavingHandoverHarness({
      afterSave: () => {
        throw new DomainError(current.code, current.message, true, 502);
      },
    });
    const { server, baseUrl } = await listen(harness.app);
    t.after(async () => {
      await close(server);
      harness.store.close();
    });
    const idempotencyKey = `handover-semantic-failure-${index}`;
    const url = `${baseUrl}/api/patients/synthetic-karen/handover-drafts`;
    const request = {
      method: "POST",
      headers: appHeaders("clinician-1"),
      body: JSON.stringify(handoverRequest({ idempotencyKey })),
    };

    const failedResponse = await fetch(url, request);
    assert.equal(failedResponse.status, 502);
    const failedBody = await failedResponse.json();
    assert.deepEqual(failedBody, {
      error: {
        code: "CORTI_HANDOVER_AGENT_FAILED",
        message:
          "Corti handover generation failed; retry with a new idempotency key",
        retryable: true,
      },
    });
    assert.doesNotMatch(
      JSON.stringify(failedBody),
      /Medication safety|Karen has|mcp-secret/,
    );

    const [failed] = harness.store.listPatientHandovers("synthetic-karen");
    assert.ok(failed);
    assert.equal(failed.status, "failed");
    assert.equal(failed.version, 3);
    assert.deepEqual(failed.packet, HANDOVER_PACKET);
    assert.ok(failed.sourceSnapshot);
    assert.ok(failed.sourceSnapshotHash);
    const handoverEvents = harness.store
      .listEvents(0)
      .filter(({ payload }) => payload.handoverId === failed.handoverId);
    assert.equal(
      handoverEvents.some(
        ({ eventType }) => eventType === "handover.render_requested",
      ),
      false,
    );
    const failedEvent = handoverEvents.find(
      ({ eventType }) => eventType === "handover.failed",
    );
    assert.ok(failedEvent);
    assert.equal(failedEvent.payload.code, current.code);
    assert.doesNotMatch(
      JSON.stringify(failedEvent),
      /Medication safety|Karen has|mcp-secret/,
    );

    const replay = await fetch(url, request);
    assert.equal(replay.status, 409);
    assert.equal(
      ((await replay.json()) as { error: { code: string } }).error.code,
      "HANDOVER_RETRY_REQUIRES_NEW_KEY",
    );
    assert.equal(harness.runnerCalls(), 1);
  }
});

test("an unverified in-flight draft cannot replay before the Corti terminal result", async (t) => {
  let generate:
    | ((input: GenerateHandoverInput) => Promise<HandoverRecord>)
    | undefined;
  let runnerCalls = 0;
  const proxyRunner = {
    async generate(input: GenerateHandoverInput): Promise<HandoverRecord> {
      runnerCalls += 1;
      assert.ok(generate);
      return generate(input);
    },
  };
  const harness = createAppHarness({ handoverRunner: proxyRunner });
  let signalDraftSaved: (() => void) | undefined;
  const draftSaved = new Promise<void>((resolve) => {
    signalDraftSaved = resolve;
  });
  let releaseTerminalResult: (() => void) | undefined;
  const terminalResultReleased = new Promise<void>((resolve) => {
    releaseTerminalResult = resolve;
  });
  let sends = 0;
  const gateway: AgentGateway = {
    async send(input) {
      sends += 1;
      assert.ok(input.contextId);
      const contextId = input.contextId;
      const handoverId = String(input.data?.handoverId);
      harness.handovers.saveDraft({
        handoverId,
        patientId: "synthetic-karen",
        contextId,
        packet: HANDOVER_PACKET,
      });
      signalDraftSaved?.();
      return {
        contextId,
        taskId: "generate",
        state: "submitted",
      };
    },
    async waitForCompletion(result) {
      await terminalResultReleased;
      return { ...result, state: "failed" };
    },
  };
  const realRunner = new HandoverAgentRunner(gateway, harness.store, MCP_TOKEN);
  generate = (input) => realRunner.generate(input);
  const { server, baseUrl } = await listen(harness.app);
  t.after(async () => {
    releaseTerminalResult?.();
    await close(server);
    harness.store.close();
  });
  const url = `${baseUrl}/api/patients/synthetic-karen/handover-drafts`;
  const request = {
    method: "POST",
    headers: appHeaders("clinician-1"),
    body: JSON.stringify(
      handoverRequest({ idempotencyKey: "handover-concurrent-unverified" }),
    ),
  };

  const originalPromise = fetch(url, request);
  await draftSaved;
  const concurrent = await fetch(url, request);
  releaseTerminalResult?.();
  const original = await originalPromise;

  assert.equal(concurrent.status, 409);
  assert.deepEqual(await concurrent.json(), {
    error: {
      code: "HANDOVER_IN_PROGRESS",
      message: "Handover generation is already in progress",
      retryable: true,
    },
  });
  assert.equal(original.status, 502);
  assert.equal(
    ((await original.json()) as { error: { code: string } }).error.code,
    "CORTI_HANDOVER_AGENT_FAILED",
  );
  const [failed] = harness.store.listPatientHandovers("synthetic-karen");
  assert.ok(failed);
  assert.equal(failed.status, "failed");
  assert.equal(runnerCalls, 1);
  assert.equal(sends, 1);
  assert.equal(
    harness.store
      .listEvents(0)
      .some(({ eventType }) => eventType === "handover.render_requested"),
    false,
  );
});

test("an unverified transport loss after durable draft save rejects the draft", async (t) => {
  const harness = createSavingHandoverHarness({
    afterSave: () => {
      throw new Error("socket reset before verification: mcp-secret");
    },
  });
  const { server, baseUrl } = await listen(harness.app);
  t.after(async () => {
    await close(server);
    harness.store.close();
  });

  const response = await fetch(
    `${baseUrl}/api/patients/synthetic-karen/handover-drafts`,
    {
      method: "POST",
      headers: appHeaders("clinician-1"),
      body: JSON.stringify(
        handoverRequest({ idempotencyKey: "handover-lost-response" }),
      ),
    },
  );
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.deepEqual(body, {
    error: {
      code: "CORTI_HANDOVER_AGENT_FAILED",
      message:
        "Corti handover generation failed; retry with a new idempotency key",
      retryable: true,
    },
  });
  const [failed] = harness.store.listPatientHandovers("synthetic-karen");
  assert.ok(failed);
  assert.equal(failed.status, "failed");
  assert.equal(harness.runnerCalls(), 1);
  assert.equal(
    harness.store
      .listEvents(0)
      .some(({ eventType }) => eventType === "handover.render_requested"),
    false,
  );
  assert.doesNotMatch(JSON.stringify(body), /mcp-secret/);
});

test("an ambiguous loss after durable agent verification recovers the draft", async (t) => {
  const harness = createSavingHandoverHarness({
    afterVerification: () => {
      throw new Error("socket reset after verification: mcp-secret");
    },
  });
  const { server, baseUrl } = await listen(harness.app);
  t.after(async () => {
    await close(server);
    harness.store.close();
  });

  const response = await fetch(
    `${baseUrl}/api/patients/synthetic-karen/handover-drafts`,
    {
      method: "POST",
      headers: appHeaders("clinician-1"),
      body: JSON.stringify(
        handoverRequest({ idempotencyKey: "handover-verified-response-loss" }),
      ),
    },
  );
  assert.equal(response.status, 201);
  const body = (await response.json()) as HandoverEnvelope;
  assert.equal(body.lifecycleStatus, "draft");
  assert.equal(body.handover.renderingStatus, "pending");
  assert.equal(harness.runnerCalls(), 1);
  assert.doesNotMatch(JSON.stringify(body.handover.activity), /mcp-secret/);
});

test("health is public while application and MCP data surfaces require their bearer", async (t) => {
  const harness = createAppHarness();
  const { server, baseUrl } = await listen(harness.app);
  t.after(async () => {
    await close(server);
    harness.store.close();
  });

  const health = await fetch(`${baseUrl}/healthz`, {
    headers: { origin: UI_ORIGIN },
  });
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    ok: true,
    agents: { task: false, handover: false, meeting: false },
  });
  assert.equal(health.headers.get("access-control-allow-origin"), UI_ORIGIN);

  const deniedOrigin = await fetch(`${baseUrl}/healthz`, {
    headers: { origin: "https://evil.example" },
  });
  assert.equal(deniedOrigin.headers.get("access-control-allow-origin"), null);
  assert.equal(
    (await fetch(`${baseUrl}/api/teams/district-nursing/tasks`)).status,
    401,
  );
  assert.equal(
    (
      await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        }),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(`${baseUrl}/mcp/handover`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
        }),
      })
    ).status,
    401,
  );
});

test("task and handover MCP endpoints expose separate authenticated sessions and tool sets", async (t) => {
  const harness = createAppHarness();
  const { server, baseUrl } = await listen(harness.app);
  t.after(async () => {
    await close(server);
    harness.store.close();
  });

  const taskSession = await initializeMcp(baseUrl, "/mcp", 10);
  const handoverSession = await initializeMcp(baseUrl, "/mcp/handover", 11);

  assert.deepEqual(await listMcpTools(baseUrl, "/mcp", taskSession, 12), [
    "create_task_draft",
    "get_patient_context",
    "get_task",
    "list_eligible_teams",
    "list_open_threads",
    "publish_team_task",
  ]);
  assert.deepEqual(
    await listMcpTools(baseUrl, "/mcp/handover", handoverSession, 13),
    [
      "get_patient_context",
      "get_task",
      "list_open_threads",
      "list_patient_tasks",
      "save_handover_draft",
    ],
  );

  const crossed = await fetch(`${baseUrl}/mcp/handover`, {
    method: "POST",
    headers: rpcHeaders(taskSession),
    body: JSON.stringify({ jsonrpc: "2.0", id: 14, method: "tools/list" }),
  });
  assert.equal(crossed.status, 400);
  assert.match(await crossed.text(), /Invalid MCP session/);
});

test("reference-only pipeline signal is retained but blocked from evidence-grounded agent drafting", async (t) => {
  const harness = createAppHarness();
  const { server, baseUrl } = await listen(harness.app);
  t.after(async () => {
    await close(server);
    harness.store.close();
  });

  const response = await fetch(`${baseUrl}/api/signals`, {
    method: "POST",
    headers: appHeaders("pipeline:candidate-handoff"),
    body: JSON.stringify({
      patientId: "synthetic-karen",
      interactionId: "interaction-karen-1",
      signalText: "Dizziness needs follow-through",
      evidenceRefs: ["encounter:candidate-abc.1"],
      idempotencyKey: "candidate-candidate-abc",
    }),
  });

  assert.equal(response.status, 202);
  const result = (await response.json()) as Record<string, unknown>;
  assert.equal(result.status, "retained");
  assert.equal(result.investigationStatus, "blocked_missing_source_evidence");
  assert.equal(
    result.recovery,
    "RESUBMIT_WITH_SOURCE_EVIDENCE_OR_CREATE_MANUAL_TASK",
  );
  assert.deepEqual(result.missingEvidenceRefs, ["encounter:candidate-abc.1"]);
  assert.equal(
    harness.store.hasRecordEvidence("synthetic-karen", [
      "encounter:candidate-abc.1",
    ]),
    false,
  );
  const event = harness.store
    .listEvents(0)
    .find((candidate) => candidate.eventId === result.signalEventId);
  assert.ok(event);
  assert.equal(event.payload.signalText, undefined);
  assert.deepEqual(event.payload.evidenceRefs, ["encounter:candidate-abc.1"]);
});

test("complete source evidence is atomically registered for the patient-scoped agent record", async (t) => {
  const harness = createAppHarness();
  const { server, baseUrl } = await listen(harness.app);
  t.after(async () => {
    await close(server);
    harness.store.close();
  });

  const response = await fetch(`${baseUrl}/api/signals`, {
    method: "POST",
    headers: appHeaders("pipeline:candidate-handoff"),
    body: JSON.stringify({
      patientId: "synthetic-karen",
      interactionId: "interaction-karen-1",
      signalText: "Dizziness needs follow-through",
      evidenceRefs: ["encounter:candidate-abc.1"],
      sourceEvidence: [
        {
          evidenceRef: "encounter:candidate-abc.1",
          sourceQuote: "I feel dizzy when I stand up.",
          startSeconds: 10,
          endSeconds: 12,
          speakerId: 1,
        },
      ],
      idempotencyKey: "candidate-candidate-abc-with-source",
    }),
  });

  assert.equal(response.status, 202);
  const result = (await response.json()) as Record<string, unknown>;
  assert.equal(typeof result.signalEventId, "string");
  assert.deepEqual(
    { ...result, signalEventId: "event-id" },
    {
      signalEventId: "event-id",
      status: "retained",
      investigationStatus: "ready",
      recovery: "AGENT_INVESTIGATION_AVAILABLE",
      evidenceRefs: ["encounter:candidate-abc.1"],
    },
  );
  assert.equal(
    harness.store.hasRecordEvidence("synthetic-karen", [
      "encounter:candidate-abc.1",
    ]),
    true,
  );
  assert.equal(
    harness.store
      .listRecordItems("synthetic-karen")
      .find((item) => item.sourceRef === "encounter:candidate-abc.1")?.text,
    "I feel dizzy when I stand up.",
  );
});

test("patient lists, approval commands, and errors match the integration gateway contract", async (t) => {
  const harness = createAppHarness();
  const draft = harness.ledger.createKarenDraft("ctx-karen", "draft-http");
  const { server, baseUrl } = await listen(harness.app);
  t.after(async () => {
    await close(server);
    harness.store.close();
  });

  const threads = await fetch(
    `${baseUrl}/api/patients/synthetic-karen/threads`,
    { headers: appHeaders() },
  );
  assert.equal(threads.status, 200);
  assert.equal(
    ((await threads.json()) as { threads: unknown[] }).threads.length,
    1,
  );
  const tasks = await fetch(`${baseUrl}/api/patients/synthetic-karen/tasks`, {
    headers: appHeaders(),
  });
  assert.equal(tasks.status, 200);
  assert.equal(((await tasks.json()) as { tasks: unknown[] }).tasks.length, 1);

  const approval = await fetch(`${baseUrl}/api/tasks/${draft.taskId}/approve`, {
    method: "POST",
    headers: appHeaders("clinician-1"),
    body: JSON.stringify({
      expectedVersion: draft.version,
      idempotencyKey: "approve-http-001",
    }),
  });
  assert.equal(approval.status, 200);
  const approved = (await approval.json()) as Record<string, unknown>;
  assert.equal(approved.taskId, draft.taskId);
  assert.equal(approved.status, "approved_not_published");
  assert.equal(typeof approved.approvalProof, "string");

  const noActor = await fetch(`${baseUrl}/api/tasks/${draft.taskId}/dismiss`, {
    method: "POST",
    headers: appHeaders(),
    body: JSON.stringify({
      expectedVersion: draft.version,
      reason: "Already covered",
      idempotencyKey: "dismiss-http-no-actor",
    }),
  });
  assert.equal(noActor.status, 400);
  assert.deepEqual(await noActor.json(), {
    error: {
      code: "ACTOR_REQUIRED",
      message: "x-actor-id is required",
      retryable: false,
    },
  });
});

test("patient task list omits terminal work whose closed thread is absent from the active list", async (t) => {
  const harness = createAppHarness();
  const draft = harness.ledger.createKarenDraft(
    "ctx-karen",
    "terminal-list-draft",
  );
  const approval = harness.ledger.approveDraft(
    draft.taskId,
    draft.version,
    "clinician-1",
    "app_one_tap",
    "terminal-list-approve",
  );
  const offered = harness.ledger.publishDraft(
    draft.taskId,
    approval.proof,
    draft.version,
    "terminal-list-publish",
  );
  const accepted = harness.ledger.acceptTask(
    offered.taskId,
    offered.version,
    "nurse-a",
    "terminal-list-accept",
  );
  const completed = harness.ledger.completeTask(
    accepted.taskId,
    accepted.version,
    "nurse-a",
    "record:terminal-list-outcome",
  );
  harness.ledger.verifyTask(
    completed.taskId,
    completed.version,
    "record:terminal-list-outcome",
    "downstream:terminal-list",
  );

  const { server, baseUrl } = await listen(harness.app);
  t.after(async () => {
    await close(server);
    harness.store.close();
  });

  const threads = await fetch(
    `${baseUrl}/api/patients/synthetic-karen/threads`,
    {
      headers: appHeaders(),
    },
  );
  const tasks = await fetch(`${baseUrl}/api/patients/synthetic-karen/tasks`, {
    headers: appHeaders(),
  });

  assert.equal(threads.status, 200);
  assert.equal(tasks.status, 200);
  assert.deepEqual(await threads.json(), { threads: [] });
  assert.deepEqual(await tasks.json(), { tasks: [] });
});

test("external readback verification requires a downstream actor and replays exactly", async (t) => {
  const harness = createAppHarness();
  const draft = harness.ledger.createKarenDraft(
    "ctx-karen",
    "draft-http-external-readback",
  );
  const approval = harness.ledger.approveDraft(
    draft.taskId,
    draft.version,
    "clinician-1",
    "app_one_tap",
    "approve-http-external-readback",
  );
  const offered = harness.ledger.publishDraft(
    draft.taskId,
    approval.proof,
    draft.version,
    "publish-http-external-readback",
  );
  const { server, baseUrl } = await listen(harness.app);
  t.after(async () => {
    await close(server);
    harness.store.close();
  });
  const url = `${baseUrl}/api/tasks/${draft.taskId}/verify-external`;
  const body = {
    expectedVersion: offered.version,
    outcomeRef: "ehr:result-44",
    deliveryId: "delivery-44",
    idempotencyKey: "external-readback-http-44",
  };

  const wrongActor = await fetch(url, {
    method: "POST",
    headers: appHeaders("clinician-1"),
    body: JSON.stringify(body),
  });
  assert.equal(wrongActor.status, 403);

  const verify = () =>
    fetch(url, {
      method: "POST",
      headers: appHeaders("downstream:district-nursing"),
      body: JSON.stringify(body),
    });
  const completed = await verify();
  assert.equal(completed.status, 200);
  assert.equal(
    ((await completed.json()) as { state: string }).state,
    "verified",
  );
  const replay = await verify();
  assert.equal(replay.status, 200);
  assert.equal(((await replay.json()) as { state: string }).state, "verified");
  assert.equal(
    harness.store
      .listEvents(0)
      .filter(({ eventType }) => eventType === "task.completion_verified")
      .length,
    1,
  );
});

test("source revisions expose review-only Change Radar impacts", async (t) => {
  const harness = createAppHarness();
  const draft = harness.ledger.createKarenDraft(
    "ctx-karen",
    "change-radar-http-draft",
  );
  const { server, baseUrl } = await listen(harness.app);
  t.after(async () => {
    await close(server);
    harness.store.close();
  });

  const revision = await fetch(
    `${baseUrl}/api/patients/synthetic-karen/source-revisions`,
    {
      method: "POST",
      headers: appHeaders("clinician-1"),
      body: JSON.stringify({
        sourceItemId: "karen-dizziness-signal",
        expectedSourceRef: "encounter:sentence-42",
        newText:
          "Dizziness now also occurs at rest after the medication change",
        reason: "clinical_note_revision",
        idempotencyKey: "change-radar-http-001",
      }),
    },
  );
  assert.equal(revision.status, 201);
  const result = (await revision.json()) as {
    reviewRequiredCount: number;
    impacts: Array<{ artifactId: string; status: string }>;
  };
  assert.equal(result.reviewRequiredCount, 1);
  assert.equal(result.impacts.length, 1);
  assert.equal(result.impacts[0]?.artifactId, draft.taskId);
  assert.equal(result.impacts[0]?.status, "review_required");

  const response = await fetch(
    `${baseUrl}/api/patients/synthetic-karen/change-impacts`,
    { headers: appHeaders() },
  );
  assert.equal(response.status, 200);
  const listed = (await response.json()) as { impacts: unknown[] };
  assert.equal(listed.impacts.length, 1);
  assert.equal(harness.ledger.getTask(draft.taskId).state, "draft");
});

test("SSE replays audit events after Last-Event-ID without credentials in the stream", async (t) => {
  const harness = createAppHarness();
  const startingSequence = harness.store.listEvents(0).at(-1)?.sequence ?? 0;
  harness.ledger.createKarenDraft("ctx-karen", "draft-sse");
  const { server, baseUrl } = await listen(harness.app);
  const controller = new AbortController();
  t.after(async () => {
    controller.abort();
    await close(server);
    harness.store.close();
  });

  const response = await fetch(`${baseUrl}/api/events/stream`, {
    headers: {
      authorization: "Bearer app-secret",
      "last-event-id": String(startingSequence),
    },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  const first = await response.body?.getReader().read();
  assert.ok(first?.value);
  const text = new TextDecoder().decode(first.value);
  assert.match(text, /event: task\.draft_created/);
  assert.doesNotMatch(text, /app-secret|mcp-secret/);
  controller.abort();
});

test("demo audience endpoints group QR joiners and expose only their assigned task", async (t) => {
  const harness = createAppHarness();
  const { server, baseUrl } = await listen(harness.app);
  t.after(async () => {
    await close(server);
    harness.store.close();
  });

  const create = await fetch(`${baseUrl}/api/demo/sessions`, {
    method: "POST",
    headers: appHeaders("clinician:demo-host"),
    body: JSON.stringify({
      title: "Audience discharge coordination",
      scenario: "discharge_coordination",
      groupSize: 2,
      targetTeamId: "district-nursing",
      idempotencyKey: "http-demo-session-001",
    }),
  });
  assert.equal(create.status, 201);
  const session = (await create.json()) as {
    sessionId: string;
    joinCode: string;
  };

  assert.equal(
    (
      await fetch(`${baseUrl}/api/demo/join/${session.joinCode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "Denied",
          joinKey: "browser-key-denied",
        }),
      })
    ).status,
    401,
  );

  const joined = await fetch(`${baseUrl}/api/demo/join/${session.joinCode}`, {
    method: "POST",
    headers: appHeaders(),
    body: JSON.stringify({
      displayName: "Alex",
      joinKey: "browser-key-alex",
    }),
  });
  assert.equal(joined.status, 201);
  const participant = (await joined.json()) as {
    participant: { participantId: string; memberId: string; groupId: string };
    participantToken: string;
  };
  assert.equal(participant.participant.groupId, "group-1");

  const draft = harness.ledger.createKarenDraft(
    "ctx-karen",
    "http-demo-audience-draft",
  );
  const approval = harness.ledger.approveDraft(
    draft.taskId,
    draft.version,
    "clinician:demo-host",
    "app_one_tap",
    "http-demo-audience-approval",
  );
  const offered = harness.ledger.publishDraft(
    draft.taskId,
    approval.proof,
    draft.version,
    "http-demo-audience-publish",
  );

  const assigned = await fetch(
    `${baseUrl}/api/demo/sessions/${session.sessionId}/assign`,
    {
      method: "POST",
      headers: appHeaders("clinician:demo-host"),
      body: JSON.stringify({
        groupId: "group-1",
        taskId: offered.taskId,
        expectedVersion: offered.version,
        idempotencyKey: "http-demo-assignment-001",
      }),
    },
  );
  assert.equal(assigned.status, 200);
  assert.equal(
    ((await assigned.json()) as { task: { assignedMemberId: string } }).task
      .assignedMemberId,
    participant.participant.memberId,
  );

  const participantView = await fetch(
    `${baseUrl}/api/demo/participants/lookup`,
    {
      method: "POST",
      headers: appHeaders(),
      body: JSON.stringify({ participantToken: participant.participantToken }),
    },
  );
  assert.equal(participantView.status, 200);
  const view = (await participantView.json()) as {
    assignments: Array<{ task: { taskId: string } }>;
  };
  assert.equal(view.assignments[0]?.task.taskId, offered.taskId);
});

test("demo smart routing advances an offered task and exposes its durable decision receipt", async (t) => {
  const harness = createAppHarness();
  const { server, baseUrl } = await listen(harness.app);
  t.after(async () => {
    await close(server);
    harness.store.close();
  });
  const draft = harness.ledger.createDraft({
    patientId: "synthetic-karen",
    interactionId: "interaction-karen-1",
    contextId: "ctx-karen",
    origin: "agent_suggested",
    summary: "Check blood pressure within 48 hours",
    taskType: "demo-smart-routing",
    evidenceRefs: ["encounter:sentence-42"],
    targetTeamId: "district-nursing",
    requiredCapabilities: ["blood-pressure"],
    clinicalUrgency: "medium",
    dueInMs: 48 * 60 * 60_000,
    idempotencyKey: "demo-smart-routing-draft",
    actor: { type: "agent", id: "corti" },
  });
  const approval = harness.ledger.approveDraft(
    draft.taskId,
    draft.version,
    "clinician-1",
    "app_one_tap",
    "demo-smart-routing-approval",
  );
  const offered = harness.ledger.publishDraft(
    draft.taskId,
    approval.proof,
    draft.version,
    "demo-smart-routing-publish",
  );

  const routedResponse = await fetch(
    `${baseUrl}/api/demo/tasks/${offered.taskId}/route-now`,
    {
      method: "POST",
      headers: appHeaders("clinician-1"),
      body: JSON.stringify({ idempotencyKey: "demo-smart-routing-now" }),
    },
  );
  assert.equal(routedResponse.status, 200);
  const routed = (await routedResponse.json()) as {
    advancedByMs: number;
    task: { taskId: string; state: string; assignedMemberId: string | null };
    receipt: {
      taskId: string;
      assignedMemberId: string;
      trigger: string;
      routingDecision: {
        selectedMemberId: string | null;
        requiredCapabilities: string[];
        candidates: Array<{
          memberId: string;
          eligible: boolean;
          rank: number | null;
          openTaskCount: number;
        }>;
      };
    };
  };
  assert.equal(routed.advancedByMs, 30 * 60_000);
  assert.deepEqual(routed.task, {
    ...harness.ledger.getTask(offered.taskId),
  });
  assert.equal(routed.task.state, "assigned_to_member");
  assert.equal(routed.task.assignedMemberId, "nurse-a");
  assert.equal(routed.receipt.taskId, offered.taskId);
  assert.equal(routed.receipt.assignedMemberId, "nurse-a");
  assert.equal(routed.receipt.trigger, "team_acceptance_timeout");
  assert.equal(routed.receipt.routingDecision.selectedMemberId, "nurse-a");
  assert.deepEqual(routed.receipt.routingDecision.requiredCapabilities, [
    "blood-pressure",
  ]);
  assert.deepEqual(
    routed.receipt.routingDecision.candidates.map((candidate) => ({
      memberId: candidate.memberId,
      eligible: candidate.eligible,
      rank: candidate.rank,
      openTaskCount: candidate.openTaskCount,
    })),
    [
      { memberId: "nurse-a", eligible: true, rank: 1, openTaskCount: 1 },
      { memberId: "nurse-b", eligible: true, rank: 2, openTaskCount: 2 },
    ],
  );

  const receiptResponse = await fetch(
    `${baseUrl}/api/tasks/${offered.taskId}/routing-receipt`,
    { headers: appHeaders() },
  );
  assert.equal(receiptResponse.status, 200);
  assert.deepEqual(await receiptResponse.json(), { receipt: routed.receipt });

  const replayResponse = await fetch(
    `${baseUrl}/api/demo/tasks/${offered.taskId}/route-now`,
    {
      method: "POST",
      headers: appHeaders("clinician-1"),
      body: JSON.stringify({ idempotencyKey: "demo-smart-routing-now" }),
    },
  );
  assert.equal(replayResponse.status, 200);
  assert.deepEqual(await replayResponse.json(), routed);
});
