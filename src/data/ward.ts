export type ThreadStatus = "pending" | "tracking" | "verified" | "escalated";

export type ActivityEntry = {
  id: string;
  at: string;
  actor: string;
  text: string;
  kind: "note" | "system" | "action";
};

export type Thread = {
  id: string;
  patientId: string;
  title: string;
  status: ThreadStatus;
  heard: string;
  matters: string;
  suggestion: string;
  assignee: string | null;
  candidates: { name: string; role: string; free: boolean }[];
  due: string;
  activity: ActivityEntry[];
};

export type Patient = {
  id: string;
  name: string;
  bed: string;
  bay: string;
  todaySchedule: string | null;
  waitingFor: string | null;
  homeTomorrow: boolean;
};

export type Bay = { id: string; name: string; beds: { bed: string; patientId: string | null }[] };

export const bays: Bay[] = [
  {
    id: "a",
    name: "Bay A — Respiratory",
    beds: [
      { bed: "04", patientId: "p1" },
      { bed: "05", patientId: "p2" },
      { bed: "06", patientId: "p3" },
    ],
  },
  {
    id: "b",
    name: "Bay B — Post-Op",
    beds: [
      { bed: "07", patientId: "p4" },
      { bed: "08", patientId: null },
      { bed: "09", patientId: "p5" },
    ],
  },
  {
    id: "c",
    name: "Bay C — General",
    beds: [
      { bed: "10", patientId: "p6" },
      { bed: "11", patientId: "p7" },
      { bed: "12", patientId: "p8" },
    ],
  },
];

export const patients: Patient[] = [
  {
    id: "p1",
    name: "Arthur M. Pender",
    bed: "04",
    bay: "Bay A",
    todaySchedule: "CT chest — 12:45",
    waitingFor: "Radiology slot confirmation",
    homeTomorrow: false,
  },
  {
    id: "p2",
    name: "Sarah Jenkins",
    bed: "05",
    bay: "Bay A",
    todaySchedule: null,
    waitingFor: null,
    homeTomorrow: true,
  },
  {
    id: "p3",
    name: "Robert Chen",
    bed: "06",
    bay: "Bay A",
    todaySchedule: "Physio review — 15:00",
    waitingFor: "Ortho team response",
    homeTomorrow: true,
  },
  {
    id: "p4",
    name: "Elena Rodriguez",
    bed: "07",
    bay: "Bay B",
    todaySchedule: "Wound dressing — 11:30",
    waitingFor: "Surgical review",
    homeTomorrow: false,
  },
  {
    id: "p5",
    name: "Samir Al-Fayed",
    bed: "09",
    bay: "Bay B",
    todaySchedule: null,
    waitingFor: null,
    homeTomorrow: false,
  },
  {
    id: "p6",
    name: "Grace Okonkwo",
    bed: "10",
    bay: "Bay C",
    todaySchedule: "Bloods — 09:00",
    waitingFor: "Potassium result",
    homeTomorrow: false,
  },
  {
    id: "p7",
    name: "Tomas Lindqvist",
    bed: "11",
    bay: "Bay C",
    todaySchedule: null,
    waitingFor: "Pharmacy TTOs",
    homeTomorrow: true,
  },
  {
    id: "p8",
    name: "Ivy Doherty",
    bed: "12",
    bay: "Bay C",
    todaySchedule: null,
    waitingFor: null,
    homeTomorrow: false,
  },
];

