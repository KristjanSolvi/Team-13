import type { SqliteStore } from "../infra/store.js";
import { KAREN_PATIENT_ID, seedKaren } from "./karen.js";

const wardOperationalTeams = [
  {
    team: {
      teamId: "ward-medical",
      name: "Ward Medical Team",
      capabilities: ["medication-review"],
    },
    members: [
      {
        memberId: "ward-doctor-a",
        teamId: "ward-medical",
        capabilities: ["medication-review"],
        onShift: true,
        available: true,
        openTaskCount: 0,
        capacity: 6,
        tieBreakKey: "a",
      },
      {
        memberId: "ward-doctor-b",
        teamId: "ward-medical",
        capabilities: ["medication-review"],
        onShift: true,
        available: true,
        openTaskCount: 1,
        capacity: 6,
        tieBreakKey: "b",
      },
    ],
  },
  {
    team: {
      teamId: "ward-nursing",
      name: "Ward Nursing Team",
      capabilities: ["ward-care"],
    },
    members: [
      {
        memberId: "ward-nurse-a",
        teamId: "ward-nursing",
        capabilities: ["ward-care"],
        onShift: true,
        available: true,
        openTaskCount: 1,
        capacity: 8,
        tieBreakKey: "a",
      },
      {
        memberId: "ward-nurse-b",
        teamId: "ward-nursing",
        capabilities: ["ward-care"],
        onShift: true,
        available: true,
        openTaskCount: 2,
        capacity: 8,
        tieBreakKey: "b",
      },
    ],
  },
] as const;

function seedWardOperationalTeams(store: SqliteStore): void {
  for (const { team, members } of wardOperationalTeams) {
    const existingTeam = store
      .listTeams()
      .find((candidate) => candidate.teamId === team.teamId);
    if (existingTeam === undefined) {
      store.putTeam({ ...team, capabilities: [...team.capabilities] });
    } else if (
      existingTeam.name !== team.name ||
      existingTeam.capabilities.length !== team.capabilities.length ||
      !team.capabilities.every((capability) =>
        existingTeam.capabilities.includes(capability),
      )
    ) {
      continue;
    }
    const existingMemberIds = new Set(
      store.listMembers(team.teamId).map((member) => member.memberId),
    );
    for (const member of members) {
      if (existingMemberIds.has(member.memberId)) continue;
      store.putMember({ ...member, capabilities: [...member.capabilities] });
    }
  }
}

type WardPatientFixture = {
  patientId: string;
  displayName: string;
  bed: string;
  bay: string;
  recordItems: Array<{
    itemId: string;
    itemType: string;
    text: string;
    sourceRef: string;
    recordedAt: string;
  }>;
};

/**
 * Synthetic patients shown in the Nervecentre shell. These records give the
 * patient-scoped Agentic tools real, evidence-addressable context without
 * pretending the Lovable task fixtures are authoritative ledger entries.
 */
