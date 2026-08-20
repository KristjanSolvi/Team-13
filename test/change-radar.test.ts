import assert from "node:assert/strict";
import test from "node:test";

import { evidenceContentHash } from "../src/domain/change-radar.js";
import { createAppHarness } from "./support.js";

test("a source revision flags dependent work without mutating the task", () => {
  const harness = createAppHarness();
  const task = harness.ledger.createKarenDraft(
    "ctx-karen",
    "change-radar-draft",
  );

  const [dependency] = harness.store.listEvidenceDependencies(
    "synthetic-karen",
    "encounter:sentence-42",
  );
  assert.ok(dependency);
  assert.equal(dependency.artifactKind, "task");
  assert.equal(dependency.artifactId, task.taskId);
  assert.equal(dependency.artifactVersion, task.version);

  const result = harness.records.recordSourceRevision({
    patientId: "synthetic-karen",
    sourceItemId: "karen-dizziness-signal",
    expectedSourceRef: "encounter:sentence-42",
    newText: "Dizziness now also occurs at rest after the medication change",
    reason: "clinical_note_revision",
    changedBy: "clinician-1",
    changedAt: "2026-08-20T10:05:00.000Z",
    correlationId: "change-radar-test",
    idempotencyKey: "source-revision-001",
  });

  assert.equal(result.replayed, false);
  assert.equal(result.reviewRequiredCount, 1);
  assert.equal(result.impacts[0]?.artifactId, task.taskId);
  assert.equal(result.impacts[0]?.status, "review_required");
  assert.match(result.impacts[0]?.summary ?? "", /tracked work is unchanged/);
  assert.deepEqual(harness.ledger.getTask(task.taskId), task);

  const events = harness.store
    .listEvents(0)
    .filter(
      ({ eventType }) =>
        eventType === "record.source_revised" ||
        eventType === "change_radar.impact_detected",
    );
  assert.deepEqual(
    events.map(({ eventType }) => eventType),
    ["record.source_revised", "change_radar.impact_detected"],
  );
  assert.doesNotMatch(JSON.stringify(events), /Dizziness now also occurs/);
  const eventCountBeforeReplay = harness.store.listEvents(0).length;

  const replay = harness.records.recordSourceRevision({
    patientId: "synthetic-karen",
    sourceItemId: "karen-dizziness-signal",
    expectedSourceRef: "encounter:sentence-42",
    newText: "Dizziness now also occurs at rest after the medication change",
    reason: "clinical_note_revision",
    changedBy: "clinician-1",
    changedAt: "2026-08-20T10:06:00.000Z",
    correlationId: "change-radar-replay",
    idempotencyKey: "source-revision-001",
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.revision.revisionId, result.revision.revisionId);
  assert.equal(harness.store.listEvents(0).length, eventCountBeforeReplay);

  harness.store.close();
});

test("generated handover snapshots become Change Radar dependencies", () => {
  const harness = createAppHarness();
  const handoverId = "11111111-1111-4111-8111-111111111111";
  harness.store.putHandover({
    handoverId,
    patientId: "synthetic-karen",
    interactionId: `handover:${handoverId}`,
    contextId: "ctx-handover-radar",
    requestedBy: "clinician-1",
    reason: "on_demand",
    focus: null,
    correlationId: "handover-radar",
    idempotencyKey: "handover-radar-001",
    requestHash: evidenceContentHash("handover-radar-request"),
    status: "draft",
    version: 2,
    packet: null,
    rendered: null,
    sourceSnapshot: {
      recordItems: [
        {
          itemId: "karen-medication-change",
          sourceRef: "record:medication-1",
          contentHash: evidenceContentHash("Amlodipine changed"),
        },
      ],
      threads: [],
      tasks: [],
    },
    sourceSnapshotHash: evidenceContentHash("handover-radar-snapshot"),
    createdAt: "2026-08-20T10:00:00.000Z",
    updatedAt: "2026-08-20T10:01:00.000Z",
    generatedAt: null,
  });

  const result = harness.records.recordSourceRevision({
    patientId: "synthetic-karen",
    sourceItemId: "karen-medication-change",
    expectedSourceRef: "record:medication-1",
    newText: "Amlodipine dose reduced after medication review",
    reason: "medication_update",
    changedBy: "clinician-1",
    changedAt: "2026-08-20T10:05:00.000Z",
    correlationId: "handover-change-radar-test",
    idempotencyKey: "handover-source-revision-001",
  });

  assert.equal(result.reviewRequiredCount, 1);
  assert.equal(result.impacts[0]?.artifactKind, "handover");
  assert.equal(result.impacts[0]?.artifactId, handoverId);
  assert.equal(harness.store.requireHandover(handoverId).status, "draft");
  harness.store.close();
});
