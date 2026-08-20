import type { PatientProfileData } from "../src/contracts.js";

export const profile: PatientProfileData = {
  displayName: "Arthur M. Pender",
  identifiers: {
    medicalRecordNumber: "MRN-004",
    nationalHealthId: null,
  },
  demographics: {
    dateOfBirth: "1954-03-14",
    pronouns: "he/him",
  },
  location: {
    bed: "04",
    bay: "Bay A",
  },
  flow: {
    todaySchedule: "CT chest — 12:45",
    waitingFor: "Radiology slot confirmation",
    homeTomorrow: false,
  },
  contact: {
    phone: "+44 7700 900004",
    email: null,
    address: "4 Synthetic Street, Demo Town",
  },
  referralDetails: {
    preferredLanguage: "English",
    interpreterRequired: false,
    mobilityNeeds: "Uses a walking stick outdoors",
    transportNeeds: null,
    homeSupport: "Lives with partner",
    additionalDetails: null,
  },
};
