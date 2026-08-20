export type ClinicalUrgency = "high" | "medium" | "routine";

export type TaskOrigin = "agent_suggested" | "clinician_created";

export type TaskState =
  | "draft"
  | "offered_to_team"
  | "assigned_to_member"
  | "accepted"
  | "completed"
  | "verified"
  | "escalated"
  | "dismissed";

export type ThreadState =
  | "awaiting_review"
  | "tracking"
  | "verified"
  | "escalated"
  | "dismissed";

export interface PriorityBreakdown {
  base: number;
  deadlinePressure: number;
  overdue: number;
  failedOffers: number;
  total: number;
  activeTargetAt: string;
}

export interface Task {
  taskId: string;
  threadId: string;
  patientId: string;
  origin: TaskOrigin;
  summary: string;
  taskType: string;
  evidenceRefs: string[];
  targetTeamId: string;
  requiredCapabilities: string[];
  clinicalUrgency: ClinicalUrgency;
  operationalPriorityScore: number;
  priorityBreakdown: PriorityBreakdown;
  acceptBy: string;
  dueBy: string;
  state: TaskState;
  assignedMemberId: string | null;
  failedOffers: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Thread {
  threadId: string;
  patientId: string;
  interactionId: string;
  contextId: string | null;
  summary: string;
  evidenceRefs: string[];
  state: ThreadState;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Team {
  teamId: string;
  name: string;
  capabilities: string[];
}

export interface Member {
  memberId: string;
  teamId: string;
  capabilities: string[];
  onShift: boolean;
  available: boolean;
  openTaskCount: number;
  capacity: number;
  tieBreakKey: string;
}

export interface Actor {
  type: "agent" | "clinician" | "team_member" | "router" | "system";
  id: string;
}

export interface DomainEvent<T = Record<string, unknown>> {
  schemaVersion: "1";
  eventId: string;
  eventType: string;
  occurredAt: string;
  correlationId: string;
  patientId: string;
  interactionId: string;
  contextId: string | null;
  actor: Actor;
  payload: T;
}
