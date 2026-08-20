import assert from "node:assert/strict";
import test from "node:test";

import {
  canTransition,
  requireTransition,
} from "../src/domain/state-machine.js";
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

test("rejects self-verification shortcuts", () => {
  assert.equal(canTransition("draft", "verified"), false);
  assert.throws(() => requireTransition("accepted", "verified"), {
    code: "INVALID_TRANSITION",
  });
});
