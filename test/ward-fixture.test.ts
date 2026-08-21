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
  store.close();
});
