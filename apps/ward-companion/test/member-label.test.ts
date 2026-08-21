import assert from "node:assert/strict";
import test from "node:test";

import { memberLabel } from "../src/lib/member-label";
import { wardTimestampLabel } from "../src/lib/ward-time-label";

test("memberLabel turns an authoritative member identifier into a neutral display label", () => {
  assert.equal(memberLabel("nurse-a"), "Nurse A");
  assert.equal(memberLabel("district_nurse-17"), "District Nurse 17");
  assert.equal(memberLabel("audience:participant-1"), "Audience Participant 1");
});

test("memberLabel does not invent a clinician identity", () => {
  assert.notEqual(memberLabel("nurse-a"), "Nurse Kelly O.");
});

test("wardTimestampLabel keeps short demo times and makes backend ISO dates human-readable", () => {
  assert.equal(wardTimestampLabel("09:12"), "09:12");
  const label = wardTimestampLabel("2026-08-23T08:53:11.653Z");
  assert.match(label, /^23 Aug · \d{2}:\d{2}$/);
  assert.doesNotMatch(label, /[TZ]/u);
});