export const syntheticWardPatients: readonly WardPatientFixture[] = [
  {
    patientId: "demo-arthur",
    displayName: "Arthur M. Pender",
    bed: "1",
    bay: "Bay A",
    recordItems: [
      {
        itemId: "pender-current-assessment",
        itemType: "clinical-note",
        text: "Infective COPD exacerbation is improving on nebulised treatment; oxygen saturations are stable on air.",
        sourceRef: "record:pender-assessment-1",
        recordedAt: "2026-08-21T06:12:00.000Z",
      },
      {
        itemId: "pender-current-plan",
        itemType: "plan",
        text: "CT chest is awaited before step-down; radiology offered a 12:45 slot if portering is available.",
        sourceRef: "record:pender-plan-1",
        recordedAt: "2026-08-21T06:15:00.000Z",
      },
      {
        itemId: "pender-symptom-update",
        itemType: "observation",
        text: "Right-sided chest discomfort radiates towards the shoulder on inspiration.",
        sourceRef: "encounter:pender-ward-round-1",
        recordedAt: "2026-08-21T06:16:00.000Z",
      },
    ],
  },
  {
    patientId: "synthetic-sarah",
    displayName: "Sarah Jenkins",
    bed: "2",
    bay: "Bay A",
    recordItems: [
      {
        itemId: "sarah-flow-plan",
        itemType: "plan",
        text: "No current ward blocker is recorded and discharge is planned for tomorrow.",
        sourceRef: "record:sarah-flow-1",
        recordedAt: "2026-08-21T06:20:00.000Z",
      },
    ],
  },
  {
    patientId: "synthetic-ib",
    displayName: "Robert Chen",
    bed: "3",
    bay: "Bay A",
    recordItems: [
      {
        itemId: "robert-physio-plan",
        itemType: "plan",
        text: "Physiotherapy review is scheduled for 15:00 and the orthopaedic team response is awaited.",
        sourceRef: "record:robert-plan-1",
        recordedAt: "2026-08-21T06:22:00.000Z",
      },
    ],
  },
  {
    patientId: "synthetic-elena",
    displayName: "Elena Rodriguez",
    bed: "4",
    bay: "Bay B",
    recordItems: [
      {
        itemId: "elena-wound-plan",
        itemType: "plan",
        text: "Wound dressing is scheduled for 11:30 and surgical review remains awaited.",
        sourceRef: "record:elena-plan-1",
        recordedAt: "2026-08-21T06:24:00.000Z",
      },
    ],
  },
  {
    patientId: "synthetic-samir",
    displayName: "Samir Al-Fayed",
    bed: "6",
    bay: "Bay B",
    recordItems: [
      {
        itemId: "samir-current-status",
        itemType: "clinical-note",
        text: "The current ward record contains no newly documented follow-through blocker.",
        sourceRef: "record:samir-status-1",
        recordedAt: "2026-08-21T06:26:00.000Z",
      },
    ],
  },
  {
    patientId: "synthetic-grace",
    displayName: "Grace Okonkwo",
    bed: "7",
    bay: "Bay C",
    recordItems: [
      {
        itemId: "grace-blood-plan",
        itemType: "plan",
        text: "Blood sampling is scheduled for 09:00 and the potassium result is awaited.",
        sourceRef: "record:grace-plan-1",
        recordedAt: "2026-08-21T06:28:00.000Z",
      },
    ],
  },
  {
    patientId: "synthetic-tomas",
    displayName: "Tomas Lindqvist",
    bed: "8",
    bay: "Bay C",
    recordItems: [
      {
        itemId: "tomas-discharge-plan",
        itemType: "plan",
        text: "Discharge is planned for tomorrow and pharmacy discharge medicines are awaited.",
        sourceRef: "record:tomas-plan-1",
        recordedAt: "2026-08-21T06:30:00.000Z",
      },
    ],
  },
  {
    patientId: "synthetic-ivy",
    displayName: "Ivy Doherty",
    bed: "9",
    bay: "Bay C",
    recordItems: [
      {
        itemId: "ivy-current-status",
        itemType: "clinical-note",
        text: "The current ward record contains no newly documented follow-through blocker.",
        sourceRef: "record:ivy-status-1",
        recordedAt: "2026-08-21T06:32:00.000Z",
      },
    ],
  },
] as const;

/** Seed every synthetic ward identity exactly once, including Karen. */
export function seedSyntheticWard(store: SqliteStore, now: string): void {
  seedWardOperationalTeams(store);
  if (!store.getPatient(KAREN_PATIENT_ID)) {
    seedKaren(store, now);
  }

  for (const patient of syntheticWardPatients) {
    if (store.getPatient(patient.patientId)) continue;
    store.transaction(() => {
      store.putPatient(patient.patientId, patient.displayName, {
        synthetic: true,
        bed: patient.bed,
        bay: patient.bay,
        followThroughOwner: null,
      });
      for (const item of patient.recordItems) {
        store.putRecordItem({ ...item, patientId: patient.patientId });
      }
      store.appendEvent({
        eventType: "fixture.seeded",
        occurredAt: now,
        correlationId: `seed-${patient.patientId}`,
        patientId: patient.patientId,
        interactionId: `fixture:${patient.patientId}`,
        contextId: null,
        actor: { type: "system", id: "fixture-loader" },
        payload: { recordItemCount: patient.recordItems.length },
      });
    });
  }
}
