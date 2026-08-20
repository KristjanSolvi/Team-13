import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { DomainError } from "../src/domain/errors.js";
import { seedKaren } from "../src/fixtures/karen.js";
import { DemoClock } from "../src/infra/clock.js";
import { openDatabase } from "../src/infra/database.js";
import { SqliteStore } from "../src/infra/store.js";
import { LedgerService } from "../src/services/ledger-service.js";
import { MeetingService } from "../src/services/meeting-service.js";

const actor = { type: "clinician" as const, id: "clinician:evelyn" };

function setup(t: TestContext) {
  const store = new SqliteStore(openDatabase(":memory:"));
  t.after(() => store.close());
  seedKaren(store, "2026-08-20T10:00:00.000Z");
  const clock = new DemoClock(new Date("2026-08-20T10:00:00.000Z"), true);
  const ledger = new LedgerService(
    store,
    clock,
    "approval-secret-with-at-least-32-bytes",
  );
  return {
    store,
    clock,
    ledger,
    service: new MeetingService(store, clock, ledger),
  };
}

function start(service: MeetingService) {
  return service.startMeeting({
    wardId: "ward-13",
    interactionId: "interaction-meeting-1",
    idempotencyKey: "meeting-start-0001",
    actor,
    correlationId: "corr-meeting-1",
  });
}

test("starts a meeting and replays its attributable command", (t) => {
  const { service, store } = setup(t);
  const first = start(service);
  const replay = start(service);

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.meeting, first.meeting);
  const events = store
    .listEvents(0)
    .filter((event) => event.eventType === "meeting.started");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0]?.actor, actor);
  assert.deepEqual(events[0]?.payload, {
    meetingId: first.meeting.meetingId,
    wardId: "ward-13",
    status: "recording",
    version: 1,
  });
});

test("opens exactly one explicit patient segment and advances the meeting", (t) => {
  const { service, store } = setup(t);
  const started = start(service);
  const opened = service.openPatientSegment({
    meetingId: started.meeting.meetingId,
    patientId: "synthetic-karen",
    expectedMeetingVersion: started.meeting.version,
    idempotencyKey: "segment-karen-open-0001",
    actor,
    correlationId: "corr-meeting-1",
  });

  assert.equal(opened.segment.patientId, "synthetic-karen");
  assert.equal(opened.segment.status, "recording");
  assert.equal(opened.meeting.version, 2);
  assert.throws(
    () =>
      service.openPatientSegment({
        meetingId: started.meeting.meetingId,
        patientId: "synthetic-karen",
        expectedMeetingVersion: opened.meeting.version,
        idempotencyKey: "segment-karen-open-0002",
        actor,
        correlationId: "corr-meeting-1",
      }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "PATIENT_SEGMENT_ALREADY_OPEN" &&
      error.status === 409,
  );
  assert.equal(
    store
      .listEvents(0)
      .filter((event) => event.eventType === "meeting.patient_segment_opened")
      .length,
    1,
  );
});

test("retains unscoped final speech but registers only clear patient evidence", (t) => {
  const { service, store } = setup(t);
  const started = start(service);
  const unscoped = service.appendTranscript({
    meetingId: started.meeting.meetingId,
    patientSegmentId: null,
    idempotencyKey: "transcript-unscoped-0001",
    actor,
    correlationId: "corr-meeting-1",
    segments: [
      {
        segmentKey: "interaction-meeting-1:0",
        text: "Good morning everyone.",
        startSeconds: 0,
        endSeconds: 1.5,
        isFinal: true,
        audioQuality: "clear",
      },
      {
        segmentKey: "interaction-meeting-1:1.5",
        text: "interim words",
        startSeconds: 1.5,
        endSeconds: 2,
        isFinal: false,
        audioQuality: "clear",
      },
    ],
  });
  assert.equal(unscoped.evidence.length, 1);
  assert.equal(unscoped.evidence[0]?.eligible, false);
  assert.equal(unscoped.ignoredInterimCount, 1);

  const opened = service.openPatientSegment({
    meetingId: started.meeting.meetingId,
    patientId: "synthetic-karen",
    expectedMeetingVersion: started.meeting.version,
    idempotencyKey: "segment-karen-open-0001",
    actor,
    correlationId: "corr-meeting-1",
  });
  const scoped = service.appendTranscript({
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
        speakerId: 1,
        isFinal: true,
        audioQuality: "clear",
      },
      {
        segmentKey: "interaction-meeting-1:7",
        text: "The line was unclear.",
        startSeconds: 7,
        endSeconds: 8,
        isFinal: true,
        audioQuality: "uncertain",
      },
    ],
  });
  assert.deepEqual(
    scoped.evidence.map(({ eligible }) => eligible),
    [true, false],
  );
  assert.equal(store.listRecordItems("synthetic-karen").length, 2);

  service.closePatientSegment({
    meetingId: started.meeting.meetingId,
    segmentId: opened.segment.segmentId,
    expectedMeetingVersion: opened.meeting.version,
    expectedSegmentVersion: opened.segment.version,
    idempotencyKey: "segment-karen-close-0001",
    actor,
    correlationId: "corr-meeting-1",
  });

  const meetingItems = store
    .listRecordItems("synthetic-karen")
    .filter((item) => item.itemType === "meeting-evidence");
  assert.equal(meetingItems.length, 1);
  assert.equal(
    meetingItems[0]?.text,
    "Please ask pharmacy to review the discharge medicines.",
  );
});

