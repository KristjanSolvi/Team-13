import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { DomainError } from "../src/domain/errors.js";
import type { Member, Team } from "../src/domain/types.js";
import { seedKaren } from "../src/fixtures/karen.js";
import { DemoClock } from "../src/infra/clock.js";
import { openDatabase } from "../src/infra/database.js";
import { SqliteStore } from "../src/infra/store.js";
import {
  type CreateDraftInput,
  LedgerService,
} from "../src/services/ledger-service.js";

const NOW = "2026-08-20T10:00:00.000Z";
const SECRET = "approval-secret-with-at-least-32-bytes";

function harness(t: TestContext) {
  const store = new SqliteStore(openDatabase(":memory:"));
  t.after(() => store.close());
  seedKaren(store, NOW);
  const clock = new DemoClock(new Date(NOW), true);
  return { store, clock, ledger: new LedgerService(store, clock, SECRET) };
}

function draftInput(
  overrides: Partial<CreateDraftInput> = {},
): CreateDraftInput {
  return {
    patientId: "synthetic-karen",
    interactionId: "interaction-karen-1",
    contextId: "ctx-karen",
    origin: "agent_suggested",
    summary: "Check blood pressure within 48 hours",
    taskType: "blood-pressure-check",
    evidenceRefs: ["encounter:sentence-42"],
    targetTeamId: "district-nursing",
    requiredCapabilities: ["blood-pressure"],
    clinicalUrgency: "medium",
    dueInMs: 48 * 60 * 60_000,
    idempotencyKey: "draft-1",
    actor: { type: "agent", id: "corti" },
    ...overrides,
  };
}

function assertDomainError(
  operation: () => unknown,
  code: string,
  status: number,
): DomainError {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof DomainError);
  assert.equal(caught.code, code);
  assert.equal(caught.status, status);
  return caught;
}

function publishKaren(
  ledger: LedgerService,
  suffix: string,
  approvalChannel: "app_one_tap" | "dictation_confirmation" = "app_one_tap",
) {
  const draft = ledger.createKarenDraft("ctx-karen", `draft-${suffix}`);
  const approval = ledger.approveDraft(
    draft.taskId,
    draft.version,
    "clinician-1",
    approvalChannel,
    `approval-${suffix}`,
  );
  return ledger.publishDraft(
    draft.taskId,
    approval.proof,
    draft.version,
    `publish-${suffix}`,
  );
}

test("Karen helper creates the canonical medium district-nursing draft", (t) => {
  const { ledger } = harness(t);
  const task = ledger.createKarenDraft("ctx-karen", "karen-helper");

  assert.equal(task.patientId, "synthetic-karen");
  assert.equal(task.summary, "Check blood pressure within 48 hours");
  assert.equal(task.taskType, "blood-pressure-check");
  assert.deepEqual(task.evidenceRefs, ["encounter:sentence-42"]);
  assert.equal(task.targetTeamId, "district-nursing");
  assert.deepEqual(task.requiredCapabilities, ["blood-pressure"]);
  assert.equal(task.clinicalUrgency, "medium");
  assert.equal(task.acceptBy, "2026-08-20T10:30:00.000Z");
  assert.equal(task.dueBy, "2026-08-22T10:00:00.000Z");
  assert.equal(task.state, "draft");
  assert.equal(task.version, 1);
});

