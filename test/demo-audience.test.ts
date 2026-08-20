import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../src/domain/errors.js";
import { createAppHarness } from "./support.js";

function createSession(harness: ReturnType<typeof createAppHarness>) {
  return harness.demoAudience.createSession({
    title: "Audience discharge coordination",
    scenario: "discharge_coordination",
    groupSize: 2,
    targetTeamId: "district-nursing",
    idempotencyKey: "create-session-001",
    actorId: "clinician:demo-host",
  });
}

function join(
  harness: ReturnType<typeof createAppHarness>,
  joinCode: string,
  displayName: string,
  joinKey: string,
) {
  return harness.demoAudience.joinSession({ joinCode, displayName, joinKey });
}

function publishTask(harness: ReturnType<typeof createAppHarness>) {
  const draft = harness.ledger.createKarenDraft(
    "ctx-karen",
    "demo-audience-draft",
  );
  const approval = harness.ledger.approveDraft(
    draft.taskId,
    draft.version,
    "clinician:demo-host",
    "app_one_tap",
    "demo-audience-approval",
  );
  return harness.ledger.publishDraft(
    draft.taskId,
    approval.proof,
    draft.version,
    "demo-audience-publish",
  );
}

test("QR joiners are deterministically placed into solo or duo groups", (t) => {
  const harness = createAppHarness();
  t.after(() => harness.store.close());
  const session = createSession(harness);

  const first = join(harness, session.joinCode, "Alex", "browser-key-alex");
  const second = join(harness, session.joinCode, "Blair", "browser-key-blair");
  const third = join(harness, session.joinCode, "Casey", "browser-key-casey");

  assert.equal(first.participant.groupId, "group-1");
  assert.equal(second.participant.groupId, "group-1");
  assert.equal(third.participant.groupId, "group-2");
  assert.equal(
    new Set([first.participantToken, second.participantToken]).size,
    2,
  );

  const view = harness.demoAudience.getSession(session.sessionId);
  assert.deepEqual(
    view.groups.map((group) => ({
      groupId: group.groupId,
      names: group.participants.map((participant) => participant.displayName),
    })),
    [
      { groupId: "group-1", names: ["Alex", "Blair"] },
      { groupId: "group-2", names: ["Casey"] },
    ],
  );
});

test("a retried QR join rotates the participant token without duplicating the member", (t) => {
  const harness = createAppHarness();
  t.after(() => harness.store.close());
  const session = createSession(harness);
  const first = join(harness, session.joinCode, "Alex", "browser-key-alex");
  const retried = join(
    harness,
    session.joinCode,
    "Alex Updated",
    "browser-key-alex",
  );

  assert.equal(
    retried.participant.participantId,
    first.participant.participantId,
  );
  assert.notEqual(retried.participantToken, first.participantToken);
  assert.equal(
    harness.demoAudience.getSession(session.sessionId).groups[0]?.participants
      .length,
    1,
  );
  assert.throws(
    () => harness.demoAudience.participantView(first.participantToken),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "DEMO_PARTICIPANT_UNAUTHORIZED" &&
      error.status === 401,
  );
  assert.equal(
    harness.demoAudience.participantView(retried.participantToken).participant
      .displayName,
    "Alex Updated",
  );
});

test("an approved published task is assigned to one audience participant in the chosen group", (t) => {
  const harness = createAppHarness();
  t.after(() => harness.store.close());
  const session = createSession(harness);
  const first = join(harness, session.joinCode, "Alex", "browser-key-alex");
  const second = join(harness, session.joinCode, "Blair", "browser-key-blair");
  const offered = publishTask(harness);

  const result = harness.demoAudience.assignTask({
    sessionId: session.sessionId,
    groupId: "group-1",
    taskId: offered.taskId,
    expectedVersion: offered.version,
    idempotencyKey: "assign-audience-task-001",
    actorId: "clinician:demo-host",
  });

  assert.equal(result.task.state, "assigned_to_member");
  assert.equal(result.task.assignedMemberId, first.participant.memberId);
  assert.equal(
    result.participant.participantId,
    first.participant.participantId,
  );
  assert.equal(
    harness.demoAudience.participantView(first.participantToken).assignments[0]
      ?.task.taskId,
    offered.taskId,
  );
  assert.equal(
    harness.demoAudience.participantView(second.participantToken).assignments
      .length,
    0,
  );

  const replay = harness.demoAudience.assignTask({
    sessionId: session.sessionId,
    groupId: "group-1",
    taskId: offered.taskId,
    expectedVersion: offered.version,
    idempotencyKey: "assign-audience-task-001",
    actorId: "clinician:demo-host",
  });
  assert.deepEqual(replay, result);

  const semanticRetry = harness.demoAudience.assignTask({
    sessionId: session.sessionId,
    groupId: "group-1",
    taskId: offered.taskId,
    expectedVersion: offered.version,
    idempotencyKey: "assign-audience-task-new-key",
    actorId: "clinician:demo-host",
  });
  assert.deepEqual(semanticRetry, result);
});

test("assignment rejects draft tasks and tasks for a different team", (t) => {
  const harness = createAppHarness();
  t.after(() => harness.store.close());
  const session = createSession(harness);
  join(harness, session.joinCode, "Alex", "browser-key-alex");
  const draft = harness.ledger.createKarenDraft(
    "ctx-karen",
    "demo-audience-unpublished",
  );

  assert.throws(
    () =>
      harness.demoAudience.assignTask({
        sessionId: session.sessionId,
        groupId: "group-1",
        taskId: draft.taskId,
        expectedVersion: draft.version,
        idempotencyKey: "assign-unpublished-task",
        actorId: "clinician:demo-host",
      }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "DEMO_TASK_NOT_ASSIGNABLE",
  );
  harness.ledger.dismissDraft(
    draft.taskId,
    draft.version,
    "clinician:demo-host",
    "Complete the negative assignment test",
  );

  harness.store.putTeam({
    teamId: "discharge-coordination",
    name: "Discharge Coordination",
    capabilities: ["blood-pressure"],
  });
  const otherTeamSession = harness.demoAudience.createSession({
    title: "Other team audience session",
    scenario: "meeting",
    groupSize: 1,
    targetTeamId: "discharge-coordination",
    idempotencyKey: "create-other-session-001",
    actorId: "clinician:demo-host",
  });
  join(harness, otherTeamSession.joinCode, "Blair", "browser-key-blair");
  const offered = publishTask(harness);
  assert.throws(
    () =>
      harness.demoAudience.assignTask({
        sessionId: otherTeamSession.sessionId,
        groupId: "group-1",
        taskId: offered.taskId,
        expectedVersion: offered.version,
        idempotencyKey: "assign-wrong-team-task",
        actorId: "clinician:demo-host",
      }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "DEMO_TASK_TEAM_MISMATCH",
  );
});