export const initialThreads: Thread[] = [
  {
    id: "t1",
    patientId: "p1",
    title: "CT chest scan",
    status: "tracking",
    heard: "\u201cLet's get a CT chest before the afternoon handover.\u201d",
    matters: "Discharge planning for tomorrow depends on this result being back and reviewed.",
    suggestion: "Confirm the 12:45 slot with radiology and arrange a porter.",
    assignee: "Portering team",
    candidates: [
      { name: "Nurse Kelly O.", role: "Bay A nurse", free: true },
      { name: "Portering team", role: "Transport", free: true },
      { name: "Dr. Aris", role: "Registrar", free: false },
    ],
    due: "Today 12:45",
    activity: [
      { id: "a1", at: "09:12", actor: "Ward round", text: "Heard during round and captured as a thread.", kind: "system" },
      { id: "a2", at: "10:15", actor: "Nurse Kelly O.", text: "\u201cPatient prepped and waiting in chair. Gown changed.\u201d", kind: "note" },
      { id: "a3", at: "11:02", actor: "Portering", text: "Acknowledged and en route at 12:30.", kind: "action" },
    ],
  },
  {
    id: "t2",
    patientId: "p1",
    title: "Shallow breathing overnight",
    status: "pending",
    heard: "\u201cHe was a bit short of breath around 3am, worth watching.\u201d",
    matters: "Needs a clinician's yes/no before it becomes a tracked observation plan.",
    suggestion: "Confirm whether hourly sats observations should be started.",
    assignee: null,
    candidates: [
      { name: "Dr. Aris", role: "Registrar", free: false },
      { name: "Dr. Neve Halloran", role: "SHO", free: true },
      { name: "Nurse Kelly O.", role: "Bay A nurse", free: true },
    ],
    due: "Today 12:00",
    activity: [
      { id: "a1", at: "07:40", actor: "Night handover", text: "Mentioned in verbal handover, no plan recorded yet.", kind: "system" },
    ],
  },
  {
    id: "t3",
    patientId: "p3",
    title: "Physio referral",
    status: "escalated",
    heard: "\u201cI'll put in a physio referral so she can go home safely.\u201d",
    matters: "Home tomorrow is planned; mobility assessment is the last open item.",
    suggestion: "Offer to the on-shift therapy team — two members are currently free.",
    assignee: null,
    candidates: [
      { name: "Therapy team", role: "Physio", free: true },
      { name: "Amira Yusuf", role: "Senior physio", free: true },
      { name: "Ortho team", role: "Surgical", free: false },
    ],
    due: "Yesterday 17:00",
    activity: [
      { id: "a1", at: "Yesterday 11:05", actor: "Ward round", text: "Referral promised during round.", kind: "system" },
      { id: "a2", at: "Yesterday 17:00", actor: "System", text: "Deadline passed — still open, surfacing to whoever is free.", kind: "system" },
    ],
  },
  {
    id: "t4",
    patientId: "p4",
    title: "Wound review before discharge",
    status: "tracking",
    heard: "\u201cSurgeons should eyeball the wound before we plan anything.\u201d",
    matters: "Keeps the discharge conversation honest — no plan until the wound is seen.",
    suggestion: "Add to the surgical afternoon list and note the dressing change at 11:30.",
    assignee: "Surgical SHO",
    candidates: [
      { name: "Surgical SHO", role: "Surgery", free: true },
      { name: "Nurse Ben Adeyemi", role: "Bay B nurse", free: true },
    ],
    due: "Today 16:00",
    activity: [
      { id: "a1", at: "08:50", actor: "Ward round", text: "Captured from conversation at the bedside.", kind: "system" },
      { id: "a2", at: "09:30", actor: "Nurse Ben Adeyemi", text: "Dressing change booked for 11:30.", kind: "note" },
    ],
  },
  {
    id: "t5",
    patientId: "p6",
    title: "Repeat potassium",
    status: "verified",
    heard: "\u201cRecheck her potassium after the infusion.\u201d",
    matters: "Result closes the loop on this morning's replacement.",
    suggestion: "Nothing outstanding — result seen and filed.",
    assignee: "Dr. Neve Halloran",
    candidates: [{ name: "Dr. Neve Halloran", role: "SHO", free: true }],
    due: "Today 09:00",
    activity: [
      { id: "a1", at: "07:20", actor: "Ward round", text: "Captured from conversation.", kind: "system" },
      { id: "a2", at: "09:44", actor: "Dr. Neve Halloran", text: "Result 4.1 — reviewed and verified.", kind: "action" },
    ],
  },
  {
    id: "t6",
    patientId: "p7",
    title: "TTO medications",
    status: "pending",
    heard: "\u201cHe can go home tomorrow once the tablets are ready.\u201d",
    matters: "Discharge tomorrow morning depends on pharmacy having the script today.",
    suggestion: "Confirm the discharge script has been written so pharmacy can start.",
    assignee: null,
    candidates: [
      { name: "Dr. Neve Halloran", role: "SHO", free: true },
      { name: "Pharmacy", role: "Ward pharmacist", free: true },
    ],
    due: "Today 17:00",
    activity: [
      { id: "a1", at: "10:05", actor: "Ward round", text: "Heard during round and captured as a thread.", kind: "system" },
    ],
  },
];

