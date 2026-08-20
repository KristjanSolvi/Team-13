import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { seedKaren } from "../src/fixtures/karen.js";
import { DemoClock } from "../src/infra/clock.js";
import { openDatabase } from "../src/infra/database.js";
import { SqliteStore } from "../src/infra/store.js";
import { createMeetingReconciliationMcp } from "../src/mcp/meeting-tools.js";
import { LedgerService } from "../src/services/ledger-service.js";
import { MeetingService } from "../src/services/meeting-service.js";
import { RecordService } from "../src/services/record-service.js";

const actor = { type: "clinician" as const, id: "clinician:evelyn" };
const patientId = "synthetic-karen";
const contextId = "ctx-meeting-reconciliation";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function structured(value: unknown): Record<string, unknown> {
  assert.ok(isObject(value));
  assert.ok(isObject(value.structuredContent));
  return value.structuredContent;
}

async function harness(t: TestContext) {
  const store = new SqliteStore(openDatabase(":memory:"));
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
  store.putContextMapping(
    contextId,
    request.reconciliation.interactionId,
    patientId,
    "2026-08-20T10:03:00.000Z",
  );
  const server = createMeetingReconciliationMcp(
    new RecordService(store),
    meetings,
  );
  const client = new Client({ name: "meeting-mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
    store.close();
  });
  return { client, store, meetings, request };
}

function call(
  client: Client,
  name: string,
  argumentsValue: Record<string, unknown>,
  scopedContextId = contextId,
) {
  return client.callTool({
    name,
    arguments: argumentsValue,
    _meta: { _contextId: scopedContextId },
  });
}

test("meeting MCP exposes exactly six reads and one constrained save", async (t) => {
  const { client } = await harness(t);
  const names = (await client.listTools()).tools
    .map(({ name }) => name)
    .toSorted();

  assert.deepEqual(names, [
    "get_latest_patient_handover",
    "get_meeting_segment",
    "get_previous_patient_meeting",
    "get_task",
    "list_eligible_teams",
    "list_patient_tasks",
    "save_meeting_reconciliation",
  ]);
  assert.equal(names.includes("publish_team_task"), false);
});

test("meeting reads are patient scoped and return exact current evidence", async (t) => {
  const { client, request, store } = await harness(t);
  const before = store.listEvents(0).length;
  const current = structured(
    await call(client, "get_meeting_segment", {
      reconciliationId: request.reconciliation.reconciliationId,
      patientId,
    }),
  );
  const evidence = current.evidence;
  assert.ok(Array.isArray(evidence));
  assert.equal(
    (evidence[0] as { text: string }).text,
    "Please ask pharmacy to review the discharge medicines.",
  );
  const previous = structured(
    await call(client, "get_previous_patient_meeting", {
      reconciliationId: request.reconciliation.reconciliationId,
      patientId,
    }),
  );
  assert.equal(previous.previous, null);
  const handover = structured(
    await call(client, "get_latest_patient_handover", {
      reconciliationId: request.reconciliation.reconciliationId,
      patientId,
    }),
  );
  assert.equal(handover.handover, null);
  assert.equal(store.listEvents(0).length, before);

  store.putPatient("other-patient", "Other", {});
  store.putContextMapping(
    "ctx-other",
    "meeting-reconciliation:other",
    "other-patient",
    "2026-08-20T10:03:00.000Z",
  );
  const denied = await call(
    client,
    "get_meeting_segment",
    {
      reconciliationId: request.reconciliation.reconciliationId,
      patientId,
    },
    "ctx-other",
  );
  assert.equal(denied.isError, true);
  assert.equal(structured(denied).code, "PATIENT_SCOPE_DENIED");
});

test("empty grounded reconciliation saves once without creating tasks", async (t) => {
  const { client, request, store } = await harness(t);
  const argumentsValue = {
    reconciliationId: request.reconciliation.reconciliationId,
    patientId,
    expectedVersion: request.reconciliation.version,
    sourceSnapshotHash: request.reconciliation.sourceSnapshotHash,
    proposals: [],
    carryForwards: [],
    idempotencyKey: "reconcile-save-karen-0001",
  };
  const first = structured(
    await call(client, "save_meeting_reconciliation", argumentsValue),
  );
  const replay = structured(
    await call(client, "save_meeting_reconciliation", argumentsValue),
  );

  assert.equal((first.reconciliation as { status: string }).status, "saved");
  assert.equal(replay.replayed, true);
  assert.equal(store.listPatientTasks(patientId).length, 0);
});
