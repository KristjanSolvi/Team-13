import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import {
  buildAgentDefinitions,
  buildProvisioningSummary,
} from "../src/agent/definitions.js";
import { MEETING_RECONCILIATION_PROMPT } from "../src/agent/meeting-prompt.js";
import { MeetingAgentRunner } from "../src/agent/meeting-runner.js";
import type {
  AgentGateway,
  AgentResult,
  AgentSendInput,
} from "../src/agent/runner.js";
import { createAgentRunners } from "../src/agent/runtime.js";
import { parseConfig } from "../src/config.js";
import { DomainError } from "../src/domain/errors.js";
import { seedKaren } from "../src/fixtures/karen.js";
import { DemoClock } from "../src/infra/clock.js";
import { openDatabase } from "../src/infra/database.js";
import { SqliteStore } from "../src/infra/store.js";
import { LedgerService } from "../src/services/ledger-service.js";
import { MeetingService } from "../src/services/meeting-service.js";
import { meetingAgentVerificationScope } from "../src/services/meeting-verification.js";

const patientId = "synthetic-karen";
const mcpToken = "meeting-mcp-token";
const actor = { type: "clinician" as const, id: "clinician:evelyn" };

function config(overrides: NodeJS.ProcessEnv = {}) {
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

function completed(contextId: string, taskId: string): AgentResult {
  return { contextId, taskId, state: "completed" };
}

function harness(t: TestContext) {
  const store = new SqliteStore(openDatabase(":memory:"));
  t.after(() => store.close());
  seedKaren(store, "2026-08-20T10:00:00.000Z");
  const clock = new DemoClock(new Date("2026-08-20T10:00:00.000Z"), true);
  const ledger = new LedgerService(
    store,
    clock,
    "approval-secret-with-at-least-32-bytes",
  );
  const meetings = new MeetingService(store, clock, ledger);
  const started = meetings.startMeeting({
    wardId: "ward-13",
    interactionId: "interaction-meeting-1",
    idempotencyKey: "meeting-start-0001",
    actor,
    correlationId: "corr-meeting-1",
  });
  const opened = meetings.openPatientSegment({
    meetingId: started.meeting.meetingId,
    patientId,
    expectedMeetingVersion: started.meeting.version,
    idempotencyKey: "segment-karen-open-0001",
    actor,
    correlationId: "corr-meeting-1",
  });
  meetings.appendTranscript({
    meetingId: started.meeting.meetingId,
    patientSegmentId: opened.segment.segmentId,
    idempotencyKey: "transcript-karen-0001",
    actor,
    correlationId: "corr-meeting-1",
    segments: [
      {
        segmentKey: "interaction-meeting-1:3",
        text: "Please ask pharmacy to review the discharge medicines.",
        startSeconds: 3,
        endSeconds: 6,
        isFinal: true,
        audioQuality: "clear",
      },
    ],
  });
  const closed = meetings.closePatientSegment({
    meetingId: started.meeting.meetingId,
    segmentId: opened.segment.segmentId,
    expectedMeetingVersion: opened.meeting.version,
    expectedSegmentVersion: opened.segment.version,
    idempotencyKey: "segment-karen-close-0001",
    actor,
    correlationId: "corr-meeting-1",
  });
  const request = meetings.beginReconciliation({
    meetingId: started.meeting.meetingId,
    segmentId: closed.segment.segmentId,
    expectedSegmentVersion: closed.segment.version,
    idempotencyKey: "reconcile-karen-0001",
    actor,
    correlationId: "corr-meeting-1",
  });
  return { store, meetings, request };
}

test("meeting agent prompt locks exact tools, evidence, and review-only behavior", () => {
  assert.match(MEETING_RECONCILIATION_PROMPT, /exactly seven tools/i);
  assert.match(MEETING_RECONCILIATION_PROMPT, /explicitly selected patient/i);
  assert.match(MEETING_RECONCILIATION_PROMPT, /exact contiguous quote/i);
  assert.match(MEETING_RECONCILIATION_PROMPT, /carry-forward/i);
  assert.match(MEETING_RECONCILIATION_PROMPT, /taskRevisions/);
  assert.match(MEETING_RECONCILIATION_PROMPT, /never.*duplicate/i);
  assert.match(MEETING_RECONCILIATION_PROMPT, /cannot publish/i);
  assert.match(
    MEETING_RECONCILIATION_PROMPT,
    /save_meeting_reconciliation exactly once/i,
  );
});

test("meeting runner reserves a fresh context before one scoped call", async (t) => {
  const { store, meetings, request } = harness(t);
  store.putContextMapping(
    "ctx-stale",
    request.reconciliation.interactionId,
    patientId,
    "2026-08-20T10:03:00.000Z",
  );
  const calls: AgentSendInput[] = [];
  const gateway: AgentGateway = {
    async send(input) {
      calls.push(input);
      assert.ok(input.contextId);
      assert.equal(
        store.contextForInteraction(request.reconciliation.interactionId),
        input.contextId,
      );
      meetings.saveReconciliation({
        reconciliationId: request.reconciliation.reconciliationId,
        patientId,
        contextId: input.contextId,
        expectedVersion: request.reconciliation.version,
        sourceSnapshotHash: request.reconciliation.sourceSnapshotHash,
        proposals: [],
        carryForwards: [],
        idempotencyKey: "reconcile-karen-0001:save",
        actor: { type: "agent", id: "meeting-agent" },
        correlationId: "corr-meeting-1",
      });
      return {
        contextId: input.contextId,
        taskId: "reconcile",
        state: "submitted",
      };
    },
    async waitForCompletion(result) {
      return { ...result, state: "completed" };
    },
  };

  const result = await new MeetingAgentRunner(
    gateway,
    store,
    mcpToken,
  ).generate({
    reconciliationId: request.reconciliation.reconciliationId,
    patientId,
    idempotencyKey: "reconcile-karen-0001",
  });

  assert.equal(result.status, "saved");
  assert.ok(result.contextId);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.data, {
    reconciliationId: request.reconciliation.reconciliationId,
    patientId,
    expectedVersion: request.reconciliation.version,
    sourceSnapshotHash: request.reconciliation.sourceSnapshotHash,
    saveIdempotencyKey: "reconcile-karen-0001:save",
    mcpToken,
  });
  assert.equal(store.patientForContext("ctx-stale"), null);
  assert.deepEqual(
    store.getProcessedCommand(
      meetingAgentVerificationScope(request.reconciliation.reconciliationId),
      "reconcile-karen-0001",
    ),
    {
      reconciliationId: request.reconciliation.reconciliationId,
      contextId: result.contextId,
      version: result.version,
    },
  );
});

