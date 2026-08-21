import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../src/domain/errors.js";
import { calculatePriority } from "../src/domain/priority.js";
import { chooseMember } from "../src/domain/routing.js";
import type { Member, Task, TaskState } from "../src/domain/types.js";
import { DemoClock, SystemClock } from "../src/infra/clock.js";

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    taskId: "task-1",
    threadId: "thread-1",
    patientId: "patient-1",
    origin: "clinician_created",
    summary: "Check blood pressure",
    taskType: "blood-pressure-check",
    evidenceRefs: ["evidence-1"],
    targetTeamId: "district-nursing",
    requiredCapabilities: ["blood-pressure"],
    clinicalUrgency: "medium",
    operationalPriorityScore: 0,
    priorityBreakdown: {
      base: 0,
      deadlinePressure: 0,
      overdue: 0,
      failedOffers: 0,
      total: 0,
      activeTargetAt: "2026-08-20T10:30:00.000Z",
    },
    acceptBy: "2026-08-20T10:30:00.000Z",
    dueBy: "2026-08-22T10:00:00.000Z",
    state: "offered_to_team",
    assignedMemberId: null,
    failedOffers: 0,
    version: 1,
    createdAt: "2026-08-20T10:00:00.000Z",
    updatedAt: "2026-08-20T10:00:00.000Z",
    ...overrides,
  };
}

function createMember(overrides: Partial<Member> = {}): Member {
  return {
    memberId: "nurse-a",
    teamId: "district-nursing",
    capabilities: ["blood-pressure"],
    onShift: true,
    available: true,
    openTaskCount: 1,
    capacity: 4,
    tieBreakKey: "a",
    ...overrides,
  };
}

function assertDomainError(
  operation: () => unknown,
  expected: {
    code: string;
    message: string;
    retryable: boolean;
    status: number;
  },
): void {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof DomainError);
  assert.equal(caught.name, "DomainError");
  assert.equal(caught.code, expected.code);
  assert.equal(caught.message, expected.message);
  assert.equal(caught.retryable, expected.retryable);
  assert.equal(caught.status, expected.status);
}

test("medium work rises as its acceptance deadline approaches", () => {
  const task = createTask();
  const early = calculatePriority(task, new Date("2026-08-20T10:00:00.000Z"));
  const late = calculatePriority(task, new Date("2026-08-20T10:29:00.000Z"));

  assert.equal(early.base, 60);
  assert.ok(late.total > early.total);
  assert.equal(late.activeTargetAt, task.acceptBy);
});

test("accepted work ages against dueBy and gains 45 points one hour overdue", () => {
  const task = createTask({ state: "accepted" });
  const result = calculatePriority(task, new Date("2026-08-22T11:00:00.000Z"));

  assert.equal(result.activeTargetAt, task.dueBy);
  assert.equal(result.overdue, 45);
});

test("uses the exact high urgency base without hidden weights", () => {
  const result = calculatePriority(
    createTask({ clinicalUrgency: "high" }),
    new Date("2026-08-20T10:00:00.000Z"),
  );

  assert.deepEqual(result, {
    base: 100,
    deadlinePressure: 0,
    overdue: 0,
    failedOffers: 0,
    total: 100,
    activeTargetAt: "2026-08-20T10:30:00.000Z",
  });
});

test("uses the exact routine urgency base without hidden weights", () => {
  const result = calculatePriority(
    createTask({ clinicalUrgency: "routine" }),
    new Date("2026-08-20T10:00:00.000Z"),
  );

  assert.deepEqual(result, {
    base: 20,
    deadlinePressure: 0,
    overdue: 0,
    failedOffers: 0,
    total: 20,
    activeTargetAt: "2026-08-20T10:30:00.000Z",
  });
});

test("at the active target applies full pressure and the initial overdue weight", () => {
  const result = calculatePriority(
    createTask(),
    new Date("2026-08-20T10:30:00.000Z"),
  );

  assert.deepEqual(result, {
    base: 60,
    deadlinePressure: 30,
    overdue: 40,
    failedOffers: 0,
    total: 130,
    activeTargetAt: "2026-08-20T10:30:00.000Z",
  });
});

test("identical creation and target times count as full deadline progress", () => {
  const target = "2026-08-20T10:00:00.000Z";
  const result = calculatePriority(
    createTask({ acceptBy: target }),
    new Date(target),
  );

  assert.equal(result.deadlinePressure, 30);
  assert.equal(result.overdue, 40);
});

test("rounds and clamps deadline pressure within its exact bounds", () => {
  const task = createTask();

  assert.equal(
    calculatePriority(task, new Date("2026-08-20T09:00:00.000Z"))
      .deadlinePressure,
    0,
  );
  assert.equal(
    calculatePriority(task, new Date("2026-08-20T10:14:31.000Z"))
      .deadlinePressure,
    15,
  );
  assert.equal(
    calculatePriority(task, new Date("2026-08-20T12:00:00.000Z"))
      .deadlinePressure,
    30,
  );
});

test("floors partial overdue hours before applying their weight", () => {
  const result = calculatePriority(
    createTask(),
    new Date("2026-08-20T12:29:59.999Z"),
  );

  assert.equal(result.overdue, 45);
});

