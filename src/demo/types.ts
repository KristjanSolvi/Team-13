export const demoScenarios = [
  "meeting",
  "discharge_coordination",
  "ward_consultation",
] as const;

export type DemoScenario = (typeof demoScenarios)[number];
export type DemoGroupSize = 1 | 2;

export interface DemoSession {
  sessionId: string;
  joinCode: string;
  title: string;
  scenario: DemoScenario;
  groupSize: DemoGroupSize;
  targetTeamId: string;
  createdBy: string;
  createdAt: string;
}

export interface DemoParticipant {
  participantId: string;
  sessionId: string;
  groupId: string;
  displayName: string;
  memberId: string;
  joinKey: string;
  tokenHash: string;
  joinedAt: string;
}

export interface DemoAssignment {
  assignmentId: string;
  sessionId: string;
  groupId: string;
  participantId: string;
  taskId: string;
  assignedBy: string;
  assignedAt: string;
}
