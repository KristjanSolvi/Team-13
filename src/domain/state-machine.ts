import { DomainError } from "./errors.js";
import type { TaskState } from "./types.js";

const allowed: Record<TaskState, ReadonlySet<TaskState>> = {
  draft: new Set(["offered_to_team", "escalated", "dismissed"]),
  offered_to_team: new Set(["accepted", "assigned_to_member", "escalated"]),
  assigned_to_member: new Set(["accepted", "assigned_to_member", "escalated"]),
  accepted: new Set(["completed", "escalated"]),
  completed: new Set(["verified", "escalated"]),
  verified: new Set(),
  escalated: new Set(["offered_to_team", "assigned_to_member", "accepted"]),
  dismissed: new Set(),
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return allowed[from].has(to);
}

export function requireTransition(from: TaskState, to: TaskState): void {
  if (!canTransition(from, to)) {
    throw new DomainError(
      "INVALID_TRANSITION",
      `${from} cannot transition to ${to}`,
      false,
      409,
    );
  }
}
