import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import type {
  MeetingTranscriptEvidence,
  PatientMeetingSegment,
  WardMeeting,
} from "../src/domain/meeting.js";
import { seedKaren } from "../src/fixtures/karen.js";
import { openDatabase } from "../src/infra/database.js";
import { SqliteStore } from "../src/infra/store.js";

const now = "2026-08-20T10:00:00.000Z";
const meetingId = "11111111-1111-4111-8111-111111111111";
const segmentId = "22222222-2222-4222-8222-222222222222";

function setup(t: TestContext) {
  const store = new SqliteStore(openDatabase(":memory:"));
  t.after(() => store.close());
  seedKaren(store, now);
  return store;
}

function meeting(overrides: Partial<WardMeeting> = {}): WardMeeting {
  return {
    meetingId,
    wardId: "ward-13",
    interactionId: "interaction-meeting-1",
    status: "recording",
    startedBy: "clinician:evelyn",
    startedAt: now,
    completedAt: null,
    version: 1,
    ...overrides,
  };
}

function patientSegment(
  overrides: Partial<PatientMeetingSegment> = {},
): PatientMeetingSegment {
  return {
    segmentId,
    meetingId,
    patientId: "synthetic-karen",
    status: "recording",
    openedBy: "clinician:evelyn",
    openedAt: "2026-08-20T10:01:00.000Z",
    closedAt: null,
    version: 1,
    ...overrides,
  };
}

function transcript(
  overrides: Partial<MeetingTranscriptEvidence> = {},
): MeetingTranscriptEvidence {
  return {
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
    ...overrides,
  };
}

test("meeting, selected patient, and transcript round-trip", (t) => {
  const store = setup(t);
  store.putMeeting(meeting());
  store.putPatientMeetingSegment(patientSegment());
  store.putMeetingTranscript(transcript());

  assert.deepEqual(store.requireMeeting(meetingId), meeting());
  assert.deepEqual(
    store.requirePatientMeetingSegment(segmentId),
    patientSegment(),
  );
  assert.deepEqual(store.listPatientMeetingEvidence(segmentId), [transcript()]);
});

test("a meeting permits only one actively recording patient", (t) => {
  const store = setup(t);
  store.putPatient("patient-two", "Patient Two", {});
  store.putMeeting(meeting());
  store.putPatientMeetingSegment(patientSegment());

  assert.throws(() =>
    store.putPatientMeetingSegment(
      patientSegment({
        segmentId: "77777777-7777-4777-8777-777777777777",
        patientId: "patient-two",
      }),
    ),
  );
});

test("segment CAS closes once and preserves immutable patient identity", (t) => {
  const store = setup(t);
  store.putPatient("patient-two", "Patient Two", {});
  store.putMeeting(meeting());
  const current = patientSegment();
  store.putPatientMeetingSegment(current);
  const closed = {
    ...current,
    status: "closed" as const,
    closedAt: "2026-08-20T10:03:00.000Z",
    version: 2,
  };

  assert.deepEqual(store.updatePatientMeetingSegment(closed, 1), closed);
  assert.throws(() =>
    store.updatePatientMeetingSegment({ ...closed, version: 3 }, 1),
  );
  assert.throws(() =>
    store.updatePatientMeetingSegment(
      { ...closed, patientId: "patient-two", version: 3 },
      2,
    ),
  );
});

test("transcript cannot be appended after its patient segment closes", (t) => {
  const store = setup(t);
  store.putMeeting(meeting());
  const current = patientSegment();
  store.putPatientMeetingSegment(current);
  store.updatePatientMeetingSegment(
    {
      ...current,
      status: "closed",
      closedAt: "2026-08-20T10:03:00.000Z",
      version: 2,
    },
    1,
  );

  assert.throws(() => store.putMeetingTranscript(transcript()));
});

test("previous patient segment excludes the current meeting and is newest first", (t) => {
  const store = setup(t);
  const priorMeetingId = "88888888-8888-4888-8888-888888888888";
  const priorSegmentId = "99999999-9999-4999-8999-999999999999";
  store.putMeeting(
    meeting({
      meetingId: priorMeetingId,
      interactionId: "interaction-prior",
      startedAt: "2026-08-19T10:00:00.000Z",
    }),
  );
  const priorRecording = patientSegment({
    segmentId: priorSegmentId,
    meetingId: priorMeetingId,
    openedAt: "2026-08-19T10:01:00.000Z",
  });
  store.putPatientMeetingSegment(priorRecording);
  const priorClosed = store.updatePatientMeetingSegment(
    {
      ...priorRecording,
      status: "closed",
      closedAt: "2026-08-19T10:03:00.000Z",
      version: 2,
    },
    1,
  );
  const prior = store.updatePatientMeetingSegment(
    { ...priorClosed, status: "reconciled", version: 3 },
    2,
  );
  store.putMeeting(meeting());
  store.putPatientMeetingSegment(patientSegment());

  assert.deepEqual(
    store.getPreviousPatientMeeting("synthetic-karen", meetingId),
    prior,
  );
});
