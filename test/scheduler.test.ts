import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { DomainError } from "../src/domain/errors.js";
import type { Member } from "../src/domain/types.js";
import { seedKaren } from "../src/fixtures/karen.js";
import { DemoClock } from "../src/infra/clock.js";
import { openDatabase } from "../src/infra/database.js";
import { SqliteStore } from "../src/infra/store.js";
import { LedgerService } from "../src/services/ledger-service.js";
import { SchedulerService } from "../src/services/scheduler-service.js";

const NOW = "2026-08-20T10:00:00.000Z";
const SECRET = "approval-secret-with-at-least-32-bytes";

function harness(t: TestContext) {
  const store = new SqliteStore(openDatabase(":memory:"));
  t.after(() => store.close());
  seedKaren(store, NOW);
  const clock = new DemoClock(new Date(NOW), true);
  const ledger = new LedgerService(store, clock, SECRET);
  return {
    store,
    clock,
    ledger,
    scheduler: new SchedulerService(store, clock),
  };
}

function publish(
  ledger: LedgerService,
  suffix: string,
  dueInMs = 48 * 60 * 60_000,
) {
  const draft = ledger.createDraft({
    patientId: "synthetic-karen",
    interactionId: "interaction-karen-1",
    contextId: "ctx-karen",
    origin: "agent_suggested",
    summary: "Check blood pressure",
    taskType: `blood-pressure-${suffix}`,
    evidenceRefs: ["encounter:sentence-42"],
    targetTeamId: "district-nursing",
    requiredCapabilities: ["blood-pressure"],
    clinicalUrgency: "medium",
    dueInMs,
    idempotencyKey: `draft-${suffix}`,
    actor: { type: "agent", id: "corti" },
  });
  const approval = ledger.approveDraft(
    draft.taskId,
    draft.version,
    "clinician-1",
    "app_one_tap",
    `approval-${suffix}`,
  );
  return ledger.publishDraft(
    draft.taskId,
    approval.proof,
    draft.version,
    `publish-${suffix}`,
  );
}

function assertDomainError(
  operation: () => unknown,
  code: string,
  status: number,
): void {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof DomainError);
  assert.equal(caught.code, code);
  assert.equal(caught.status, status);
}

function makeMembersUnavailable(store: SqliteStore): void {
  for (const member of store.listMembers("district-nursing")) {
    store.putMember({
      ...member,
      openTaskCount: member.capacity,
    });
  }
}

test("medium task assigns nurse-a exactly at the thirty-minute acceptance deadline", (t) => {
  const { store, clock, ledger, scheduler } = harness(t);
  const offered = publish(ledger, "exact-acceptance");

  clock.advance(30 * 60_000 - 1);
  scheduler.tick();
  assert.equal(ledger.getTask(offered.taskId).state, "offered_to_team");

  clock.advance(1);
  scheduler.tick();
  const assigned = ledger.getTask(offered.taskId);
  assert.equal(assigned.state, "assigned_to_member");
  assert.equal(assigned.assignedMemberId, "nurse-a");
  assert.equal(assigned.failedOffers, 1);
  const assignmentEvent = store
    .listEvents(0)
    .find((event) => event.eventType === "task.member_assigned");
  assert.ok(assignmentEvent);
  assert.deepEqual(assignmentEvent.payload.routingDecision, {
    policyVersion: "availability-capability-load-v1",
    selectedMemberId: "nurse-a",
    requiredCapabilities: ["blood-pressure"],
    candidates: [
      {
        memberId: "nurse-a",
        teamId: "district-nursing",
        eligible: true,
        rank: 1,
        openTaskCount: 1,
        capacity: 4,
        capabilities: ["blood-pressure"],
        missingCapabilities: [],
        checks: {
          teamMatch: true,
          onShift: true,
          available: true,
          hasCapacity: true,
          capabilitiesMatch: true,
        },
        exclusionReasons: [],
      },
      {
        memberId: "nurse-b",
        teamId: "district-nursing",
        eligible: true,
        rank: 2,
        openTaskCount: 2,
        capacity: 4,
        capabilities: ["blood-pressure"],
        missingCapabilities: [],
        checks: {
          teamMatch: true,
          onShift: true,
          available: true,
          hasCapacity: true,
          capabilitiesMatch: true,
        },
        exclusionReasons: [],
      },
    ],
  });
});

