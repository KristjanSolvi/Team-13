import assert from "node:assert/strict";
import { test } from "node:test";

import {
  seedSyntheticWard,
  syntheticWardPatients,
} from "../src/fixtures/ward.js";
import { openDatabase } from "../src/infra/database.js";
import { SqliteStore } from "../src/infra/store.js";

test("the synthetic ward seed makes every UI patient available to patient-scoped agents", () => {
  const store = new SqliteStore(openDatabase(":memory:"));
  const seededAt = "2026-08-21T07:00:00.000Z";

  seedSyntheticWard(store, seededAt);
  seedSyntheticWard(store, seededAt);

  assert.equal(
    store.getPatient("synthetic-karen")?.displayName,
    "Karen Jensen",
  );
  for (const patient of syntheticWardPatients) {
    assert.equal(
      store.getPatient(patient.patientId)?.displayName,
      patient.displayName,
    );
    assert.equal(
      store.listRecordItems(patient.patientId).length,
      patient.recordItems.length,
    );
  }
  assert.deepEqual(
    store.listRecordItems("demo-arthur").map((item) => item.sourceRef),
    [
      "record:pender-assessment-1",
      "record:pender-plan-1",
      "encounter:pender-ward-round-1",
    ],
  );
  assert.deepEqual(store.listTeams().find((team) => team.teamId === "ward-medical"), {
    teamId: "ward-medical",
    name: "Ward Medical Team",
    capabilities: ["medication-review"],
  });
  assert.deepEqual(
    store.listMembers("ward-medical").map((member) => member.memberId),
    ["ward-doctor-a", "ward-doctor-b"],
  );
  assert.deepEqual(store.listTeams().find((team) => team.teamId === "ward-nursing"), {
    teamId: "ward-nursing",
    name: "Ward Nursing Team",
    capabilities: ["ward-care"],
  });
  assert.deepEqual(
    store.listMembers("ward-nursing").map((member) => member.memberId),
    ["ward-nurse-a", "ward-nurse-b"],
  );
  store.close();
});

test("operational teams are added to an existing persistent ward seed", () => {
  const store = new SqliteStore(openDatabase(":memory:"));
  const seededAt = "2026-08-21T07:00:00.000Z";

  store.putPatient("synthetic-karen", "Karen Jensen", { synthetic: true });
  seedSyntheticWard(store, seededAt);

  assert.ok(store.listTeams().some((team) => team.teamId === "ward-medical"));
  assert.equal(store.listMembers("ward-medical").length, 2);
  store.close();
});

test("the synthetic seed preserves an existing operational team", () => {
  const store = new SqliteStore(openDatabase(":memory:"));
  store.putTeam({
    teamId: "ward-medical",
    name: "Existing Medical Team",
    capabilities: ["existing-capability"],
  });
  store.putMember({
    memberId: "existing-doctor",
    teamId: "ward-medical",
    capabilities: ["existing-capability"],
    onShift: true,
    available: true,
    openTaskCount: 0,
    capacity: 4,
    tieBreakKey: "existing",
  });

  seedSyntheticWard(store, "2026-08-21T07:00:00.000Z");

  assert.deepEqual(store.listTeams().find((team) => team.teamId === "ward-medical"), {
    teamId: "ward-medical",
    name: "Existing Medical Team",
    capabilities: ["existing-capability"],
  });
  assert.deepEqual(
    store.listMembers("ward-medical").map((member) => member.memberId),
    ["existing-doctor"],
  );
  store.close();
});
