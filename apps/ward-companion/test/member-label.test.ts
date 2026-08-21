import assert from "node:assert/strict";
import test from "node:test";

import { memberLabel } from "../src/lib/member-label";

test("memberLabel turns an authoritative member identifier into a neutral display label", () => {
  assert.equal(memberLabel("nurse-a"), "Nurse A");
  assert.equal(memberLabel("district_nurse-17"), "District Nurse 17");
  assert.equal(memberLabel("audience:participant-1"), "Audience Participant 1");
});

test("memberLabel does not invent a clinician identity", () => {
  assert.notEqual(memberLabel("nurse-a"), "Nurse Kelly O.");
});
