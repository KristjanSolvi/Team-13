import type { Member, Team } from "../domain/types.js";
import type { SqliteStore } from "../infra/store.js";

export const KAREN_PATIENT_ID = "synthetic-karen";
export const DISTRICT_NURSING_TEAM_ID = "district-nursing";

const districtNursing: Team = {
  teamId: DISTRICT_NURSING_TEAM_ID,
  name: "District Nursing",
  capabilities: ["blood-pressure"],
};

const members: Member[] = [
  {
    memberId: "nurse-a",
    teamId: DISTRICT_NURSING_TEAM_ID,
    capabilities: ["blood-pressure"],
    onShift: true,
    available: true,
    openTaskCount: 1,
    capacity: 4,
    tieBreakKey: "a",
  },
  {
    memberId: "nurse-b",
    teamId: DISTRICT_NURSING_TEAM_ID,
    capabilities: ["blood-pressure"],
    onShift: true,
    available: true,
    openTaskCount: 2,
    capacity: 4,
    tieBreakKey: "b",
  },
];

export function seedKaren(store: SqliteStore, now: string): void {
  store.transaction(() => {
    store.putPatient(KAREN_PATIENT_ID, "Karen Jensen", {
      synthetic: true,
      bed: "5",
      bay: "Bay B",
      followThroughOwner: null,
    });
    store.putRecordItem({
      itemId: "karen-medication-change",
      patientId: KAREN_PATIENT_ID,
      itemType: "medication",
      text: "Amlodipine changed",
      sourceRef: "record:medication-1",
      recordedAt: "2026-08-18T09:00:00.000Z",
    });
    store.putRecordItem({
      itemId: "karen-dizziness-signal",
      patientId: KAREN_PATIENT_ID,
      itemType: "observation",
      text: "Dizziness since medication change",
      sourceRef: "encounter:sentence-42",
      recordedAt: "2026-08-20T09:55:00.000Z",
    });
    store.putTeam(districtNursing);
    for (const member of members) {
      store.putMember(member);
    }
    store.appendEvent({
      eventType: "fixture.seeded",
      occurredAt: now,
      correlationId: "seed-karen",
      patientId: KAREN_PATIENT_ID,
      interactionId: "interaction-karen-1",
      contextId: null,
      actor: { type: "system", id: "fixture-loader" },
      payload: { teamId: DISTRICT_NURSING_TEAM_ID },
    });
  });
}
