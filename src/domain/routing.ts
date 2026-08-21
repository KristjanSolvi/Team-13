import type { Member, Task } from "./types.js";

export const routingPolicyVersion = "availability-capability-load-v1" as const;

export type RoutingExclusionReason =
  | "wrong_team"
  | "off_shift"
  | "unavailable"
  | "at_capacity"
  | "missing_capability";

export interface RoutingCandidateEvaluation {
  memberId: string;
  teamId: string;
  eligible: boolean;
  rank: number | null;
  openTaskCount: number;
  capacity: number;
  capabilities: string[];
  missingCapabilities: string[];
  checks: {
    teamMatch: boolean;
    onShift: boolean;
    available: boolean;
    hasCapacity: boolean;
    capabilitiesMatch: boolean;
  };
  exclusionReasons: RoutingExclusionReason[];
}

export interface RoutingDecision {
  policyVersion: typeof routingPolicyVersion;
  selectedMemberId: string | null;
  requiredCapabilities: string[];
  candidates: RoutingCandidateEvaluation[];
}

export interface RoutingOptions {
  includeDemoAudience?: boolean;
}

export function isDemoAudienceMember(memberId: string): boolean {
  return memberId.startsWith("audience:");
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareEligible(
  left: { member: Member },
  right: { member: Member },
): number {
  return (
    left.member.openTaskCount - right.member.openTaskCount ||
    compareCodeUnits(left.member.tieBreakKey, right.member.tieBreakKey) ||
    compareCodeUnits(left.member.memberId, right.member.memberId)
  );
}

function evaluateCandidate(
  task: Task,
  member: Member,
): Omit<RoutingCandidateEvaluation, "rank"> {
  const missingCapabilities = task.requiredCapabilities.filter(
    (capability) => !member.capabilities.includes(capability),
  );
  const checks = {
    teamMatch: member.teamId === task.targetTeamId,
    onShift: member.onShift,
    available: member.available,
    hasCapacity: member.openTaskCount < member.capacity,
    capabilitiesMatch: missingCapabilities.length === 0,
  };
  const exclusionReasons: RoutingExclusionReason[] = [];
  if (!checks.teamMatch) exclusionReasons.push("wrong_team");
  if (!checks.onShift) exclusionReasons.push("off_shift");
  if (!checks.available) exclusionReasons.push("unavailable");
  if (!checks.hasCapacity) exclusionReasons.push("at_capacity");
  if (!checks.capabilitiesMatch) exclusionReasons.push("missing_capability");

  return {
    memberId: member.memberId,
    teamId: member.teamId,
    eligible: exclusionReasons.length === 0,
    openTaskCount: member.openTaskCount,
    capacity: member.capacity,
    capabilities: [...member.capabilities],
    missingCapabilities,
    checks,
    exclusionReasons,
  };
}

export function explainRouting(
  task: Task,
  members: Member[],
  options: RoutingOptions = {},
): RoutingDecision {
  const evaluated = members
    .filter(
      (member) =>
        options.includeDemoAudience === true ||
        !isDemoAudienceMember(member.memberId),
    )
    .map((member) => ({
      member,
      evaluation: evaluateCandidate(task, member),
    }));
  const eligible = evaluated
    .filter(({ evaluation }) => evaluation.eligible)
    .toSorted(compareEligible);
  const ineligible = evaluated
    .filter(({ evaluation }) => !evaluation.eligible)
    .toSorted((left, right) =>
      compareCodeUnits(left.member.memberId, right.member.memberId),
    );

  return {
    policyVersion: routingPolicyVersion,
    selectedMemberId: eligible[0]?.member.memberId ?? null,
    requiredCapabilities: [...task.requiredCapabilities],
    candidates: [
      ...eligible.map(({ evaluation }, index) => ({
        ...evaluation,
        rank: index + 1,
      })),
      ...ineligible.map(({ evaluation }) => ({
        ...evaluation,
        rank: null,
      })),
    ],
  };
}

export function chooseMember(
  task: Task,
  members: Member[],
  options: RoutingOptions = {},
): Member | null {
  const selectedMemberId = explainRouting(
    task,
    members,
    options,
  ).selectedMemberId;
  return (
    members.find((member) => member.memberId === selectedMemberId) ?? null
  );
}