test("draft, approval, publication, and acceptance replay without duplicate events", (t) => {
  const { store, ledger } = harness(t);
  const input = draftInput({ idempotencyKey: "replay-draft" });
  const firstDraft = ledger.createDraft(input);
  const secondDraft = ledger.createDraft(input);
  assert.equal(secondDraft.taskId, firstDraft.taskId);

  const firstApproval = ledger.approveDraft(
    firstDraft.taskId,
    firstDraft.version,
    "clinician-1",
    "app_one_tap",
    "replay-approval",
  );
  const secondApproval = ledger.approveDraft(
    firstDraft.taskId,
    firstDraft.version,
    "clinician-1",
    "app_one_tap",
    "replay-approval",
  );
  assert.deepEqual(secondApproval, firstApproval);

  const firstPublish = ledger.publishDraft(
    firstDraft.taskId,
    firstApproval.proof,
    firstDraft.version,
    "replay-publish",
  );
  const secondPublish = ledger.publishDraft(
    firstDraft.taskId,
    firstApproval.proof,
    firstDraft.version,
    "replay-publish",
  );
  assert.deepEqual(secondPublish, firstPublish);

  const firstAccept = ledger.acceptTask(
    firstPublish.taskId,
    firstPublish.version,
    "nurse-a",
    "replay-accept",
  );
  const secondAccept = ledger.acceptTask(
    firstPublish.taskId,
    firstPublish.version,
    "nurse-a",
    "replay-accept",
  );
  assert.deepEqual(secondAccept, firstAccept);

  const eventTypes = store.listEvents(0).map((event) => event.eventType);
  assert.equal(eventTypes.filter((type) => type === "task.draft_created").length, 1);
  assert.equal(eventTypes.filter((type) => type === "task.approved").length, 1);
  assert.equal(
    eventTypes.filter((type) => type === "task.published_to_team").length,
    1,
  );
  assert.equal(
    eventTypes.filter((type) => type === "task.member_accepted").length,
    1,
  );
});

test("correction changes the version and hash so an earlier approval is stale", (t) => {
  const { ledger } = harness(t);
  const draft = ledger.createKarenDraft("ctx-karen", "stale-draft");
  const approval = ledger.approveDraft(
    draft.taskId,
    draft.version,
    "clinician-1",
  );
  const corrected = ledger.correctDraft(
    draft.taskId,
    draft.version,
    { summary: "Check seated and standing blood pressure" },
    { type: "clinician", id: "clinician-1" },
  );

  assert.equal(corrected.version, 2);
  assertDomainError(
    () =>
      ledger.publishDraft(
        corrected.taskId,
        approval.proof,
        corrected.version,
        "stale-publish",
      ),
    "APPROVAL_MISMATCH",
    409,
  );
});

test("expired, tampered, and wrong-task approval proofs cannot publish", (t) => {
  const { store, clock, ledger } = harness(t);
  const expiredDraft = ledger.createKarenDraft("ctx-karen", "expired-draft");
  const expiredApproval = ledger.approveDraft(
    expiredDraft.taskId,
    expiredDraft.version,
    "clinician-1",
  );
  clock.advance(10 * 60_000);
  assertDomainError(
    () =>
      ledger.publishDraft(
        expiredDraft.taskId,
        expiredApproval.proof,
        expiredDraft.version,
        "expired-publish",
      ),
    "APPROVAL_MISMATCH",
    409,
  );

  const tamperDraft = ledger.createDraft(
    draftInput({
      taskType: "tamper-check",
      idempotencyKey: "tamper-draft",
    }),
  );
  const tamperApproval = ledger.approveDraft(
    tamperDraft.taskId,
    tamperDraft.version,
    "clinician-1",
  );
  const tamperedProof = `${tamperApproval.proof.slice(0, -1)}x`;
  assertDomainError(
    () =>
      ledger.publishDraft(
        tamperDraft.taskId,
        tamperedProof,
        tamperDraft.version,
        "tamper-publish",
      ),
    "APPROVAL_MISMATCH",
    409,
  );

  store.putPatient("synthetic-other", "Other Patient", { synthetic: true });
  const otherDraft = ledger.createDraft(
    draftInput({
      patientId: "synthetic-other",
      interactionId: "interaction-other",
      contextId: "ctx-other",
      origin: "clinician_created",
      taskType: "other-check",
      evidenceRefs: ["dictation:other-1"],
      idempotencyKey: "other-draft",
      actor: { type: "clinician", id: "clinician-1" },
    }),
  );
  assertDomainError(
    () =>
      ledger.publishDraft(
        otherDraft.taskId,
        tamperApproval.proof,
        otherDraft.version,
        "wrong-task-publish",
      ),
    "APPROVAL_MISMATCH",
    409,
  );
});

