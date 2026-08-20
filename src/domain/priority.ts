import type { ClinicalUrgency, PriorityBreakdown, Task } from "./types.js";

const BASE: Record<ClinicalUrgency, number> = {
  high: 100,
  medium: 60,
  routine: 20,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function calculatePriority(task: Task, now: Date): PriorityBreakdown {
  const activeTargetAt = ["accepted", "completed"].includes(task.state)
    ? task.dueBy
    : task.acceptBy;
  const start = Date.parse(task.createdAt);
  const target = Date.parse(activeTargetAt);
  const current = now.getTime();
  const progress =
    target === start ? 1 : clamp((current - start) / (target - start), 0, 1);
  const deadlinePressure = Math.round(progress * 30);
  const overdueHours = Math.max(0, Math.floor((current - target) / 3_600_000));
  const overdue = current >= target ? Math.min(80, 40 + overdueHours * 5) : 0;
  const failedOffers = Math.min(20, task.failedOffers * 10);
  const base = BASE[task.clinicalUrgency];

  return {
    base,
    deadlinePressure,
    overdue,
    failedOffers,
    total: base + deadlinePressure + overdue + failedOffers,
    activeTargetAt,
  };
}
