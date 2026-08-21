import { demoThreads } from "./demo-threads";

export type ThreadStatus = "pending" | "tracking" | "verified" | "escalated";
export type Urgency = "routine" | "soon" | "urgent";
export type OfferState = "none" | "offered" | "accepted";

export type NewTaskOptions = {
  team?: string | null;
  urgency?: Urgency;
  due?: string;
  detail?: string;
  source?: "scribe" | "manual" | "agent";
};

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
  team?: string | null;
  urgency?: Urgency;
  detail?: string | null;
  offerState?: OfferState;
  offeredTo?: string | null;
  source?: "scribe" | "manual" | "agent";
  fixture?: "demo";
  backend?: {
    threadId: string;
    taskId: string | null;
    threadVersion: number;
    taskVersion: number | null;
    threadState: "awaiting_review" | "tracking" | "verified" | "escalated" | "dismissed";
    taskState:
      | "draft"
      | "offered_to_team"
      | "assigned_to_member"
      | "accepted"
      | "completed"
      | "verified"
      | "escalated"
      | "dismissed"
      | null;
    targetTeamId: string | null;
    evidenceRefs: string[];
    availableCommands: Array<
      "approve" | "correct" | "dismiss" | "reopen" | "accept" | "decline" | "complete" | "verify"
    >;
  };
};

export type Patient = {
  id: string;
  pipelinePatientId: string;
  /** Authoritative task ledger replaces local task fixtures for this patient. */
  backendLinked?: boolean;
  /** Patient exists in the patient-scoped Agentic/MCP record store. */
  agenticLinked?: boolean;
  /** Patient has an authoritative profile and document store. */
  ehrLinked?: boolean;
  name: string;
  bed: string;
  bay: string;
  todaySchedule: string | null;
  waitingFor: string | null;
  homeTomorrow: boolean;
};

export type Bay = { id: string; name: string; beds: { bed: string; patientId: string | null }[] };
export type WardBedAssignments = Record<string, string | null>;

export type AuthoritativeSyncState = "idle" | "syncing" | "ready" | "unavailable";

export const bays: Bay[] = [
  {
    id: "a",
    name: "Bay A",
    beds: [
      { bed: "04", patientId: "p1" },
      { bed: "05", patientId: "p2" },
      { bed: "06", patientId: "p3" },
    ],
  },
  {
    id: "b",
    name: "Bay B",
    beds: [
      { bed: "07", patientId: "p4" },
      { bed: "08", patientId: "p9" },
      { bed: "09", patientId: "p5" },
    ],
  },
  {
    id: "c",
    name: "Bay C",
    beds: [
      { bed: "10", patientId: "p6" },
      { bed: "11", patientId: "p7" },
      { bed: "12", patientId: "p8" },
      { bed: "13", patientId: null },
    ],
  },
];

export const patients: Patient[] = [
  {
    id: "p1",
    pipelinePatientId: "demo-arthur",
    agenticLinked: true,
    ehrLinked: true,
    name: "Arthur M. Pender",
    bed: "04",
    bay: "Bay A",
    todaySchedule: "CT chest — 12:45",
    waitingFor: "Radiology slot confirmation",
    homeTomorrow: false,
  },
  {
    id: "p2",
    pipelinePatientId: "synthetic-sarah",
    agenticLinked: true,
    ehrLinked: true,
    name: "Sarah Jenkins",
    bed: "05",
    bay: "Bay A",
    todaySchedule: null,
    waitingFor: null,
    homeTomorrow: true,
  },
  {
    id: "p3",
    pipelinePatientId: "synthetic-ib",
    agenticLinked: true,
    ehrLinked: true,
    name: "Robert Chen",
    bed: "06",
    bay: "Bay A",
    todaySchedule: "Physio review — 15:00",
    waitingFor: "Ortho team response",
    homeTomorrow: true,
  },
  {
    id: "p4",
    pipelinePatientId: "synthetic-elena",
    agenticLinked: true,
    ehrLinked: true,
    name: "Elena Rodriguez",
    bed: "07",
    bay: "Bay B",
    todaySchedule: "Wound dressing — 11:30",
    waitingFor: "Surgical review",
    homeTomorrow: false,
  },
  {
    id: "p9",
    pipelinePatientId: "synthetic-karen",
    backendLinked: true,
    agenticLinked: true,
    ehrLinked: true,
    name: "Karen Jensen",
    bed: "08",
    bay: "Bay B",
    todaySchedule: "Discharge planning — 14:00",
    waitingFor: "Medication and blood pressure review",
    homeTomorrow: true,
  },
  {
    id: "p5",
    pipelinePatientId: "synthetic-samir",
    agenticLinked: true,
    ehrLinked: true,
    name: "Samir Al-Fayed",
    bed: "09",
    bay: "Bay B",
    todaySchedule: null,
    waitingFor: null,
    homeTomorrow: false,
  },
  {
    id: "p6",
    pipelinePatientId: "synthetic-grace",
    agenticLinked: true,
    ehrLinked: true,
    name: "Grace Okonkwo",
    bed: "10",
    bay: "Bay C",
    todaySchedule: "Bloods — 09:00",
    waitingFor: "Potassium result",
    homeTomorrow: false,
  },
  {
    id: "p7",
    pipelinePatientId: "synthetic-tomas",
    agenticLinked: true,
    ehrLinked: true,
    name: "Tomas Lindqvist",
    bed: "11",
    bay: "Bay C",
    todaySchedule: null,
    waitingFor: "Pharmacy TTOs",
    homeTomorrow: true,
  },
  {
    id: "p8",
    pipelinePatientId: "synthetic-ivy",
    agenticLinked: true,
    ehrLinked: true,
    name: "Ivy Doherty",
    bed: "12",
    bay: "Bay C",
    todaySchedule: null,
    waitingFor: null,
    homeTomorrow: false,
  },
];