test("dictation confirmation approval can publish a manual clinician draft", (t) => {
  const { ledger } = harness(t);
  const draft = ledger.createDraft(
    draftInput({
      origin: "clinician_created",
      evidenceRefs: ["dictation:manual-bp-1"],
      idempotencyKey: "manual-draft",
      actor: { type: "clinician", id: "clinician-1" },
    }),
  );
  const approval = ledger.approveDraft(
    draft.taskId,
    draft.version,
    "clinician-1",
    "dictation_confirmation",
    "manual-approval",
  );
  const published = ledger.publishDraft(
    draft.taskId,
    approval.proof,
    draft.version,
    "manual-publish",
  );

  assert.equal(published.origin, "clinician_created");
  assert.equal(published.state, "offered_to_team");
});

test("draft validation rejects missing patients, bad evidence, missing evidence, teams, duplicates, and deadlines", (t) => {
  const { ledger } = harness(t);
  assertDomainError(
    () =>
      ledger.createDraft(
        draftInput({
          patientId: "missing",
          idempotencyKey: "missing-patient",
        }),
      ),
    "PATIENT_NOT_FOUND",
    404,
  );
  assertDomainError(
    () =>
      ledger.createDraft(
        draftInput({
          evidenceRefs: ["http://example.test/evidence"],
          idempotencyKey: "bad-evidence",
        }),
      ),
    "INVALID_EVIDENCE",
    400,
  );
  assertDomainError(
    () =>
      ledger.createDraft(
        draftInput({
          evidenceRefs: ["encounter:missing"],
          idempotencyKey: "missing-evidence",
        }),
      ),
    "EVIDENCE_NOT_FOUND",
    409,
  );
  assertDomainError(
    () =>
      ledger.createDraft(
        draftInput({
          requiredCapabilities: ["home-visit"],
          idempotencyKey: "bad-team",
        }),
      ),
    "TEAM_NOT_ELIGIBLE",
    400,
  );

  ledger.createKarenDraft("ctx-karen", "original-draft");
  assertDomainError(
    () =>
      ledger.createDraft(draftInput({ idempotencyKey: "duplicate-draft" })),
    "LIKELY_DUPLICATE",
    409,
  );

  for (const [index, dueInMs] of [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    29 * 60_000,
  ].entries()) {
    assertDomainError(
      () =>
        ledger.createDraft(
          draftInput({
            taskType: `deadline-${index}`,
            dueInMs,
            idempotencyKey: `deadline-${index}`,
          }),
        ),
      "INVALID_DEADLINE",
      400,
    );
  }
});

test("existing thread scope and escalation are enforced", (t) => {
  const { store, ledger } = harness(t);
  const first = ledger.createKarenDraft("ctx-karen", "thread-original");

  assertDomainError(
    () =>
      ledger.createDraft(
        draftInput({
          threadId: first.threadId,
          interactionId: "interaction-other",
          taskType: "different-check",
          idempotencyKey: "scope-mismatch",
        }),
      ),
    "THREAD_SCOPE_MISMATCH",
    403,
  );

  const thread = store.requireThread(first.threadId);
  store.setThreadState(
    thread.threadId,
    thread.version,
    "escalated",
    "2026-08-20T10:01:00.000Z",
  );
  assertDomainError(
    () =>
      ledger.createDraft(
        draftInput({
          threadId: first.threadId,
          taskType: "third-check",
          idempotencyKey: "escalated-thread",
        }),
      ),
    "THREAD_ESCALATED",
    409,
  );
});

