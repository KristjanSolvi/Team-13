import assert from "node:assert/strict";
import test from "node:test";

import type { MeetingService } from "../src/services/meeting-service.js";
import { verifyMeetingAgentReconciliation } from "../src/services/meeting-verification.js";
import {
  APP_TOKEN,
  appHeaders,
  close,
  createAppHarness,
  listen,
} from "./support.js";

async function requestJson(
  baseUrl: string,
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  return { status: response.status, body: (await response.json()) as unknown };
}

function object(value: unknown): Record<string, unknown> {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}

test("meeting lifecycle is authenticated and automatically reconciles on request", async (t) => {
  let meetings: MeetingService;
  const harness = createAppHarness({
    meetingRunner: {
      async generate(input) {
        const requested = harness.store.requireMeetingReconciliation(
          input.reconciliationId,
        );
        const contextId = "ctx-http-meeting";
        harness.store.putContextMapping(
          contextId,
          requested.interactionId,
          input.patientId,
          "2026-08-20T10:03:00.000Z",
        );
        meetings.saveReconciliation({
          reconciliationId: input.reconciliationId,
          patientId: input.patientId,
          contextId,
          expectedVersion: requested.version,
          sourceSnapshotHash: requested.sourceSnapshotHash,
          proposals: [],
          carryForwards: [],
          idempotencyKey: `${input.idempotencyKey}:save`,
          actor: { type: "agent", id: "meeting-agent" },
          correlationId: "corr-http-meeting",
        });
        return verifyMeetingAgentReconciliation(harness.store, {
          reconciliationId: input.reconciliationId,
          contextId,
          idempotencyKey: input.idempotencyKey,
        });
      },
    },
  });
  meetings = harness.meetings;
  const live = await listen(harness.app);
  t.after(() => close(live.server));

  const unauthenticated = await requestJson(
    live.baseUrl,
    "/api/ward-meetings",
    { method: "POST", body: {} },
  );
  assert.equal(unauthenticated.status, 401);

  const started = await requestJson(live.baseUrl, "/api/ward-meetings", {
    method: "POST",
    headers: appHeaders("clinician:evelyn"),
    body: {
      wardId: "ward-13",
      interactionId: "interaction-meeting-http-1",
      idempotencyKey: "meeting-http-start-0001",
    },
  });
  assert.equal(started.status, 201);
  const meeting = object(object(started.body).meeting);
  const meetingId = meeting.meetingId as string;

  const opened = await requestJson(
    live.baseUrl,
    `/api/ward-meetings/${meetingId}/segments`,
    {
      method: "POST",
      headers: appHeaders("clinician:evelyn"),
      body: {
        patientId: "synthetic-karen",
        expectedMeetingVersion: meeting.version,
        idempotencyKey: "meeting-http-open-0001",
      },
    },
  );
  assert.equal(opened.status, 201);
  const activeMeeting = object(object(opened.body).meeting);
  const segment = object(object(opened.body).segment);
  const segmentId = segment.segmentId as string;

  const transcript = await requestJson(
    live.baseUrl,
    `/api/ward-meetings/${meetingId}/transcript-segments`,
    {
      method: "POST",
      headers: appHeaders("clinician:evelyn"),
      body: {
        patientSegmentId: segmentId,
        idempotencyKey: "meeting-http-transcript-0001",
        segments: [
          {
            segmentKey: "interaction-meeting-http-1:3",
            text: "Please ask pharmacy to review the discharge medicines.",
            startSeconds: 3,
            endSeconds: 6,
            isFinal: true,
            audioQuality: "clear",
          },
        ],
      },
    },
  );
  assert.equal(transcript.status, 201);
  const transcriptEvidence = object(transcript.body).evidence;
  assert.ok(Array.isArray(transcriptEvidence));
  assert.equal(object(transcriptEvidence[0]).eligible, true);

  const closed = await requestJson(
    live.baseUrl,
    `/api/ward-meetings/${meetingId}/segments/${segmentId}/close`,
    {
      method: "POST",
      headers: appHeaders("clinician:evelyn"),
      body: {
        expectedMeetingVersion: activeMeeting.version,
        expectedSegmentVersion: segment.version,
        idempotencyKey: "meeting-http-close-0001",
      },
    },
  );
  assert.equal(closed.status, 200);
  const closedBody = object(closed.body);
  const closedSegment = object(closedBody.segment);
  assert.equal(closedSegment.status, "closed");

  const reconciled = await requestJson(
    live.baseUrl,
    `/api/ward-meetings/${meetingId}/segments/${segmentId}/reconcile`,
    {
      method: "POST",
      headers: appHeaders("clinician:evelyn"),
      body: {
        expectedSegmentVersion: closedSegment.version,
        idempotencyKey: "meeting-http-reconcile-0001",
      },
    },
  );
  assert.equal(reconciled.status, 201);
  const reconciledBody = object(reconciled.body);
  assert.equal(object(reconciledBody.reconciliation).status, "saved");
  assert.deepEqual(reconciledBody.newDraftTasks, []);
  assert.deepEqual(reconciledBody.carryForwards, []);

  const completed = await requestJson(
    live.baseUrl,
    `/api/ward-meetings/${meetingId}/complete`,
    {
      method: "POST",
      headers: appHeaders("clinician:evelyn"),
      body: {
        expectedMeetingVersion: object(closedBody.meeting).version,
        idempotencyKey: "meeting-http-complete-0001",
      },
    },
  );
  assert.equal(completed.status, 200);
  assert.equal(object(object(completed.body).meeting).status, "completed");

  const read = await requestJson(
    live.baseUrl,
    `/api/ward-meetings/${meetingId}`,
    { headers: { authorization: `Bearer ${APP_TOKEN}` } },
  );
  assert.equal(read.status, 200);
  assert.equal(object(object(read.body).meeting).status, "completed");
  const readSegments = object(read.body).segments;
  assert.ok(Array.isArray(readSegments));
  assert.equal(object(object(readSegments[0]).reconciliation).status, "saved");
});