export const initialThreads: Thread[] = demoThreads;

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

export const urgencyLabels: Record<Urgency, string> = {
  routine: "Routine",
  soon: "Soon",
  urgent: "Urgent",
};
export type DocId = "medical" | "discharge";

export const documents: { id: DocId; title: string; subtitle: string }[] = [
  { id: "medical", title: "Medical notes", subtitle: "Dictated & agent-scribed" },
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
      doc: "medical",
      at: "08:12",
      author: "Dr R. Duthagray",
      source: "clinician",
      text: "Ward round: improving on nebs, sats stable on air. Await CT chest before step-down.",
    },
    {
      id: "n1b",
      doc: "medical",
      at: "07:40",
      author: "V. Kilfoy",
      source: "clinician",
      text: "Settled night. Nebs given as prescribed, no desaturation episodes recorded.",
    },
  ],
  p2: [
    {
      id: "n2",
      doc: "medical",
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

initialNotes["p3"] = [
  {
    id: "n3",
    doc: "medical",
    at: "08:30",
    author: "Dr. Aris",
    source: "scribe",
    text: "Plan: physio review this afternoon to confirm safe mobility, then home tomorrow if independent on stairs.",
  },
];
initialNotes["p4"] = [
  {
    id: "n4",
    doc: "medical",
    at: "08:50",
    author: "Surgical SHO",
    source: "scribe",
    text: "Plan: dressing change at 11:30, surgical wound review this afternoon before any discharge planning.",
  },
];
initialNotes["p9"] = [
  {
    id: "n9",
    doc: "medical",
    at: "09:32",
    author: "Ambient scribe",
    source: "scribe",
    text: "Discharge planning discussed. Karen reports dizziness since her medication changed; ownership of the blood pressure follow-up is not yet clear.",
  },
];
initialNotes["p5"] = [
  {
    id: "n5",
    doc: "medical",
    at: "08:05",
    author: "Dr. Neve Halloran",
    source: "scribe",
    text: "Plan: continue current analgesia, mobilise with nursing staff, review again tomorrow morning.",
  },
];
initialNotes["p6"] = [
  {
    id: "n6",
    doc: "medical",
    at: "07:20",
    author: "Dr. Neve Halloran",
    source: "scribe",
    text: "Plan: repeat potassium after infusion, recheck bloods tomorrow if stable.",
  },
];
initialNotes["p7"] = [
  {
    id: "n7",
    doc: "medical",
    at: "09:10",
    author: "V. Kilfoy",
    source: "scribe",
    text: "Plan: discharge script to pharmacy today, home tomorrow once TTOs dispensed.",
  },
];
initialNotes["p8"] = [
  {
    id: "n8",
    doc: "medical",
    at: "08:40",
    author: "Dr. Yuki T.",
    source: "scribe",
    text: "Plan: observe for a further 24 hours, no active issues, reassess on tomorrow's round.",
  },
];