test("an offered task past due escalates before acceptance timeout can assign it", (t) => {
  const { store, clock, ledger, scheduler } = harness(t);
  const offered = publish(ledger, "past-due-offer", 30 * 60_000);
  clock.advance(30 * 60_000);

  scheduler.tick();
  const escalated = ledger.getTask(offered.taskId);
  assert.equal(escalated.state, "escalated");
  assert.equal(escalated.assignedMemberId, null);
  assert.equal(escalated.clinicalUrgency, "medium");
  const events = store
    .listEvents(0)
    .filter((event) =>
      ["task.team_acceptance_timed_out", "task.member_assigned"].includes(
        event.eventType,
      ),
    );
  assert.deepEqual(events, []);
});

test("draft, assigned, accepted, and completed work escalates exactly at dueBy", async (t) => {
  for (const targetState of [
    "draft",
    "assigned_to_member",
    "accepted",
    "completed",
  ] as const) {
    await t.test(targetState, () => {
      const { clock, ledger, scheduler } = harness(t);
      let task = ledger.createDraft({
        patientId: "synthetic-karen",
        interactionId: "interaction-karen-1",
        contextId: "ctx-karen",
        origin: "agent_suggested",
        summary: `Check ${targetState}`,
        taskType: `overdue-${targetState}`,
        evidenceRefs: ["encounter:sentence-42"],
        targetTeamId: "district-nursing",
        requiredCapabilities: ["blood-pressure"],
        clinicalUrgency: "medium",
        dueInMs: 48 * 60 * 60_000,
        idempotencyKey: `draft-${targetState}`,
        actor: { type: "agent", id: "corti" },
      });
      if (targetState !== "draft") {
        const approval = ledger.approveDraft(
          task.taskId,
          task.version,
          "clinician-1",
        );
        task = ledger.publishDraft(
          task.taskId,
          approval.proof,
          task.version,
          `publish-${targetState}`,
        );
      }
      if (targetState === "assigned_to_member") {
        clock.advance(30 * 60_000);
        scheduler.tick();
        task = ledger.getTask(task.taskId);
      }
      if (targetState === "accepted" || targetState === "completed") {
        task = ledger.acceptTask(
          task.taskId,
          task.version,
          "nurse-a",
          `accept-${targetState}`,
        );
      }
      if (targetState === "completed") {
        task = ledger.completeTask(
          task.taskId,
          task.version,
          "nurse-a",
          "record:bp-result",
        );
      }
      const remaining = Date.parse(task.dueBy) - clock.now().getTime();
      clock.advance(remaining);
      scheduler.tick();

      const escalated = ledger.getTask(task.taskId);
      assert.equal(escalated.state, "escalated");
      assert.equal(escalated.clinicalUrgency, "medium");
    });
  }
});

test("same-time second tick does not add another transition or event", (t) => {
  const { store, clock, ledger, scheduler } = harness(t);
  const offered = publish(ledger, "idempotent-tick");
  clock.advance(30 * 60_000);
  scheduler.tick();
  const afterFirst = ledger.getTask(offered.taskId);
  const eventsAfterFirst = store.listEvents(0).length;

  scheduler.tick();
  assert.deepEqual(ledger.getTask(offered.taskId), afterFirst);
  assert.equal(store.listEvents(0).length, eventsAfterFirst);
});

test("priority refresh changes state once and is stable at the same clock time", (t) => {
  const { store, clock, ledger, scheduler } = harness(t);
  const offered = publish(ledger, "priority-refresh");
  clock.advance(15 * 60_000);

  scheduler.tick();
  const refreshed = ledger.getTask(offered.taskId);
  const recalculations = store
    .listEvents(0)
    .filter(
      (event) => event.eventType === "task.operational_priority_recalculated",
    ).length;
  assert.ok(
    refreshed.operationalPriorityScore > offered.operationalPriorityScore,
  );
  assert.equal(recalculations, 1);

  scheduler.tick();
  assert.deepEqual(ledger.getTask(offered.taskId), refreshed);
  assert.equal(
    store
      .listEvents(0)
      .filter(
        (event) => event.eventType === "task.operational_priority_recalculated",
      ).length,
    1,
  );
});

