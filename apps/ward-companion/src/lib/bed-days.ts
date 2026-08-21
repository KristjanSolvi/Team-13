export const ASSUMED_BED_DAYS_PER_TIMELY_BLOCKER = 0.5;

interface BedDaysThread {
  id: string;
  patientId: string;
  status: string;
  due: string;
  activity: ReadonlyArray<{ at: string }>;
}

interface DischargePatient {
  id: string;
  homeTomorrow: boolean;
}

export interface BedDaysEstimate {
  protectedBedDays: number;
  timelyVerifiedBlockers: number;
  bedDaysAtRisk: number;
  openDischargeBlockers: number;
  assumedBedDaysPerBlocker: number;
}

export function estimateBedDaysProtected(
  threads: ReadonlyArray<BedDaysThread>,
  dischargePatients: ReadonlyArray<DischargePatient>,
  now = new Date(),
): BedDaysEstimate {
  const plannedDischarges = new Set(
    dischargePatients.filter((patient) => patient.homeTomorrow).map((patient) => patient.id),
  );
  const weekStartedAt = startOfLocalWeek(now).getTime();
  const observedAt = now.getTime();
  const countedThreadIds = new Set<string>();
  const countedOpenThreadIds = new Set<string>();
  let timelyVerifiedBlockers = 0;
  let openDischargeBlockers = 0;

  for (const thread of threads) {
    if (
      thread.status !== "verified" &&
      plannedDischarges.has(thread.patientId) &&
      !countedOpenThreadIds.has(thread.id)
    ) {
      countedOpenThreadIds.add(thread.id);
      openDischargeBlockers += 1;
    }

    if (
      thread.status !== "verified" ||
      !plannedDischarges.has(thread.patientId) ||
      countedThreadIds.has(thread.id)
    ) {
      continue;
    }
    const dueAt = parseDisplayTime(thread.due, now);
    const verifiedAt = latestActivityTime(thread.activity, now);
    if (
      dueAt === null ||
      verifiedAt === null ||
      verifiedAt < weekStartedAt ||
      verifiedAt > observedAt ||
      verifiedAt > dueAt
    ) {
      continue;
    }
    countedThreadIds.add(thread.id);
    timelyVerifiedBlockers += 1;
  }

  return {
    protectedBedDays: Number(
      (timelyVerifiedBlockers * ASSUMED_BED_DAYS_PER_TIMELY_BLOCKER).toFixed(1),
    ),
    timelyVerifiedBlockers,
    bedDaysAtRisk: Number((openDischargeBlockers * ASSUMED_BED_DAYS_PER_TIMELY_BLOCKER).toFixed(1)),
    openDischargeBlockers,
    assumedBedDaysPerBlocker: ASSUMED_BED_DAYS_PER_TIMELY_BLOCKER,
  };
}

function latestActivityTime(activity: ReadonlyArray<{ at: string }>, now: Date): number | null {
  const timestamps = activity
    .map(({ at }) => parseDisplayTime(at, now))
    .filter((timestamp): timestamp is number => timestamp !== null);
  return timestamps.length === 0 ? null : Math.max(...timestamps);
}

function parseDisplayTime(value: string, now: Date): number | null {
  const absolute = Date.parse(value);
  if (Number.isFinite(absolute)) return absolute;

  const match = /^(Today|Yesterday)\s+(\d{2}):(\d{2})$|^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const hours = Number(match[2] ?? match[4]);
  const minutes = Number(match[3] ?? match[5]);
  if (hours > 23 || minutes > 59) return null;
  const parsed = new Date(now);
  parsed.setHours(hours, minutes, 0, 0);
  if (match[1] === "Yesterday") parsed.setDate(parsed.getDate() - 1);
  return parsed.getTime();
}

function startOfLocalWeek(now: Date): Date {
  const start = new Date(now);
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  start.setHours(0, 0, 0, 0);
  return start;
}