export const statusLabels: Record<ThreadStatus, string> = {
  pending: "Pending",
  tracking: "Tracking",
  verified: "Verified",
  escalated: "Escalated",
};

export const statusChipClass: Record<ThreadStatus, string> = {
  pending: "bg-pending-soft text-pending-strong",
  tracking: "bg-tracking-soft text-tracking-strong",
  verified: "bg-verified-soft text-verified-strong",
  escalated: "bg-escalated-soft text-escalated-strong",
};

export const statusDotClass: Record<ThreadStatus, string> = {
  pending: "bg-pending",
  tracking: "bg-tracking",
  verified: "bg-verified",
  escalated: "bg-escalated",
};

export const statusBorderClass: Record<ThreadStatus, string> = {
  pending: "border-pending",
  tracking: "border-tracking",
  verified: "border-verified",
  escalated: "border-escalated",
};
export type DocId = "ward-round" | "nursing" | "discharge";

export const documents: { id: DocId; title: string; subtitle: string }[] = [
  { id: "ward-round", title: "Ward round note", subtitle: "Dictated & agent-scribed" },
  { id: "nursing", title: "Nursing note", subtitle: "Care delivered this shift" },
  { id: "discharge", title: "Discharge summary", subtitle: "Draft — builds as things complete" },
];

export type CaseNote = {
  id: string;
  doc: DocId;
  at: string;
  author: string;
  source: "clinician" | "agent" | "scribe";
  text: string;
};

export const initialNotes: Record<string, CaseNote[]> = {
  p1: [
    {
      id: "n1",
      doc: "ward-round",
      at: "08:12",
      author: "Dr R. Duthagray",
      source: "clinician",
      text: "Ward round: improving on nebs, sats stable on air. Await CT chest before step-down.",
    },
    {
      id: "n1b",
      doc: "nursing",
      at: "07:40",
      author: "V. Kilfoy",
      source: "clinician",
      text: "Settled night. Nebs given as prescribed, no desaturation episodes recorded.",
    },
  ],
  p2: [
    {
      id: "n2",
      doc: "ward-round",
      at: "07:55",
      author: "V. Kilfoy",
      source: "clinician",
      text: "Comfortable overnight. TTOs requested, likely home tomorrow morning.",
    },
    {
      id: "n2b",
      doc: "discharge",
      at: "07:56",
      author: "Ward Threads agent",
      source: "agent",
      text: "Draft: planned discharge tomorrow. Outstanding for completion — TTOs to pharmacy, transport confirmation.",
    },
  ],
};

export type Staff = { name: string; role: string; free: boolean };

export const staff: Staff[] = [
  { name: "Dr. Neve Halloran", role: "SHO", free: true },
  { name: "Dr. Aris", role: "Registrar", free: false },
  { name: "Nurse Kelly O.", role: "Bay A nurse", free: true },
  { name: "Nurse Ben Adeyemi", role: "Bay B nurse", free: true },
  { name: "Amira Yusuf", role: "Senior physio", free: true },
  { name: "Pharmacy", role: "Ward pharmacist", free: true },
  { name: "Portering team", role: "Transport", free: true },
  { name: "Surgical SHO", role: "Surgery", free: false },
];