test("meeting completion requires no open segment and is idempotent", (t) => {
  const { service } = setup(t);
  const started = start(service);
  const opened = service.openPatientSegment({
    meetingId: started.meeting.meetingId,
    patientId: "synthetic-karen",
    expectedMeetingVersion: started.meeting.version,
    idempotencyKey: "segment-karen-open-0001",
    actor,
    correlationId: "corr-meeting-1",
  });
  assert.throws(
    () =>
      service.completeMeeting({
        meetingId: started.meeting.meetingId,
        expectedMeetingVersion: opened.meeting.version,
        idempotencyKey: "meeting-complete-0001",
        actor,
        correlationId: "corr-meeting-1",
      }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "MEETING_IN_PROGRESS",
  );
  const closed = service.closePatientSegment({
    meetingId: started.meeting.meetingId,
    segmentId: opened.segment.segmentId,
    expectedMeetingVersion: opened.meeting.version,
    expectedSegmentVersion: opened.segment.version,
    idempotencyKey: "segment-karen-close-0001",
    actor,
    correlationId: "corr-meeting-1",
  });
  const completed = service.completeMeeting({
    meetingId: started.meeting.meetingId,
    expectedMeetingVersion: closed.meeting.version,
    idempotencyKey: "meeting-complete-0001",
    actor,
    correlationId: "corr-meeting-1",
  });
  const replay = service.completeMeeting({
    meetingId: started.meeting.meetingId,
    expectedMeetingVersion: closed.meeting.version,
    idempotencyKey: "meeting-complete-0001",
    actor,
    correlationId: "corr-meeting-1",
  });

  assert.equal(completed.meeting.status, "completed");
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.meeting, completed.meeting);
});

function closedKarenSegment(service: MeetingService) {
  const started = start(service);
  const opened = service.openPatientSegment({
    meetingId: started.meeting.meetingId,
    patientId: "synthetic-karen",
    expectedMeetingVersion: started.meeting.version,
    idempotencyKey: "segment-karen-open-0001",
    actor,
    correlationId: "corr-meeting-1",
  });
  const transcript = service.appendTranscript({
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
        speakerId: 1,
        isFinal: true,
        audioQuality: "clear",
      },
    ],
  });
  const closed = service.closePatientSegment({
    meetingId: started.meeting.meetingId,
    segmentId: opened.segment.segmentId,
    expectedMeetingVersion: opened.meeting.version,
    expectedSegmentVersion: opened.segment.version,
    idempotencyKey: "segment-karen-close-0001",
    actor,
    correlationId: "corr-meeting-1",
  });
  return {
    ...closed,
    evidence: transcript.evidence[0] as NonNullable<
      (typeof transcript.evidence)[0]
    >,
  };
}

