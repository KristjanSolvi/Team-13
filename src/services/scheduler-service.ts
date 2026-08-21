import { calculatePriority } from "../domain/priority.js";
import { explainRouting } from "../domain/routing.js";
import type { Task, TaskState } from "../domain/types.js";
import type { Clock } from "../infra/clock.js";
import type { SqliteStore } from "../infra/store.js";

const DUE_ESCALATION_STATES: ReadonlySet<TaskState> = new Set([
  "draft",
  "offered_to_team",
  "assigned_to_member",
  "accepted",
  "completed",
]);

export function evaluateTaskRouting(store: SqliteStore, task: Task) {
  const declinedMemberIds = new Set(store.listDeclinedMemberIds(task.taskId));
  const candidates = store
    .listMembers(task.targetTeamId)
    .filter((candidate) => !declinedMemberIds.has(candidate.memberId));
  return {
    candidates,
    decision: explainRouting(task, candidates),
  };
}

export class SchedulerService {
  constructor(
    private readonly store: SqliteStore,
    private readonly clock: Clock,
  ) {}

  tick(): void {
    const now = this.clock.now();
    const updatedAt = now.toISOString();
    for (const task of this.store.listNonTerminalTasks()) {
      const priorityBreakdown = calculatePriority(task, now);
      this.store.refreshPriority(
        task.taskId,
        task.version,
        priorityBreakdown,
        updatedAt,
      );
      const current = this.store.requireTask(task.taskId);

      if (
        DUE_ESCALATION_STATES.has(current.state) &&
        Date.parse(current.dueBy) <= now.getTime()
      ) {
        this.store.escalate(
          current.taskId,
          current.version,
          "DUE_WITHOUT_VERIFICATION",
          updatedAt,
        );
        continue;
      }

      if (
        current.state === "offered_to_team" &&
        Date.parse(current.acceptBy) <= now.getTime()
      ) {
        const routing = evaluateTaskRouting(this.store, current);
        const member = routing.candidates.find(
          (candidate) =>
            candidate.memberId === routing.decision.selectedMemberId,
        );
        if (member) {
          this.store.assignMember(
            current.taskId,
            current.version,
            member.memberId,
            updatedAt,
            routing.decision,
          );
        } else {
          this.store.escalate(
            current.taskId,
            current.version,
            "NO_ELIGIBLE_MEMBER",
            updatedAt,
          );
        }
      }
    }
  }

  decline(taskId: string, expectedVersion: number, memberId: string): void {
    const declinedAt = this.clock.now().toISOString();
    this.store.transaction(() => {
      const task = this.store.recordDecline(
        taskId,
        expectedVersion,
        memberId,
        declinedAt,
      );
      const routing = evaluateTaskRouting(this.store, task);
      const next = routing.candidates.find(
        (candidate) => candidate.memberId === routing.decision.selectedMemberId,
      );
      if (next) {
        this.store.reassignMember(
          taskId,
          task.version,
          next.memberId,
          declinedAt,
          routing.decision,
        );
      } else {
        this.store.escalate(
          taskId,
          task.version,
          "ALL_ELIGIBLE_MEMBERS_DECLINED",
          declinedAt,
        );
      }
    });
  }
}
