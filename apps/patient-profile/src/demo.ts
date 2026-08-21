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

type WardProfileFixture = {
  patientId: string;
  profile: PatientProfileData;
};

function wardProfile(input: {
  displayName: string;
  medicalRecordNumber: string;
  bed: string;
  bay: string;
  todaySchedule: string | null;
  waitingFor: string | null;
  homeTomorrow: boolean;
}): PatientProfileData {
  return {
    displayName: input.displayName,
    identifiers: {
      medicalRecordNumber: input.medicalRecordNumber,
      nationalHealthId: null,
    },
    demographics: { dateOfBirth: null, pronouns: null },
    location: { bed: input.bed, bay: input.bay },
    flow: {
      todaySchedule: input.todaySchedule,
      waitingFor: input.waitingFor,
      homeTomorrow: input.homeTomorrow,
    },
    contact: { phone: null, email: null, address: null },
    referralDetails: {
      preferredLanguage: "English",
      interpreterRequired: false,
      mobilityNeeds: null,
      transportNeeds: null,
      homeSupport: null,
      additionalDetails: "Synthetic hackathon patient; no real patient data.",
    },
  };
}

export const syntheticWardProfiles: readonly WardProfileFixture[] = [
  {
    patientId: "demo-arthur",
    profile: wardProfile({
      displayName: "Arthur M. Pender",
      medicalRecordNumber: "MRN-DEMO-ARTHUR",
      bed: "04",
      bay: "Bay A",
      todaySchedule: "CT chest — 12:45",
      waitingFor: "Radiology slot confirmation",
      homeTomorrow: false,
    }),
  },
  {
    patientId: "synthetic-sarah",
    profile: wardProfile({
      displayName: "Sarah Jenkins",
      medicalRecordNumber: "MRN-SYN-SARAH",
      bed: "05",
      bay: "Bay A",
      todaySchedule: null,
      waitingFor: null,
      homeTomorrow: true,
    }),
  },
  {
    patientId: "synthetic-ib",
    profile: wardProfile({
      displayName: "Robert Chen",
      medicalRecordNumber: "MRN-SYN-ROBERT",
      bed: "06",
      bay: "Bay A",
      todaySchedule: "Physio review — 15:00",
      waitingFor: "Ortho team response",
      homeTomorrow: true,
    }),
  },
  {
    patientId: "synthetic-elena",
    profile: wardProfile({
      displayName: "Elena Rodriguez",
      medicalRecordNumber: "MRN-SYN-ELENA",
      bed: "07",
      bay: "Bay B",
      todaySchedule: "Wound dressing — 11:30",
      waitingFor: "Surgical review",
      homeTomorrow: false,
    }),
  },
  {
    patientId: "synthetic-samir",
    profile: wardProfile({
      displayName: "Samir Al-Fayed",
      medicalRecordNumber: "MRN-SYN-SAMIR",
      bed: "09",
      bay: "Bay B",
      todaySchedule: null,
      waitingFor: null,
      homeTomorrow: false,
    }),
  },
  {
    patientId: "synthetic-grace",
    profile: wardProfile({
      displayName: "Grace Okonkwo",
      medicalRecordNumber: "MRN-SYN-GRACE",
      bed: "10",
      bay: "Bay C",
      todaySchedule: "Bloods — 09:00",
      waitingFor: "Potassium result",
      homeTomorrow: false,
    }),
  },
  {
    patientId: "synthetic-tomas",
    profile: wardProfile({
      displayName: "Tomas Lindqvist",
      medicalRecordNumber: "MRN-SYN-TOMAS",
      bed: "11",
      bay: "Bay C",
      todaySchedule: null,
      waitingFor: "Pharmacy TTOs",
      homeTomorrow: true,
    }),
  },
  {
    patientId: "synthetic-ivy",
    profile: wardProfile({
      displayName: "Ivy Doherty",
      medicalRecordNumber: "MRN-SYN-IVY",
      bed: "12",
      bay: "Bay C",
      todaySchedule: null,
      waitingFor: null,
      homeTomorrow: false,
    }),
  },
] as const;

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

/** Seed every patient identity displayed by the synthetic ward shell. */
export function seedSyntheticWardProfiles(
  service: PatientProfileService,
  store: PatientProfileStore,
): void {
  seedSyntheticKarenProfile(service, store);
  for (const fixture of syntheticWardProfiles) {
    if (store.getProfile(fixture.patientId) !== null) continue;
    service.createProfile(
      fixture.patientId,
      {
        idempotencyKey: `seed-${fixture.patientId}-profile-v1`,
        profile: fixture.profile,
      },
      "system:demo-fixture",
    );
  }
}