test("declines choose nurse-b and then escalate after all eligible members decline", (t) => {
  const { store, clock, ledger, scheduler } = harness(t);
  const offered = publish(ledger, "declines");
  clock.advance(30 * 60_000);
  scheduler.tick();
  const nurseA = ledger.getTask(offered.taskId);
  assert.equal(nurseA.assignedMemberId, "nurse-a");

  scheduler.decline(nurseA.taskId, nurseA.version, "nurse-a");
  const nurseB = ledger.getTask(nurseA.taskId);
  assert.equal(nurseB.state, "assigned_to_member");
  assert.equal(nurseB.assignedMemberId, "nurse-b");
  assert.deepEqual(store.listDeclinedMemberIds(nurseA.taskId), ["nurse-a"]);

  scheduler.decline(nurseB.taskId, nurseB.version, "nurse-b");
  const escalated = ledger.getTask(nurseB.taskId);
  assert.equal(escalated.state, "escalated");
  assert.equal(escalated.clinicalUrgency, "medium");
  assert.deepEqual(store.listDeclinedMemberIds(nurseA.taskId), [
    "nurse-a",
    "nurse-b",
  ]);
  assert.ok(
    store
      .listEvents(0)
      .some(
        (event) =>
          event.eventType === "task.escalated" &&
          event.payload.reason === "ALL_ELIGIBLE_MEMBERS_DECLINED",
      ),
  );
});

test("only the current assigned member can decline and a failed decline is atomic", (t) => {
  const { store, clock, ledger, scheduler } = harness(t);
  const offered = publish(ledger, "wrong-decliner");
  clock.advance(30 * 60_000);
  scheduler.tick();
  const assigned = ledger.getTask(offered.taskId);
  const eventCount = store.listEvents(0).length;

  assertDomainError(
    () => scheduler.decline(assigned.taskId, assigned.version, "nurse-b"),
    "VERSION_CONFLICT",
    409,
  );
  assert.deepEqual(ledger.getTask(assigned.taskId), assigned);
  assert.deepEqual(store.listDeclinedMemberIds(assigned.taskId), []);
  assert.equal(store.listEvents(0).length, eventCount);
});

test("acceptance timeout escalates when every capable member lacks capacity", (t) => {
  const { store, clock, ledger, scheduler } = harness(t);
  makeMembersUnavailable(store);
  const offered = publish(ledger, "no-capacity");
  clock.advance(30 * 60_000);

  scheduler.tick();
  assert.equal(ledger.getTask(offered.taskId).state, "escalated");
  assert.ok(
    store
      .listEvents(0)
      .some(
        (event) =>
          event.eventType === "task.escalated" &&
          event.payload.reason === "NO_ELIGIBLE_MEMBER",
      ),
  );
});

test("reopen gives escalated work new windows without changing clinical urgency", (t) => {
  const { store, clock, ledger, scheduler } = harness(t);
  makeMembersUnavailable(store);
  const offered = publish(ledger, "reopen");
  clock.advance(30 * 60_000);
  scheduler.tick();
  const escalated = ledger.getTask(offered.taskId);

  const reopened = ledger.reopenToTeam(
    escalated.taskId,
    escalated.version,
    "clinician-1",
    48 * 60 * 60_000,
  );
  assert.equal(reopened.state, "offered_to_team");
  assert.equal(reopened.clinicalUrgency, "medium");
  assert.equal(reopened.acceptBy, "2026-08-20T11:00:00.000Z");
  assert.equal(reopened.dueBy, "2026-08-22T10:30:00.000Z");
  assert.equal(store.requireThread(reopened.threadId).state, "tracking");
  assertDomainError(
    () =>
      ledger.reopenToTeam(
        escalated.taskId,
        reopened.version,
        "clinician-1",
        Number.POSITIVE_INFINITY,
      ),
    "INVALID_TRANSITION",
    409,
  );
});

test("routing remains deterministic when members have identical load and tie-break", (t) => {
  const { store, clock, ledger, scheduler } = harness(t);
  const nurseA = store
    .listMembers("district-nursing")
    .find((member) => member.memberId === "nurse-a");
  assert.ok(nurseA);
  const nurseZero: Member = {
    ...nurseA,
    memberId: "nurse-0",
    tieBreakKey: nurseA.tieBreakKey,
  };
  store.putMember(nurseZero);
  const offered = publish(ledger, "secondary-order");
  clock.advance(30 * 60_000);

  scheduler.tick();
  assert.equal(ledger.getTask(offered.taskId).assignedMemberId, "nurse-0");
});
