import type { Member, Task } from "./types.js";

function hasCapabilities(member: Member, required: string[]): boolean {
  return required.every((capability) =>
    member.capabilities.includes(capability),
  );
}

export function chooseMember(task: Task, members: Member[]): Member | null {
  return (
    members
      .filter((member) => member.teamId === task.targetTeamId)
      .filter((member) => member.onShift && member.available)
      .filter((member) => member.openTaskCount < member.capacity)
      .filter((member) => hasCapabilities(member, task.requiredCapabilities))
      .toSorted(
        (left, right) =>
          left.openTaskCount - right.openTaskCount ||
          left.tieBreakKey.localeCompare(right.tieBreakKey) ||
          left.memberId.localeCompare(right.memberId),
      )[0] ?? null
  );
}