test("meeting runner rejects terminal failure even when a save is absent", async (t) => {
  const { store, request } = harness(t);
  const gateway: AgentGateway = {
    async send(input) {
      assert.ok(input.contextId);
      return {
        contextId: input.contextId,
        taskId: "reconcile",
        state: "failed",
      };
    },
    async waitForCompletion(result) {
      return result;
    },
  };

  await assert.rejects(
    new MeetingAgentRunner(gateway, store, mcpToken).generate({
      reconciliationId: request.reconciliation.reconciliationId,
      patientId,
      idempotencyKey: "reconcile-karen-0001",
    }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "AGENT_TASK_INCOMPLETE",
  );
});

test("config, provisioning, and runtime expose a distinct meeting agent", (t) => {
  const parsed = config({
    CORTI_MEETING_AGENT_ID: "meeting-agent",
    MEETING_MCP_PUBLIC_URL: "https://meeting.example/mcp",
    MEETING_MCP_NAME: "meeting-tools",
  });
  assert.equal(parsed.cortiMeetingAgentId, "meeting-agent");
  assert.equal(parsed.meetingMcpPublicUrl, "https://meeting.example/mcp");
  assert.equal(parsed.meetingMcpName, "meeting-tools");
  const definitions = buildAgentDefinitions(parsed);
  assert.equal(definitions.meeting.systemPrompt, MEETING_RECONCILIATION_PROMPT);
  assert.deepEqual(definitions.meeting.mcpServers, [
    {
      name: "meeting-tools",
      description:
        "Seven patient-scoped tools for grounded ward-meeting reconciliation and new or revised task drafts.",
      transportType: "streamable_http",
      authorizationType: "bearer",
      url: "https://meeting.example/mcp",
    },
  ]);
  assert.deepEqual(
    buildProvisioningSummary(
      parsed,
      "task-agent",
      "handover-agent",
      "meeting-agent",
    ),
    {
      taskAgentId: "task-agent",
      handoverAgentId: "handover-agent",
      meetingAgentId: "meeting-agent",
      taskMcpUrl: "https://example.test/mcp",
      handoverMcpUrl: "https://example.test/mcp/handover",
      meetingMcpUrl: "https://meeting.example/mcp",
    },
  );

  const store = new SqliteStore(openDatabase(":memory:"));
  t.after(() => store.close());
  const gateway: AgentGateway = {
    async send() {
      return completed("ctx", "task");
    },
    async waitForCompletion(result) {
      return result;
    },
  };
  const calls: Array<{ agentId: string; mcpName: string }> = [];
  const runners = createAgentRunners(parsed, store, (agentId, mcpName) => {
    calls.push({ agentId, mcpName });
    return gateway;
  });
  assert.ok(runners.meeting instanceof MeetingAgentRunner);
  assert.deepEqual(calls, [
    { agentId: "meeting-agent", mcpName: "meeting-tools" },
  ]);
});
