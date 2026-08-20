import assert from "node:assert/strict";
import test from "node:test";

import {
  meetingReconciliationSchema,
  meetingTranscriptEvidenceSchema,
  patientMeetingSegmentSchema,
  wardMeetingSchema,
} from "../src/domain/meeting.js";

const meetingId = "11111111-1111-4111-8111-111111111111";
const segmentId = "22222222-2222-4222-8222-222222222222";
const reconciliationId = "33333333-3333-4333-8333-333333333333";

test("meeting domain parses a recording with an explicit patient segment", () => {
  const meeting = wardMeetingSchema.parse({
    meetingId,
    wardId: "ward-13",
    interactionId: "interaction-meeting-1",
    status: "recording",
    startedBy: "clinician:evelyn",
    startedAt: "2026-08-20T10:00:00.000Z",
    completedAt: null,
    version: 1,
  });
  const segment = patientMeetingSegmentSchema.parse({
    segmentId,
    meetingId,
    patientId: "synthetic-karen",
    status: "recording",
    openedBy: "clinician:evelyn",
    openedAt: "2026-08-20T10:01:00.000Z",
    closedAt: null,
    version: 1,
  });

  assert.equal(meeting.status, "recording");
  assert.equal(segment.patientId, "synthetic-karen");
});

test("only final clear patient-scoped transcript may be eligible evidence", () => {
  const base = {
    evidenceId: "44444444-4444-4444-8444-444444444444",
    meetingId,
    patientSegmentId: segmentId,
    interactionId: "interaction-meeting-1",
    segmentKey: "interaction-meeting-1:3.2",
    text: "Please ask pharmacy to review the discharge medicines.",
    startSeconds: 3.2,
    endSeconds: 6.4,
    speakerId: 1,
    isFinal: true,
    audioQuality: "clear",
    eligible: true,
    sourceRef: `encounter:meeting-${meetingId}.${segmentId}.segment-1`,
    recordedAt: "2026-08-20T10:01:10.000Z",
  } as const;

  assert.equal(meetingTranscriptEvidenceSchema.parse(base).eligible, true);
  for (const invalid of [
    { ...base, isFinal: false },
    { ...base, audioQuality: "uncertain" },
    { ...base, patientSegmentId: null },
  ]) {
    assert.equal(
      meetingTranscriptEvidenceSchema.safeParse(invalid).success,
      false,
    );
  }
});

test("unscoped final transcript is retained but cannot be eligible", () => {
  const evidence = meetingTranscriptEvidenceSchema.parse({
    evidenceId: "55555555-5555-4555-8555-555555555555",
    meetingId,
    patientSegmentId: null,
    interactionId: "interaction-meeting-1",
    segmentKey: "interaction-meeting-1:0",
    text: "Good morning everyone.",
    startSeconds: 0,
    endSeconds: 1.5,
    isFinal: true,
    audioQuality: "clear",
    eligible: false,
    sourceRef: null,
    recordedAt: "2026-08-20T10:00:05.000Z",
  });

  assert.equal(evidence.patientSegmentId, null);
  assert.equal(evidence.sourceRef, null);
});

test("reconciliation rejects a task as both new and carry-forward", () => {
  const taskId = "66666666-6666-4666-8666-666666666666";
  const result = meetingReconciliationSchema.safeParse({
    reconciliationId,
    meetingId,
    patientSegmentId: segmentId,
    patientId: "synthetic-karen",
    interactionId:
      "meeting-reconciliation:33333333-3333-4333-8333-333333333333",
    contextId: null,
    idempotencyKey: "reconcile-karen-0001",
    sourceSnapshotHash: `sha256:${"a".repeat(64)}`,
    status: "saved",
    newDraftTaskIds: [taskId],
    carryForwardTaskRefs: [`task:${taskId}@1`],
    createdAt: "2026-08-20T10:03:00.000Z",
    updatedAt: "2026-08-20T10:03:00.000Z",
    version: 2,
  });

  assert.equal(result.success, false);
});
