import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { DomainError } from "../src/domain/errors.js";
import type { LedgerService } from "../src/services/ledger-service.js";
import { createAppHarness } from "./support.js";

function scenario(t: TestContext) {
  const harness = createAppHarness();
  t.after(() => harness.store.close());
  return harness;
}

function publishKaren(ledger: LedgerService, suffix: string) {
  const draft = ledger.createKarenDraft("ctx-karen", `${suffix}-draft`);
  const approval = ledger.approveDraft(
    draft.taskId,
    draft.version,
    "clinician-1",
    "app_one_tap",
    `${suffix}-approval`,
  );
  return ledger.publishDraft(
    draft.taskId,
    approval.proof,
    draft.version,
    `${suffix}-publish`,
  );
}

test("1 happy path reaches independent downstream verification", (t) => {
  const { store, ledger } = scenario(t);
  const offered = publishKaren(ledger, "happy");
  const accepted = ledger.acceptTask(
    offered.taskId,
    offered.version,
    "nurse-a",
    "happy-accept",
  );
  const completed = ledger.completeTask(
    accepted.taskId,
    accepted.version,
    "nurse-a",
    "record:mock-bp-result-1",
  );
  const verified = ledger.verifyTask(
    completed.taskId,
    completed.version,
    "record:mock-bp-result-1",
    "downstream:mock-bp-system",
  );

  assert.equal(verified.state, "verified");
  assert.equal(store.requireThread(verified.threadId).state, "verified");
  assert.ok(
    store
      .listEvents(0)
      .some(
        (event) =>
          event.eventType === "task.completion_verified" &&
          event.actor.id === "downstream:mock-bp-system",
      ),
  );
});

test("2 clinician-created task uses the same ledger lifecycle", (t) => {
  const { ledger } = scenario(t);
  const draft = ledger.createDraft({
    patientId: "synthetic-karen",
    interactionId: "interaction-karen-1",
    contextId: "ctx-karen",
    origin: "clinician_created",
    summary: "Check blood pressure within 48 hours",
    taskType: "blood-pressure-check",
    evidenceRefs: ["dictation:manual-1"],
    targetTeamId: "district-nursing",
    requiredCapabilities: ["blood-pressure"],
    clinicalUrgency: "medium",
    dueInMs: 48 * 60 * 60_000,
    idempotencyKey: "manual-draft",
    actor: { type: "clinician", id: "clinician-1" },
  });
  const approval = ledger.approveDraft(
    draft.taskId,
    draft.version,
    "clinician-1",
    "dictation_confirmation",
    "manual-approval",
  );
  const offered = ledger.publishDraft(
    draft.taskId,
    approval.proof,
    draft.version,
    "manual-publish",
  );

  assert.equal(offered.origin, "clinician_created");
  assert.equal(offered.state, "offered_to_team");
});

test("3 team non-acceptance deterministically assigns nurse-a", (t) => {
  const { clock, ledger, scheduler } = scenario(t);
  const offered = publishKaren(ledger, "timeout");

  clock.advance(30 * 60_000);
  scheduler.tick();

  const assigned = ledger.getTask(offered.taskId);
  assert.equal(assigned.state, "assigned_to_member");
  assert.equal(assigned.assignedMemberId, "nurse-a");
});

test("4 two-member acceptance race leaves exactly one owner", (t) => {
  const { store, ledger } = scenario(t);
  const offered = publishKaren(ledger, "race");
  ledger.acceptTask(
    offered.taskId,
    offered.version,
    "nurse-a",
    "race-accept-a",
  );

  assert.throws(
    () =>
      ledger.acceptTask(
        offered.taskId,
        offered.version,
        "nurse-b",
        "race-accept-b",
      ),
    (error: unknown) =>
      error instanceof DomainError && error.code === "VERSION_CONFLICT",
  );
  assert.equal(ledger.getTask(offered.taskId).assignedMemberId, "nurse-a");
  assert.equal(
    store
      .listEvents(0)
      .filter((event) => event.eventType === "task.member_accepted").length,
    1,
  );
});

test("5 lost publication response is recovered idempotently", (t) => {
  const { store, ledger } = scenario(t);
  const draft = ledger.createKarenDraft("ctx-karen", "lost-draft");
  const approval = ledger.approveDraft(
    draft.taskId,
    draft.version,
    "clinician-1",
    "app_one_tap",
    "lost-approval",
  );
  ledger.publishDraft(
    draft.taskId,
    approval.proof,
    draft.version,
    "lost-publish",
  );
  const recovered = ledger.publishDraft(
    draft.taskId,
    approval.proof,
    draft.version,
    "lost-publish",
  );

  assert.equal(recovered.state, "offered_to_team");
  assert.equal(store.listPatientTasks("synthetic-karen").length, 1);
  assert.equal(
    store
      .listEvents(0)
      .filter((event) => event.eventType === "task.published_to_team").length,
    1,
  );
});