test("reconciliation snapshots current evidence, previous meeting, and active tasks", (t) => {
  const { service, ledger, clock } = setup(t);
  const prior = closedKarenSegment(service);
  service.completeMeeting({
    meetingId: prior.meeting.meetingId,
    expectedMeetingVersion: prior.meeting.version,
    idempotencyKey: "meeting-complete-prior-0001",
    actor,
    correlationId: "corr-meeting-1",
  });
  clock.advance(24 * 60 * 60_000);
  const current = service.startMeeting({
    wardId: "ward-13",
    interactionId: "interaction-meeting-2",
    idempotencyKey: "meeting-start-0002",
    actor,
    correlationId: "corr-meeting-2",
  });
  const opened = service.openPatientSegment({
    meetingId: current.meeting.meetingId,
    patientId: "synthetic-karen",
    expectedMeetingVersion: current.meeting.version,
    idempotencyKey: "segment-karen-open-0002",
    actor,
    correlationId: "corr-meeting-2",
  });
  const transcript = service.appendTranscript({
    meetingId: current.meeting.meetingId,
    patientSegmentId: opened.segment.segmentId,
    idempotencyKey: "transcript-karen-0002",
    actor,
    correlationId: "corr-meeting-2",
    segments: [
      {
        segmentKey: "interaction-meeting-2:4",
        text: "The pharmacy review is still outstanding today.",
        startSeconds: 4,
        endSeconds: 7,
        isFinal: true,
        audioQuality: "clear",
      },
    ],
  });
  const closed = service.closePatientSegment({
    meetingId: current.meeting.meetingId,
    segmentId: opened.segment.segmentId,
    expectedMeetingVersion: opened.meeting.version,
    expectedSegmentVersion: opened.segment.version,
    idempotencyKey: "segment-karen-close-0002",
    actor,
    correlationId: "corr-meeting-2",
  });
  const existing = ledger.createKarenDraft("ctx-karen", "existing-task-0001");

  const request = service.beginReconciliation({
    meetingId: current.meeting.meetingId,
    segmentId: closed.segment.segmentId,
    expectedSegmentVersion: closed.segment.version,
    idempotencyKey: "reconcile-karen-0001",
    actor,
    correlationId: "corr-meeting-2",
  });

  assert.equal(request.replayed, false);
  assert.deepEqual(request.sourceSnapshot.currentEvidence, [
    {
      sourceRef: transcript.evidence[0]?.sourceRef,
      contentHash: request.sourceSnapshot.currentEvidence[0]?.contentHash,
    },
  ]);
  assert.deepEqual(request.sourceSnapshot.previousEvidence, [
    {
      sourceRef: prior.evidence.sourceRef,
      contentHash: request.sourceSnapshot.previousEvidence[0]?.contentHash,
    },
  ]);
  assert.deepEqual(request.sourceSnapshot.tasks, [
    { taskId: existing.taskId, version: existing.version },
  ]);
  assert.equal(request.reconciliation.status, "requested");
  assert.equal(request.segment.status, "reconciling");
});

