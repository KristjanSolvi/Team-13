import type { Member, Task } from "./types.js";

export function isDemoAudienceMember(memberId: string): boolean {
  return memberId.startsWith("audience:");
}

function hasCapabilities(member: Member, required: string[]): boolean {
  return required.every((capability) =>
    member.capabilities.includes(capability),
  );
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function chooseMember(
  task: Task,
  members: Member[],
  options: { includeDemoAudience?: boolean } = {},
): Member | null {
  return (
    members
      .filter(
        (member) =>
          options.includeDemoAudience === true ||
          !isDemoAudienceMember(member.memberId),
      )
      .filter((member) => member.teamId === task.targetTeamId)
      .filter((member) => member.onShift && member.available)
      .filter((member) => member.openTaskCount < member.capacity)
      .filter((member) => hasCapabilities(member, task.requiredCapabilities))
      .toSorted(
        (left, right) =>
          left.openTaskCount - right.openTaskCount ||
          compareCodeUnits(left.tieBreakKey, right.tieBreakKey) ||
          compareCodeUnits(left.memberId, right.memberId),
      )[0] ?? null
  );
}
