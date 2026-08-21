import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const liveStrip = readFileSync(
  new URL("../src/components/ward/CortiLiveStrip.tsx", import.meta.url),
  "utf8",
);
const patientActivity = readFileSync(
  new URL("../src/components/ward/PatientActivity.tsx", import.meta.url),
  "utf8",
);
const wardRuntime = readFileSync(
  new URL("../src/features/ward-runtime/useWardRuntime.ts", import.meta.url),
  "utf8",
);

test("a created Agentic draft has an obvious review and confirmation action", () => {
  assert.match(liveStrip, /Review & confirm task/);
  assert.match(liveStrip, /draftTaskId/);
});

test("a backend draft has a confirmed remove action", () => {
  assert.match(patientActivity, /Remove task/);
  assert.match(patientActivity, /Yes, remove task/);
});

test("authoritative tasks merge into activity for every Agentic-linked patient", () => {
  assert.match(wardRuntime, /mergeAuthoritativeThreads/);
  assert.match(wardRuntime, /authoritative.*current/s);
});
