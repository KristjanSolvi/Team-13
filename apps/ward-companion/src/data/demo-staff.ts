export type WardStaffOption = {
  name: string;
  role: string;
  team: string;
  free: boolean;
  fixture: "demo";
};

/**
 * Removable UI-only roster used when a live workforce directory is unavailable.
 * It carries no backend identity and is never sent as an authoritative staff record.
 */
export const demoStaff: WardStaffOption[] = [
  {
    name: "Nurse Kelly O.",
    role: "Bay A nurse",
    team: "Nursing team",
    free: true,
    fixture: "demo",
  },
  {
    name: "Nurse Ben Adeyemi",
    role: "Bay B nurse",
    team: "Nursing team",
    free: true,
    fixture: "demo",
  },
  {
    name: "Dr. Neve Halloran",
    role: "SHO",
    team: "Medical team",
    free: true,
    fixture: "demo",
  },
  {
    name: "Dr. Aris",
    role: "Registrar",
    team: "Medical team",
    free: false,
    fixture: "demo",
  },
  {
    name: "Amira Yusuf",
    role: "Senior physio",
    team: "Physio team",
    free: true,
    fixture: "demo",
  },
  {
    name: "Pharmacy",
    role: "Ward pharmacist",
    team: "Pharmacy",
    free: true,
    fixture: "demo",
  },
  {
    name: "Portering team",
    role: "Transport",
    team: "Portering",
    free: true,
    fixture: "demo",
  },
  {
    name: "Discharge coordinator",
    role: "Coordinator",
    team: "Discharge team",
    free: true,
    fixture: "demo",
  },
  {
    name: "District nurse rota",
    role: "Community nurse",
    team: "Community nursing",
    free: true,
    fixture: "demo",
  },
];

export const demoTeams = [...new Set(demoStaff.map((member) => member.team))];