test("save atomically creates a grounded draft and a non-mutating carry-forward", (t) => {
  const { service, ledger, store } = setup(t);
  store.putTeam({
    teamId: "ward-pharmacy",
    name: "Ward Pharmacy",
    capabilities: ["medicines-review"],
  });
  const closed = closedKarenSegment(service);
  const existing = ledger.createKarenDraft("ctx-karen", "existing-task-0001");
  const request = service.beginReconciliation({
    meetingId: closed.meeting.meetingId,
    segmentId: closed.segment.segmentId,
    expectedSegmentVersion: closed.segment.version,
    idempotencyKey: "reconcile-karen-0001",
    actor,
    correlationId: "corr-meeting-1",
  });
  store.putContextMapping(
    "ctx-meeting",
    request.reconciliation.interactionId,
    "synthetic-karen",
    "2026-08-20T10:03:00.000Z",
  );

  const saved = service.saveReconciliation({
    reconciliationId: request.reconciliation.reconciliationId,
    patientId: "synthetic-karen",
    contextId: "ctx-meeting",
    expectedVersion: request.reconciliation.version,
    sourceSnapshotHash: request.reconciliation.sourceSnapshotHash,
    proposals: [
      {
        summary: "Ask pharmacy to review the discharge medicines",
        sourceQuote: "Please ask pharmacy to review the discharge medicines.",
        taskType: "medicines-review",
        evidenceRefs: [closed.evidence.sourceRef as string],
        targetTeamId: "ward-pharmacy",
        requiredCapabilities: ["medicines-review"],
        clinicalUrgency: "routine",
        dueInMs: 24 * 60 * 60_000,
      },
    ],
    carryForwards: [
      {
        taskRef: `task:${existing.taskId}@${existing.version}`,
        reason: "unresolved",
        sourceRefs: existing.evidenceRefs,
      },
    ],
    idempotencyKey: "reconcile-save-karen-0001",
    actor: { type: "agent", id: "meeting-agent" },
    correlationId: "corr-meeting-1",
  });

  assert.equal(saved.reconciliation.status, "saved");
  assert.equal(saved.newDraftTasks.length, 1);
  assert.equal(saved.newDraftTasks[0]?.state, "draft");
  assert.equal(saved.newDraftTasks[0]?.targetTeamId, "ward-pharmacy");
  assert.equal(saved.carryForwards.length, 1);
  assert.equal(store.requireTask(existing.taskId).version, existing.version);
  assert.equal(
    store.requirePatientMeetingSegment(closed.segment.segmentId).status,
    "reconciled",
  );
});

test("source changes reject reconciliation without partial drafts", (t) => {
  const { service, ledger, store } = setup(t);
  store.putTeam({
    teamId: "ward-pharmacy",
    name: "Ward Pharmacy",
    capabilities: ["medicines-review"],
  });
  const closed = closedKarenSegment(service);
  const existing = ledger.createKarenDraft("ctx-karen", "existing-task-0001");
  const request = service.beginReconciliation({
    meetingId: closed.meeting.meetingId,
    segmentId: closed.segment.segmentId,
    expectedSegmentVersion: closed.segment.version,
    idempotencyKey: "reconcile-karen-0001",
    actor,
    correlationId: "corr-meeting-1",
  });
  store.putContextMapping(
    "ctx-meeting",
    request.reconciliation.interactionId,
    "synthetic-karen",
    "2026-08-20T10:03:00.000Z",
  );
  ledger.correctDraft(
    existing.taskId,
    existing.version,
    { summary: "Changed after reconciliation began" },
    actor,
  );

  assert.throws(
    () =>
      service.saveReconciliation({
        reconciliationId: request.reconciliation.reconciliationId,
        patientId: "synthetic-karen",
        contextId: "ctx-meeting",
        expectedVersion: request.reconciliation.version,
        sourceSnapshotHash: request.reconciliation.sourceSnapshotHash,
        proposals: [
          {
            summary: "Ask pharmacy to review the discharge medicines",
            sourceQuote:
              "Please ask pharmacy to review the discharge medicines.",
            taskType: "medicines-review",
            evidenceRefs: [closed.evidence.sourceRef as string],
            targetTeamId: "ward-pharmacy",
            requiredCapabilities: ["medicines-review"],
            clinicalUrgency: "routine",
            dueInMs: 24 * 60 * 60_000,
          },
        ],
        carryForwards: [],
        idempotencyKey: "reconcile-save-karen-0001",
        actor: { type: "agent", id: "meeting-agent" },
        correlationId: "corr-meeting-1",
      }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "MEETING_SOURCE_CHANGED",
  );
  assert.equal(
    store
      .listPatientTasks("synthetic-karen")
      .filter((task) => task.taskType === "medicines-review").length,
    0,
  );
});