test("caps the overdue weight at 80", () => {
  const result = calculatePriority(
    createTask(),
    new Date("2026-08-21T10:30:00.000Z"),
  );

  assert.equal(result.overdue, 80);
  assert.equal(result.total, 170);
});

test("caps failed-offer weight at 20 and includes it in the exact total", () => {
  const result = calculatePriority(
    createTask({ failedOffers: 3 }),
    new Date("2026-08-20T10:00:00.000Z"),
  );

  assert.deepEqual(result, {
    base: 60,
    deadlinePressure: 0,
    overdue: 0,
    failedOffers: 20,
    total: 80,
    activeTargetAt: "2026-08-20T10:30:00.000Z",
  });
});

test("adds exactly ten points for one failed offer", () => {
  const result = calculatePriority(
    createTask({ failedOffers: 1 }),
    new Date("2026-08-20T10:00:00.000Z"),
  );

  assert.equal(result.failedOffers, 10);
  assert.equal(result.total, 70);
});

test("completed work uses dueBy as its active target", () => {
  const task = createTask({ state: "completed" });

  assert.equal(
    calculatePriority(task, new Date(task.createdAt)).activeTargetAt,
    task.dueBy,
  );
});

test("every state other than accepted and completed uses acceptBy", () => {
  const states: TaskState[] = [
    "draft",
    "offered_to_team",
    "assigned_to_member",
    "verified",
    "escalated",
    "dismissed",
  ];

  for (const state of states) {
    const task = createTask({ state });
    assert.equal(
      calculatePriority(task, new Date(task.createdAt)).activeTargetAt,
      task.acceptBy,
      state,
    );
  }
});

test("stable routing selects nurse-a while excluding an off-shift member", () => {
  const task = createTask();
  const members: Member[] = [
    createMember({ memberId: "nurse-b", tieBreakKey: "b" }),
    createMember({ memberId: "nurse-a", tieBreakKey: "a" }),
    createMember({
      memberId: "nurse-off",
      onShift: false,
      openTaskCount: 0,
      tieBreakKey: "0",
    }),
  ];

  assert.equal(chooseMember(task, members)?.memberId, "nurse-a");
});

test("normal routing excludes demo audience members unless explicitly opted in", () => {
  const audience = createMember({
    memberId: "audience:participant-1",
    openTaskCount: 0,
    tieBreakKey: "0",
  });
  const nurse = createMember({
    memberId: "nurse-a",
    openTaskCount: 2,
    tieBreakKey: "z",
  });

  assert.equal(chooseMember(createTask(), [audience, nurse]), nurse);
  assert.equal(
    chooseMember(createTask(), [audience, nurse], {
      includeDemoAudience: true,
    }),
    audience,
  );
});

test("routing excludes every kind of ineligible member", () => {
  const task = createTask({
    requiredCapabilities: ["blood-pressure", "home-visit"],
  });
  const eligible = createMember({
    memberId: "eligible",
    capabilities: ["home-visit", "blood-pressure"],
    openTaskCount: 3,
    tieBreakKey: "z",
  });
  const members: Member[] = [
    createMember({
      memberId: "wrong-team",
      teamId: "general-practice",
      capabilities: ["home-visit", "blood-pressure"],
      openTaskCount: 0,
    }),
    createMember({
      memberId: "off-shift",
      onShift: false,
      capabilities: ["home-visit", "blood-pressure"],
      openTaskCount: 0,
    }),
    createMember({
      memberId: "unavailable",
      available: false,
      capabilities: ["home-visit", "blood-pressure"],
      openTaskCount: 0,
    }),
    createMember({
      memberId: "at-capacity",
      capabilities: ["home-visit", "blood-pressure"],
      openTaskCount: 4,
      capacity: 4,
    }),
    createMember({
      memberId: "missing-capability",
      capabilities: ["blood-pressure"],
      openTaskCount: 0,
    }),
    eligible,
  ];

  assert.equal(chooseMember(task, members), eligible);
});

test("routing prioritizes the lowest open task count before tie-break keys", () => {
  const members = [
    createMember({
      memberId: "lighter-load",
      openTaskCount: 0,
      tieBreakKey: "z",
    }),
    createMember({
      memberId: "earlier-key",
      openTaskCount: 1,
      tieBreakKey: "a",
    }),
  ];

  assert.equal(chooseMember(createTask(), members)?.memberId, "lighter-load");
});

test("routing prioritizes tie-break keys before member IDs", () => {
  const members = [
    createMember({ memberId: "nurse-a", tieBreakKey: "z" }),
    createMember({ memberId: "nurse-z", tieBreakKey: "a" }),
  ];

  assert.equal(chooseMember(createTask(), members)?.memberId, "nurse-z");
});

test("routing compares mixed-case tie-break keys by UTF-16 code units", () => {
  const members = [
    createMember({ memberId: "lowercase-key", tieBreakKey: "a" }),
    createMember({ memberId: "uppercase-key", tieBreakKey: "Z" }),
  ];

  assert.equal(chooseMember(createTask(), members)?.memberId, "uppercase-key");
});

