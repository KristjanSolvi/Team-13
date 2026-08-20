import assert from "node:assert/strict";
import test from "node:test";

import {
  appHeaders,
  close,
  createAppHarness,
  listen,
  MCP_TOKEN,
  UI_ORIGIN,
} from "./support.js";

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
  assert.deepEqual(await health.json(), { ok: true });
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