test("correction is optimistic, remains a draft, and validates routing and dates", (t) => {
  const { ledger } = harness(t);
  const draft = ledger.createKarenDraft("ctx-karen", "correction-draft");
  const corrected = ledger.correctDraft(
    draft.taskId,
    draft.version,
    {
      summary: "Check standing blood pressure",
      clinicalUrgency: "high",
      dueInMs: 60 * 60_000,
    },
    { type: "clinician", id: "clinician-1" },
  );
  assert.equal(corrected.acceptBy, "2026-08-20T10:05:00.000Z");
  assert.equal(corrected.dueBy, "2026-08-20T11:00:00.000Z");
  assertDomainError(
    () =>
      ledger.correctDraft(
        corrected.taskId,
        draft.version,
        { summary: "stale" },
        { type: "clinician", id: "clinician-1" },
      ),
    "VERSION_CONFLICT",
    409,
  );
  assertDomainError(
    () =>
      ledger.correctDraft(
        corrected.taskId,
        corrected.version,
        { dueInMs: 1.5 },
        { type: "clinician", id: "clinician-1" },
      ),
    "INVALID_DEADLINE",
    400,
  );
  assertDomainError(
    () =>
      ledger.correctDraft(
        corrected.taskId,
        corrected.version,
        { requiredCapabilities: ["missing-capability"] },
        { type: "clinician", id: "clinician-1" },
      ),
    "TEAM_NOT_ELIGIBLE",
    400,
  );

  const approval = ledger.approveDraft(
    corrected.taskId,
    corrected.version,
    "clinician-1",
  );
  const offered = ledger.publishDraft(
    corrected.taskId,
    approval.proof,
    corrected.version,
    "correction-publish",
  );
  assertDomainError(
    () =>
      ledger.correctDraft(
        offered.taskId,
        offered.version,
        { summary: "too late" },
        { type: "clinician", id: "clinician-1" },
      ),
    "NOT_A_DRAFT",
    409,
  );
});

test("only one eligible member wins an acceptance race and failed writes emit nothing", (t) => {
  const { store, ledger } = harness(t);
  const offered = publishKaren(ledger, "race");
  const accepted = ledger.acceptTask(
    offered.taskId,
    offered.version,
    "nurse-a",
    "race-a",
  );
  const eventCount = store.listEvents(0).length;

  assert.equal(accepted.assignedMemberId, "nurse-a");
  assertDomainError(
    () =>
      ledger.acceptTask(
        offered.taskId,
        offered.version,
        "nurse-b",
        "race-b",
      ),
    "VERSION_CONFLICT",
    409,
  );
  assert.equal(store.listEvents(0).length, eventCount);
});

test("eligible owner completes and downstream verification closes the thread", (t) => {
  const { store, ledger } = harness(t);
  const offered = publishKaren(ledger, "completion", "dictation_confirmation");
  const accepted = ledger.acceptTask(
    offered.taskId,
    offered.version,
    "nurse-a",
    "completion-accept",
  );
  assertDomainError(
    () =>
      ledger.completeTask(
        accepted.taskId,
        accepted.version,
        "nurse-b",
        "record:outcome-1",
      ),
    "NOT_TASK_OWNER",
    403,
  );
  const completed = ledger.completeTask(
    accepted.taskId,
    accepted.version,
    "nurse-a",
    "record:outcome-1",
  );
  const verified = ledger.verifyTask(
    completed.taskId,
    completed.version,
    "record:outcome-1",
  );

  assert.equal(verified.state, "verified");
  assert.equal(store.requireThread(verified.threadId).state, "verified");
  assertDomainError(
    () =>
      ledger.verifyTask(
        verified.taskId,
        verified.version,
        "record:outcome-1",
      ),
    "INVALID_TRANSITION",
    409,
  );
});