test("routing uses member ID after workload and tie-break key are equal", () => {
  const members = [
    createMember({ memberId: "nurse-b", tieBreakKey: "shared" }),
    createMember({ memberId: "nurse-a", tieBreakKey: "shared" }),
  ];

  assert.equal(chooseMember(createTask(), members)?.memberId, "nurse-a");
});

test("routing compares non-ASCII member IDs by UTF-16 code units", () => {
  const members = [
    createMember({ memberId: "nurse-ä", tieBreakKey: "shared" }),
    createMember({ memberId: "nurse-z", tieBreakKey: "shared" }),
  ];

  assert.equal(chooseMember(createTask(), members)?.memberId, "nurse-z");
});

test("routing returns null when no member is eligible", () => {
  const members = [createMember({ available: false })];

  assert.equal(chooseMember(createTask(), members), null);
});

test("routing does not mutate the input member array", () => {
  const members = [
    createMember({ memberId: "nurse-c", openTaskCount: 2, tieBreakKey: "c" }),
    createMember({ memberId: "nurse-a", openTaskCount: 0, tieBreakKey: "a" }),
    createMember({ memberId: "nurse-b", openTaskCount: 1, tieBreakKey: "b" }),
  ];
  const originalOrder = members.map((member) => member.memberId);

  chooseMember(createTask(), members);

  assert.deepEqual(
    members.map((member) => member.memberId),
    originalOrder,
  );
});

test("DemoClock returns defensive Date copies", () => {
  const clock = new DemoClock(new Date("2026-08-20T10:00:00.000Z"), true);
  const first = clock.now();
  const second = clock.now();

  assert.notEqual(first, second);
  first.setUTCFullYear(2040);
  assert.equal(clock.now().toISOString(), "2026-08-20T10:00:00.000Z");
});

test("DemoClock defensively copies its constructor Date", () => {
  const current = new Date("2026-08-20T10:00:00.000Z");
  const clock = new DemoClock(current, true);

  current.setUTCFullYear(2040);

  assert.equal(clock.now().toISOString(), "2026-08-20T10:00:00.000Z");
});

test("DemoClock advances by positive milliseconds and returns a defensive copy", () => {
  const clock = new DemoClock(new Date("2026-08-20T10:00:00.000Z"), true);

  const advanced = clock.advance(3_600_000);
  assert.equal(advanced.toISOString(), "2026-08-20T11:00:00.000Z");

  advanced.setUTCFullYear(2040);
  assert.equal(clock.now().toISOString(), "2026-08-20T11:00:00.000Z");
});

test("DemoClock rejects fractional positive advances without changing time", () => {
  const clock = new DemoClock(new Date("2026-08-20T10:00:00.000Z"), true);

  assertDomainError(() => clock.advance(0.1), {
    code: "INVALID_CLOCK_ADVANCE",
    message: "milliseconds must be positive",
    retryable: false,
    status: 400,
  });
  assert.equal(clock.now().toISOString(), "2026-08-20T10:00:00.000Z");
});

test("DemoClock rejects unsafe and overflowing advances without poisoning time", () => {
  for (const milliseconds of [
    Number.MAX_SAFE_INTEGER + 1,
    Number.MAX_SAFE_INTEGER,
  ]) {
    const clock = new DemoClock(new Date("2026-08-20T10:00:00.000Z"), true);

    assertDomainError(() => clock.advance(milliseconds), {
      code: "INVALID_CLOCK_ADVANCE",
      message: "milliseconds must be positive",
      retryable: false,
      status: 400,
    });
    assert.equal(clock.now().toISOString(), "2026-08-20T10:00:00.000Z");
    assert.equal(clock.advance(1).toISOString(), "2026-08-20T10:00:00.001Z");
  }
});

test("disabled DemoClock reads real time and rejects advance with a forbidden error", () => {
  const clock = new DemoClock(new Date("2000-01-01T00:00:00.000Z"), false);
  const before = Date.now();
  const current = clock.now();
  const after = Date.now();

  assert.ok(current.getTime() >= before);
  assert.ok(current.getTime() <= after);
  assertDomainError(() => clock.advance(1), {
    code: "DEMO_CLOCK_DISABLED",
    message: "Demo clock is disabled",
    retryable: false,
    status: 403,
  });
});

test("DemoClock rejects every non-positive or non-finite advance with defaults", () => {
  for (const milliseconds of [0, -1, Number.NaN, Infinity, -Infinity]) {
    const clock = new DemoClock(new Date("2026-08-20T10:00:00.000Z"), true);

    assertDomainError(() => clock.advance(milliseconds), {
      code: "INVALID_CLOCK_ADVANCE",
      message: "milliseconds must be positive",
      retryable: false,
      status: 400,
    });
    assert.equal(clock.now().toISOString(), "2026-08-20T10:00:00.000Z");
  }
});

test("SystemClock returns a plausible current Date", () => {
  const clock = new SystemClock();
  const before = Date.now();
  const current = clock.now();
  const after = Date.now();

  assert.ok(current instanceof Date);
  assert.ok(current.getTime() >= before);
  assert.ok(current.getTime() <= after);
});
