import type { PatientProfileData } from "./contracts.js";
import type { PatientProfileService } from "./service.js";
import type { PatientProfileStore } from "./store.js";

export const SYNTHETIC_KAREN_PATIENT_ID = "synthetic-karen";

export const syntheticKarenProfile: PatientProfileData = {
  displayName: "Karen Jensen",
  identifiers: {
    medicalRecordNumber: "MRN-SYN-KAREN",
    nationalHealthId: null,
  },
  demographics: {
    dateOfBirth: "1952-06-08",
    pronouns: "she/her",
  },
  location: {
    bed: "04",
    bay: "Bay A",
  },
  flow: {
    todaySchedule: "Medication and blood-pressure review",
    waitingFor: "District nursing follow-through plan",
    homeTomorrow: false,
  },
  contact: {
    phone: "+44 7700 900013",
    email: null,
    address: "13 Synthetic Street, Demo Town",
  },
  referralDetails: {
    preferredLanguage: "English",
    interpreterRequired: false,
    mobilityNeeds: null,
    transportNeeds: null,
    homeSupport: "Daughter can support after discharge",
    additionalDetails: "Synthetic hackathon patient; no real patient data.",
  },
};

export function seedSyntheticKarenProfile(
  service: PatientProfileService,
  store: PatientProfileStore,
): void {
  if (store.getProfile(SYNTHETIC_KAREN_PATIENT_ID) !== null) return;
  service.createProfile(
    SYNTHETIC_KAREN_PATIENT_ID,
    {
      idempotencyKey: "seed-synthetic-karen-profile-v1",
      profile: syntheticKarenProfile,
    },
    "system:demo-fixture",
  );
}
