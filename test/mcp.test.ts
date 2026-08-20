import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import express from "express";

import { DomainError } from "../src/domain/errors.js";
import { seedKaren } from "../src/fixtures/karen.js";
import { DemoClock } from "../src/infra/clock.js";
import { openDatabase } from "../src/infra/database.js";
import { SqliteStore } from "../src/infra/store.js";
import { contextIdFromMeta, hasBearer } from "../src/mcp/auth.js";
import { createFollowThroughMcp } from "../src/mcp/tools.js";
import { mountMcp } from "../src/mcp/transport.js";
import { LedgerService } from "../src/services/ledger-service.js";
import { RecordService } from "../src/services/record-service.js";

const NOW = "2026-08-20T10:00:00.000Z";
const CONTEXT_ID = "ctx-karen";
const INTERACTION_ID = "interaction-karen-1";
const PATIENT_ID = "synthetic-karen";
const APPROVAL_SECRET = "approval-secret-with-at-least-32-bytes";
const BEARER_TOKEN = "mcp-bearer-token";

interface McpHarness {
  store: SqliteStore;
  ledger: LedgerService;
  server: McpServer;
  client: Client;
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

function requireText(value: unknown): string {
  assert.ok(isObject(value));
  const content = value.content;
  assert.ok(Array.isArray(content));
  const first: unknown = content[0];
  assert.ok(isObject(first));
  assert.equal(first.type, "text");
  if (typeof first.text !== "string") {
    throw new TypeError("Expected text content");
  }
  return first.text;
}

function requireString(value: Record<string, unknown>, key: string): string {
  const result = value[key];
  if (typeof result !== "string") {
    throw new TypeError(`Expected ${key} to be a string`);
  }
  return result;
}

function requireNumber(value: Record<string, unknown>, key: string): number {
  const result = value[key];
  if (typeof result !== "number") {
    throw new TypeError(`Expected ${key} to be a number`);
  }
  return result;
}

async function mcpHarness(
  t: TestContext,
  recordsFactory: (store: SqliteStore) => RecordService = (store) =>
    new RecordService(store),
): Promise<McpHarness> {
  const store = new SqliteStore(openDatabase(":memory:"));
  seedKaren(store, NOW);
  store.putContextMapping(CONTEXT_ID, INTERACTION_ID, PATIENT_ID, NOW);
  const ledger = new LedgerService(
    store,
    new DemoClock(new Date(NOW), true),
    APPROVAL_SECRET,
  );
  const server = createFollowThroughMcp(recordsFactory(store), ledger, store);
  const client = new Client({ name: "mcp-contract-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
    store.close();
  });
  return { store, ledger, server, client };
}

function karenDraftArguments(taskType: string, idempotencyKey: string) {
  return {
    patientId: PATIENT_ID,
    interactionId: INTERACTION_ID,
    summary: "Check blood pressure within 48 hours",
    taskType,
    evidenceRefs: ["encounter:sentence-42"],
    targetTeamId: "district-nursing",
    requiredCapabilities: ["blood-pressure"],
    clinicalUrgency: "medium",
    dueInMs: 48 * 60 * 60_000,
    idempotencyKey,
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

test("lists exactly the six safe follow-through tools", async (t) => {
  const { client } = await mcpHarness(t);
  const result = await client.listTools();

  assert.deepEqual(result.tools.map((tool) => tool.name).toSorted(), [
    "create_task_draft",
    "get_patient_context",
    "get_task",
    "list_eligible_teams",
    "list_open_threads",
    "publish_team_task",
  ]);
  const descriptions = Object.fromEntries(
    result.tools.map((tool) => [tool.name, tool.description ?? ""]),
  );
  assert.match(descriptions.get_patient_context ?? "", /synthetic.*scoped/i);
  assert.match(descriptions.list_open_threads ?? "", /duplicate/i);
  assert.match(descriptions.list_eligible_teams ?? "", /team.*person/i);
  assert.match(descriptions.create_task_draft ?? "", /non-actionable/i);
  assert.match(
    descriptions.publish_team_task ?? "",
    /exact clinician approval/i,
  );
  assert.match(descriptions.get_task ?? "", /authoritative.*readback/i);
});

test("retrieves scoped Karen facts and emits only safe context-derived audits", async (t) => {
  const { client, store } = await mcpHarness(t);

  const context = await callScoped(client, "get_patient_context", {
    patientId: PATIENT_ID,
  });
  assert.equal(context.isError, undefined);
  assert.match(requireText(context), /Karen Jensen/);

  const threads = await callScoped(client, "list_open_threads", {
    patientId: PATIENT_ID,
  });
  assert.deepEqual(requireStructured(threads).threads, []);

  const teams = await callScoped(client, "list_eligible_teams", {
    patientId: PATIENT_ID,
    requiredCapabilities: ["blood-pressure"],
  });
  const serializedTeams = JSON.stringify(requireStructured(teams));
  assert.match(serializedTeams, /availableWithCapacity/);
  assert.doesNotMatch(serializedTeams, /nurse-a|nurse-b/);

  const reads = store
    .listEvents(0)
    .filter((event) => event.eventType.startsWith("record."));
  assert.deepEqual(
    reads.map((event) => ({
      eventType: event.eventType,
      patientId: event.patientId,
      interactionId: event.interactionId,
      contextId: event.contextId,
      payload: event.payload,
    })),
    [
      {
        eventType: "record.context_retrieved",
        patientId: PATIENT_ID,
        interactionId: INTERACTION_ID,
        contextId: CONTEXT_ID,
        payload: { evidenceAvailable: true },
      },
      {
        eventType: "record.open_threads_checked",
        patientId: PATIENT_ID,
        interactionId: INTERACTION_ID,
        contextId: CONTEXT_ID,
        payload: { count: 0 },
      },
    ],
  );
  const serializedAudits = JSON.stringify(reads);
  assert.doesNotMatch(serializedAudits, /Amlodipine|Dizziness|Karen Jensen/);
});

test("returns structured denials for missing, wrong, and mismatched context", async (t) => {
  const { client, store } = await mcpHarness(t);

  const missing = await client.callTool({
    name: "get_patient_context",
    arguments: { patientId: PATIENT_ID },
  });
  assert.equal(missing.isError, true);
  assert.deepEqual(requireStructured(missing), {
    code: "CONTEXT_REQUIRED",
    message: "A Corti context is required",
    retryable: false,
  });

  const wrong = await callScoped(
    client,
    "get_patient_context",
    { patientId: PATIENT_ID },
    "ctx-wrong",
  );
  assert.equal(wrong.isError, true);
  assert.deepEqual(requireStructured(wrong), {
    code: "PATIENT_SCOPE_DENIED",
    message: "Patient scope is unavailable",
    retryable: false,
  });

  const mismatch = await callScoped(client, "create_task_draft", {
    ...karenDraftArguments("interaction-mismatch", "mcp-mismatch-draft"),
    interactionId: "interaction-other",
  });
  assert.equal(mismatch.isError, true);
  assert.deepEqual(requireStructured(mismatch), {
    code: "CONTEXT_INTERACTION_MISMATCH",
    message: "Interaction scope is unavailable",
    retryable: false,
  });
  assert.equal(store.listPatientTasks(PATIENT_ID).length, 0);
});

test("denies cross-patient task reads and publication", async (t) => {
  const { client, store, ledger } = await mcpHarness(t);
  store.putPatient("synthetic-other", "Other Patient", { synthetic: true });
  const other = ledger.createDraft({
    patientId: "synthetic-other",
    interactionId: "interaction-other",
    contextId: null,
    origin: "clinician_created",
    summary: "Arrange an unrelated synthetic follow-up",
    taskType: "other-patient-follow-up",
    evidenceRefs: ["dictation:other-1"],
    targetTeamId: "district-nursing",
    requiredCapabilities: ["blood-pressure"],
    clinicalUrgency: "routine",
    dueInMs: 8 * 60 * 60_000,
    idempotencyKey: "other-draft-key",
    actor: { type: "clinician", id: "clinician-1" },
  });

  const read = await callScoped(client, "get_task", {
    patientId: PATIENT_ID,
    taskId: other.taskId,
  });
  assert.equal(read.isError, true);
  assert.equal(requireStructured(read).code, "PATIENT_SCOPE_DENIED");

  const publish = await callScoped(client, "publish_team_task", {
    patientId: PATIENT_ID,
    taskId: other.taskId,
    approvalProof: "untrusted-proof",
    expectedVersion: other.version,
    idempotencyKey: "cross-publish-key",
  });
  assert.equal(publish.isError, true);
  assert.equal(requireStructured(publish).code, "PATIENT_SCOPE_DENIED");
  assert.equal(ledger.getTask(other.taskId).state, "draft");
});

test("creates a draft, publishes direct clinician approval, and audits authoritative readback", async (t) => {
  const { client, ledger, store } = await mcpHarness(t);
  const draftResult = await callScoped(
    client,
    "create_task_draft",
    karenDraftArguments("mcp-blood-pressure", "mcp-draft-key-1"),
  );
  assert.equal(draftResult.isError, undefined);
  const draft = requireStructured(draftResult);
  const taskId = requireString(draft, "taskId");
  const version = requireNumber(draft, "version");
  assert.equal(draft.state, "draft");
  assert.equal(draft.assignedMemberId, null);

  const approval = ledger.approveDraft(
    taskId,
    version,
    "clinician-1",
    "app_one_tap",
    "mcp-clinician-approval",
  );
  const publishedResult = await callScoped(client, "publish_team_task", {
    patientId: PATIENT_ID,
    taskId,
    approvalProof: approval.proof,
    expectedVersion: version,
    idempotencyKey: "mcp-publish-key-1",
  });
  const published = requireStructured(publishedResult);
  assert.equal(published.state, "offered_to_team");
  assert.equal(published.version, 2);
  assert.equal(published.assignedMemberId, null);

  const firstRead = await callScoped(client, "get_task", {
    patientId: PATIENT_ID,
    taskId,
  });
  assert.deepEqual(requireStructured(firstRead), published);
  const secondRead = await callScoped(client, "get_task", {
    patientId: PATIENT_ID,
    taskId,
  });
  assert.deepEqual(requireStructured(secondRead), published);
  assert.equal(
    store
      .listEvents(0)
      .filter((event) => event.eventType === "task.publish_verified").length,
    2,
  );
});

test("never exposes unexpected implementation errors", async (t) => {
  class ExplodingRecordService extends RecordService {
    override getPatientContext(): never {
      throw new Error("SELECT secret FROM patient_record; stack=private");
    }
  }
  const { client } = await mcpHarness(
    t,
    (store) => new ExplodingRecordService(store),
  );

  const result = await callScoped(client, "get_patient_context", {
    patientId: PATIENT_ID,
  });
  assert.equal(result.isError, true);
  assert.deepEqual(requireStructured(result), {
    code: "INTERNAL_ERROR",
    message: "Tool failed",
    retryable: true,
  });
  assert.doesNotMatch(requireText(result), /SELECT|stack|patient_record/);
});

test("context extraction rejects absent and blank metadata", () => {
  for (const extra of [
    undefined,
    {},
    { _meta: {} },
    { _meta: { _contextId: "  " } },
  ]) {
    assert.throws(
      () => contextIdFromMeta(extra),
      (error: unknown) =>
        error instanceof DomainError &&
        error.code === "CONTEXT_REQUIRED" &&
        error.status === 403,
    );
  }
  assert.equal(
    contextIdFromMeta({ _meta: { _contextId: CONTEXT_ID } }),
    CONTEXT_ID,
  );
});

async function listen(t: TestContext, app: express.Express): Promise<string> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected a TCP server address");
  }
  return `http://127.0.0.1:${address.port}`;
}

test("bearer comparison is case-insensitive and rejects empty, wrong, and length-mismatched credentials", async (t) => {
  const app = express();
  app.get("/auth", (request, response) => {
    response.json({ authorized: hasBearer(request, BEARER_TOKEN) });
  });
  const baseUrl = await listen(t, app);

  const request = async (authorization?: string) => {
    const headers = new Headers();
    if (authorization !== undefined)
      headers.set("authorization", authorization);
    const response = await fetch(`${baseUrl}/auth`, { headers });
    return response.json();
  };

  assert.deepEqual(await request(`bEaReR ${BEARER_TOKEN}`), {
    authorized: true,
  });
  assert.deepEqual(await request(), { authorized: false });
  assert.deepEqual(await request("Bearer wrong-token-value"), {
    authorized: false,
  });
  assert.deepEqual(await request(`Bearer ${BEARER_TOKEN}-longer`), {
    authorized: false,
  });
  assert.deepEqual(await request("Bearer "), { authorized: false });
});

interface HttpHarness {
  baseUrl: string;
  store: SqliteStore;
}

async function httpHarness(t: TestContext): Promise<HttpHarness> {
  const store = new SqliteStore(openDatabase(":memory:"));
  seedKaren(store, NOW);
  store.putContextMapping(CONTEXT_ID, INTERACTION_ID, PATIENT_ID, NOW);
  const records = new RecordService(store);
  const ledger = new LedgerService(
    store,
    new DemoClock(new Date(NOW), true),
    APPROVAL_SECRET,
  );
  t.after(() => store.close());
  const app = express();
  app.use(express.json());
  const router = express.Router();
  mountMcp(
    router,
    () => createFollowThroughMcp(records, ledger, store),
    BEARER_TOKEN,
  );
  app.use(router);
  return { baseUrl: await listen(t, app), store };
}

function rpcHeaders(sessionId?: string, authenticated = true): Headers {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  });
  if (authenticated) headers.set("authorization", `Bearer ${BEARER_TOKEN}`);
  if (sessionId !== undefined) headers.set("mcp-session-id", sessionId);
  return headers;
}

