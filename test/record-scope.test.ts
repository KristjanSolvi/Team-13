import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { DomainError } from "../src/domain/errors.js";
import type { Member, Team, Thread } from "../src/domain/types.js";
import { seedKaren } from "../src/fixtures/karen.js";
import { openDatabase } from "../src/infra/database.js";
import { SqliteStore } from "../src/infra/store.js";
import { RecordService } from "../src/services/record-service.js";

const NOW = "2026-08-20T10:00:00.000Z";
const CONTEXT_ID = "ctx-karen";
const INTERACTION_ID = "interaction-karen-1";
const PATIENT_ID = "synthetic-karen";

function harness(t: TestContext) {
  const store = new SqliteStore(openDatabase(":memory:"));
  t.after(() => store.close());
  seedKaren(store, NOW);
  store.putContextMapping(CONTEXT_ID, INTERACTION_ID, PATIENT_ID, NOW);
  return { store, records: new RecordService(store) };
}

function assertDomainError(
  operation: () => unknown,
  code: string,
  status: number,
  retryable: boolean,
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
  assert.equal(caught.retryable, retryable);
}

test("Karen context returns the exact patient and deterministic record items", (t) => {
  const { records } = harness(t);
  const result = records.getPatientContext(CONTEXT_ID, PATIENT_ID);

  assert.equal(result.patientId, PATIENT_ID);
  assert.equal(result.displayName, "Karen Jensen");
  assert.deepEqual(
    result.recordItems.map((item) => item.sourceRef),
    ["record:medication-1", "encounter:sentence-42"],
  );
  assert.doesNotThrow(() =>
    records.requireInteraction(CONTEXT_ID, INTERACTION_ID),
  );
});

test("wrong patient, missing context, and wrong interaction all deny without leaking scope", (t) => {
  const { records } = harness(t);
  assertDomainError(
    () => records.getPatientContext(CONTEXT_ID, "synthetic-other"),
    "PATIENT_SCOPE_DENIED",
    403,
    false,
  );
  assertDomainError(
    () => records.getPatientContext("ctx-missing", PATIENT_ID),
    "PATIENT_SCOPE_DENIED",
    403,
    false,
  );
  assertDomainError(
    () => records.requireInteraction(CONTEXT_ID, "interaction-other"),
    "CONTEXT_INTERACTION_MISMATCH",
    403,
    false,
  );
  assertDomainError(
    () => records.requireInteraction("ctx-other", INTERACTION_ID),
    "CONTEXT_INTERACTION_MISMATCH",
    403,
    false,
  );
});

test("a valid mapping with an unavailable patient is retryable and never becomes empty data", (t) => {
  class UnavailablePatientStore extends SqliteStore {
    override getPatient(_patientId: string): null {
      return null;
    }
  }

  const store = new UnavailablePatientStore(openDatabase(":memory:"));
  t.after(() => store.close());
  seedKaren(store, NOW);
  store.putContextMapping(CONTEXT_ID, INTERACTION_ID, PATIENT_ID, NOW);
  const records = new RecordService(store);

  assertDomainError(
    () => records.getPatientContext(CONTEXT_ID, PATIENT_ID),
    "RECORD_LOOKUP_FAILED",
    503,
    true,
  );
});

test("open threads are patient scoped and exclude verified and dismissed threads", (t) => {
  const { store, records } = harness(t);
  const base: Thread = {
    threadId: "thread-open",
    patientId: PATIENT_ID,
    interactionId: INTERACTION_ID,
    contextId: CONTEXT_ID,
    summary: "Open follow-through",
    evidenceRefs: ["encounter:sentence-42"],
    state: "tracking",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
  store.putThread(base);
  store.putThread({ ...base, threadId: "thread-verified", state: "verified" });
  store.putThread({
    ...base,
    threadId: "thread-dismissed",
    state: "dismissed",
  });

  assert.deepEqual(
    records
      .listOpenThreads(CONTEXT_ID, PATIENT_ID)
      .map((thread) => thread.threadId),
    ["thread-open"],
  );
  assertDomainError(
    () => records.listOpenThreads("ctx-missing", PATIENT_ID),
    "PATIENT_SCOPE_DENIED",
    403,
    false,
  );
});

test("eligible teams require every capability and report exact availability", (t) => {
  const { store, records } = harness(t);
  const mobileTeam: Team = {
    teamId: "mobile-clinical",
    name: "Mobile Clinical",
    capabilities: ["blood-pressure", "home-visit"],
  };
  const adminTeam: Team = {
    teamId: "admin",
    name: "Administration",
    capabilities: ["scheduling"],
  };
  store.putTeam(mobileTeam);
  store.putTeam(adminTeam);
  const members: Member[] = [
    {
      memberId: "mobile-available",
      teamId: mobileTeam.teamId,
      capabilities: [...mobileTeam.capabilities],
      onShift: true,
      available: true,
      openTaskCount: 0,
      capacity: 2,
      tieBreakKey: "a",
    },
    {
      memberId: "mobile-full",
      teamId: mobileTeam.teamId,
      capabilities: [...mobileTeam.capabilities],
      onShift: true,
      available: true,
      openTaskCount: 2,
      capacity: 2,
      tieBreakKey: "b",
    },
    {
      memberId: "mobile-off-shift",
      teamId: mobileTeam.teamId,
      capabilities: [...mobileTeam.capabilities],
      onShift: false,
      available: true,
      openTaskCount: 0,
      capacity: 2,
      tieBreakKey: "c",
    },
    {
      memberId: "audience:demo-participant",
      teamId: mobileTeam.teamId,
      capabilities: [...mobileTeam.capabilities],
      onShift: true,
      available: true,
      openTaskCount: 0,
      capacity: 2,
      tieBreakKey: "0",
    },
  ];
  for (const member of members) store.putMember(member);

  assert.deepEqual(
    records.listEligibleTeams(CONTEXT_ID, PATIENT_ID, [
      "blood-pressure",
      "home-visit",
    ]),
    [
      {
        ...mobileTeam,
        availability: { onShift: 2, availableWithCapacity: 1 },
      },
    ],
  );
  assert.deepEqual(
    records
      .listEligibleTeams(CONTEXT_ID, PATIENT_ID, ["blood-pressure"])
      .map((team) => ({
        teamId: team.teamId,
        availability: team.availability,
      })),
    [
      {
        teamId: "district-nursing",
        availability: { onShift: 2, availableWithCapacity: 2 },
      },
      {
        teamId: "mobile-clinical",
        availability: { onShift: 2, availableWithCapacity: 1 },
      },
    ],
  );
});

test("record reads never append raw patient data to audit events", (t) => {
  const { store, records } = harness(t);
  const before = store.listEvents(0);
  const context = records.getPatientContext(CONTEXT_ID, PATIENT_ID);
  records.listOpenThreads(CONTEXT_ID, PATIENT_ID);
  records.listEligibleTeams(CONTEXT_ID, PATIENT_ID, ["blood-pressure"]);
  const after = store.listEvents(0);

  assert.equal(context.recordItems.length, 2);
  assert.deepEqual(after, before);
  const serializedEvents = JSON.stringify(after);
  assert.equal(serializedEvents.includes("Amlodipine changed"), false);
  assert.equal(
    serializedEvents.includes("Dizziness since medication change"),
    false,
  );
});

test("context event helper also denies an unknown mapping", (t) => {
  const { store } = harness(t);
  assertDomainError(
    () => store.appendContextEvent("ctx-missing", "record.checked", {}),
    "PATIENT_SCOPE_DENIED",
    403,
    false,
  );
});