test("independent external readback verifies published work without fabricating acceptance", (t) => {
  const { store, ledger } = harness(t);
  const offered = publishKaren(ledger, "external-readback");
  const verified = ledger.verifyTaskFromExternalReadback(
    offered.taskId,
    offered.version,
    "record:external-bp-result",
    "delivery-karen-bp-1",
    "downstream:district-nursing",
  );

  assert.equal(verified.state, "verified");
  assert.equal(verified.assignedMemberId, null);
  assert.equal(store.requireThread(verified.threadId).state, "verified");
  const event = store
    .listEvents(0)
    .find(
      (candidate) =>
        candidate.eventType === "task.completion_verified" &&
        candidate.payload.deliveryId === "delivery-karen-bp-1",
    );
  assert.ok(event);
  assert.equal(event.payload.deliveryId, "delivery-karen-bp-1");
  assert.equal(event.payload.outcomeRef, "record:external-bp-result");

  const draft = ledger.createDraft({
    ...draftInput(),
    taskType: "second-bp-check",
    idempotencyKey: "external-draft-denied",
  });
  assertDomainError(
    () =>
      ledger.verifyTaskFromExternalReadback(
        draft.taskId,
        draft.version,
        "record:external-bp-result",
        "delivery-draft-denied",
        "downstream:district-nursing",
      ),
    "INVALID_TRANSITION",
    409,
  );
});

test("a clinician can dismiss only a draft and the thread closes atomically", (t) => {
  const { store, ledger } = harness(t);
  const draft = ledger.createKarenDraft("ctx-karen", "dismiss-draft");
  const dismissed = ledger.dismissDraft(
    draft.taskId,
    draft.version,
    "clinician-1",
    "not clinically required",
  );

  assert.equal(dismissed.state, "dismissed");
  assert.equal(store.requireThread(dismissed.threadId).state, "dismissed");
  assertDomainError(
    () =>
      ledger.dismissDraft(
        dismissed.taskId,
        dismissed.version,
        "clinician-1",
        "again",
      ),
    "INVALID_TRANSITION",
    409,
  );
});

test("task events keep the canonical identifiers, state, and positive version", (t) => {
  const { store, ledger } = harness(t);
  const draft = ledger.createKarenDraft("ctx-karen", "canonical-events");
  const events = store
    .listEvents(0)
    .filter((event) => event.eventType.startsWith("task."));

  assert.ok(events.length >= 2);
  for (const event of events) {
    assert.equal(event.payload.taskId, draft.taskId);
    assert.equal(event.payload.threadId, draft.threadId);
    assert.equal(event.payload.state, "draft");
    assert.ok(Number.isSafeInteger(event.payload.version));
    assert.ok(Number(event.payload.version) > 0);
  }
});

test("task and thread lookups use canonical not-found errors", (t) => {
  const { store, ledger } = harness(t);
  assertDomainError(() => ledger.getTask("missing"), "TASK_NOT_FOUND", 404);
  assertDomainError(
    () => store.requireThread("missing"),
    "THREAD_NOT_FOUND",
    404,
  );
});

test("acceptance rejects a same-team member who lacks availability or capacity", (t) => {
  const { store, ledger } = harness(t);
  const unavailable: Member = {
    memberId: "nurse-unavailable",
    teamId: "district-nursing",
    capabilities: ["blood-pressure"],
    onShift: true,
    available: false,
    openTaskCount: 0,
    capacity: 1,
    tieBreakKey: "z",
  };
  store.putMember(unavailable);
  const otherTeam: Team = {
    teamId: "other-team",
    name: "Other Team",
    capabilities: ["blood-pressure"],
  };
  store.putTeam(otherTeam);
  store.putMember({ ...unavailable, memberId: "other-member", teamId: "other-team", available: true });
  const offered = publishKaren(ledger, "member-eligibility");

  assertDomainError(
    () =>
      ledger.acceptTask(
        offered.taskId,
        offered.version,
        "nurse-unavailable",
        "unavailable-accept",
      ),
    "MEMBER_NOT_ELIGIBLE",
    409,
  );
  assertDomainError(
    () =>
      ledger.acceptTask(
        offered.taskId,
        offered.version,
        "other-member",
        "other-team-accept",
      ),
    "MEMBER_NOT_ELIGIBLE",
    409,
  );
});