test("stateful HTTP initializes, denies unauthenticated calls, rejects invalid sessions, and cleans up DELETE", async (t) => {
  const { baseUrl, store } = await httpHarness(t);
  const unauthorizedInitialize = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: rpcHeaders(undefined, false),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "http-test", version: "1.0.0" },
      },
    }),
  });
  assert.equal(unauthorizedInitialize.status, 401);
  assert.match(await unauthorizedInitialize.text(), /Unauthorized/);

  const initialize = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: rpcHeaders(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "http-test", version: "1.0.0" },
      },
    }),
  });
  assert.equal(initialize.status, 200);
  const sessionId = initialize.headers.get("mcp-session-id");
  assert.ok(sessionId);
  assert.match(sessionId, /^[0-9a-f-]{36}$/i);

  const invalidSession = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: rpcHeaders("invalid-session"),
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
  });
  assert.equal(invalidSession.status, 400);
  assert.match(await invalidSession.text(), /Invalid MCP session/);

  const unauthorizedCall = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: rpcHeaders(sessionId, false),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "create_task_draft",
        arguments: karenDraftArguments("unauthorized", "unauthorized-draft"),
        _meta: { _contextId: CONTEXT_ID },
      },
    }),
  });
  assert.equal(unauthorizedCall.status, 401);
  assert.match(await unauthorizedCall.text(), /Unauthorized/);
  assert.equal(store.listPatientTasks(PATIENT_ID).length, 0);

  const initialized = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: rpcHeaders(sessionId),
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  });
  assert.equal(initialized.status, 202);

  const listed = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: rpcHeaders(sessionId),
    body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list" }),
  });
  assert.equal(listed.status, 200);
  assert.match(await listed.text(), /get_patient_context/);

  const deleted = await fetch(`${baseUrl}/mcp`, {
    method: "DELETE",
    headers: rpcHeaders(sessionId),
  });
  assert.equal(deleted.status, 200);

  const afterDelete = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: rpcHeaders(sessionId),
    body: JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/list" }),
  });
  assert.equal(afterDelete.status, 400);
  assert.match(await afterDelete.text(), /Invalid MCP session/);
});
