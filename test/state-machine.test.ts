import assert from "node:assert/strict";
import test from "node:test";

import {
  canTransition,
  requireTransition,
} from "../src/domain/state-machine.js";
import { DomainError } from "../src/domain/errors.js";
import type { TaskState } from "../src/domain/types.js";

const states: TaskState[] = [
  "draft",
  "offered_to_team",
  "assigned_to_member",
  "accepted",
  "completed",
  "verified",
  "escalated",
  "dismissed",
];

const expected: Record<TaskState, TaskState[]> = {
  draft: ["offered_to_team", "escalated", "dismissed"],
  offered_to_team: ["accepted", "assigned_to_member", "escalated"],
  assigned_to_member: ["accepted", "assigned_to_member", "escalated"],
  accepted: ["completed", "escalated"],
  completed: ["verified", "escalated"],
  verified: [],
  escalated: ["offered_to_team", "assigned_to_member", "accepted"],
  dismissed: [],
};

test("state iteration covers every transition fixture row exactly once", () => {
  assert.deepEqual([...states].sort(), Object.keys(expected).sort());
});

test("transition table permits exactly the reviewed state pairs", () => {
  for (const from of states) {
    for (const to of states) {
      assert.equal(
        canTransition(from, to),
        expected[from].includes(to),
        `${from} -> ${to}`,
      );
    }
  }
});

test("allows the canonical successful lifecycle", () => {
  assert.equal(canTransition("draft", "offered_to_team"), true);
  assert.equal(canTransition("offered_to_team", "accepted"), true);
  assert.equal(canTransition("accepted", "completed"), true);
  assert.equal(canTransition("completed", "verified"), true);
});

test("allows deterministic timeout assignment and human recovery", () => {
  assert.equal(canTransition("offered_to_team", "assigned_to_member"), true);
  assert.equal(canTransition("assigned_to_member", "accepted"), true);
  assert.equal(canTransition("draft", "escalated"), true);
  assert.equal(canTransition("escalated", "offered_to_team"), true);
});

test("requires a valid transition without throwing", () => {
  assert.doesNotThrow(() => requireTransition("accepted", "completed"));
});

test("rejects self-verification shortcuts", () => {
  assert.equal(canTransition("draft", "verified"), false);

  let caught: unknown;
  try {
    requireTransition("accepted", "verified");
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof DomainError);
  assert.equal(caught.name, "DomainError");
  assert.equal(caught.code, "INVALID_TRANSITION");
  assert.equal(caught.message, "accepted cannot transition to verified");
  assert.equal(caught.retryable, false);
  assert.equal(caught.status, 409);
});

test("DomainError applies non-retryable bad-request defaults", () => {
  const error = new DomainError("TEST_ERROR", "test failure");

  assert.equal(error.name, "DomainError");
  assert.equal(error.code, "TEST_ERROR");
  assert.equal(error.message, "test failure");
  assert.equal(error.retryable, false);
  assert.equal(error.status, 400);
});
