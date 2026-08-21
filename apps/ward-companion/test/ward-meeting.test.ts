import assert from "node:assert/strict";
import test from "node:test";

import { wardMeetingEncounterIdentifier } from "../src/lib/ward-meeting.js";

test("creates a unique Corti encounter identifier for every reconciliation attempt", () => {
  const first = wardMeetingEncounterIdentifier("11111111-1111-4111-8111-111111111111");
  const second = wardMeetingEncounterIdentifier("22222222-2222-4222-8222-222222222222");

  assert.equal(first, "ward-meeting-11111111-1111-4111-8111-111111111111");
  assert.equal(second, "ward-meeting-22222222-2222-4222-8222-222222222222");
  assert.notEqual(first, second);
  assert.ok(first.length <= 120);
  assert.ok(second.length <= 120);
});

test("rejects an encounter identifier that would exceed the Corti contract", () => {
  assert.throws(
    () => wardMeetingEncounterIdentifier("x".repeat(108)),
    /too long for a Corti encounter/,
  );
});