test("reconciliation requires a configured meeting agent before changing state", async (t) => {
  const harness = createAppHarness();
  const live = await listen(harness.app);
  t.after(() => close(live.server));
  const started = harness.meetings.startMeeting({
    wardId: "ward-13",
    interactionId: "interaction-no-runner",
    idempotencyKey: "meeting-no-runner-start",
    actor: { type: "clinician", id: "clinician:evelyn" },
    correlationId: "corr-no-runner",
  });
  const opened = harness.meetings.openPatientSegment({
    meetingId: started.meeting.meetingId,
    patientId: "synthetic-karen",
    expectedMeetingVersion: started.meeting.version,
    idempotencyKey: "meeting-no-runner-open",
    actor: { type: "clinician", id: "clinician:evelyn" },
    correlationId: "corr-no-runner",
  });
  const closed = harness.meetings.closePatientSegment({
    meetingId: started.meeting.meetingId,
    segmentId: opened.segment.segmentId,
    expectedMeetingVersion: opened.meeting.version,
    expectedSegmentVersion: opened.segment.version,
    idempotencyKey: "meeting-no-runner-close",
    actor: { type: "clinician", id: "clinician:evelyn" },
    correlationId: "corr-no-runner",
  });

  const response = await requestJson(
    live.baseUrl,
    `/api/ward-meetings/${started.meeting.meetingId}/segments/${opened.segment.segmentId}/reconcile`,
    {
      method: "POST",
      headers: appHeaders("clinician:evelyn"),
      body: {
        expectedSegmentVersion: closed.segment.version,
        idempotencyKey: "meeting-no-runner-reconcile",
      },
    },
  );
  assert.equal(response.status, 503);
  assert.equal(
    object(object(response.body).error).code,
    "CORTI_MEETING_AGENT_NOT_CONFIGURED",
  );
  assert.equal(
    harness.store.getMeetingReconciliationForSegment(opened.segment.segmentId),
    null,
  );
});
