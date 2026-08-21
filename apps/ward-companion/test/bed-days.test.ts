import assert from "node:assert/strict";
import test from "node:test";

import { estimateBedDaysProtected } from "../src/lib/bed-days.js";

const now = new Date("2026-08-21T12:00:00.000Z");

function thread(
  id: string,
  patientId: string,
  due: string,
  verifiedAt: string,
  status: "verified" | "tracking" = "verified",
) {
  return {
    id,
    patientId,
    status,
    due,
    activity: [
      {
        id: `${id}:verified`,
        at: verifiedAt,
        actor: "Follow-through service",
        text: "Completion was independently verified.",
        kind: "action" as const,
      },
    ],
  };
}

test("estimates 0.5 bed-day for each timely verified discharge blocker this week", () => {
  const result = estimateBedDaysProtected(
    [
      thread("timely-1", "planned-home", "2026-08-21T14:00:00.000Z", "2026-08-21T11:00:00.000Z"),
      thread("timely-2", "planned-home", "Today 16:00", "11:30"),
      thread("late", "planned-home", "2026-08-20T10:00:00.000Z", "2026-08-20T11:00:00.000Z"),
      thread("not-discharge", "staying", "2026-08-21T14:00:00.000Z", "2026-08-21T11:00:00.000Z"),
      thread(
        "still-open",
        "planned-home",
        "2026-08-21T14:00:00.000Z",
        "2026-08-21T11:00:00.000Z",
        "tracking",
      ),
    ],
    [
      { id: "planned-home", homeTomorrow: true },
      { id: "staying", homeTomorrow: false },
    ],
    now,
  );

  assert.deepEqual(result, {
    protectedBedDays: 1,
    timelyVerifiedBlockers: 2,
    bedDaysAtRisk: 0.5,
    openDischargeBlockers: 1,
    assumedBedDaysPerBlocker: 0.5,
  });
});

test("excludes verification outside the current week and unparseable deadlines", () => {
  const result = estimateBedDaysProtected(
    [
      thread("last-week", "planned-home", "2026-08-14T14:00:00.000Z", "2026-08-14T11:00:00.000Z"),
      thread("no-deadline", "planned-home", "Awaiting clinical review", "2026-08-21T11:00:00.000Z"),
    ],
    [{ id: "planned-home", homeTomorrow: true }],
    now,
  );

  assert.equal(result.protectedBedDays, 0);
  assert.equal(result.timelyVerifiedBlockers, 0);
  assert.equal(result.bedDaysAtRisk, 0);
  assert.equal(result.openDischargeBlockers, 0);
});

test("shows modelled exposure for open blockers on planned discharges", () => {
  const result = estimateBedDaysProtected(
    [
      thread("open-one", "planned-home", "Today 14:00", "11:00", "tracking"),
      thread("open-two", "planned-home", "Today 16:00", "11:30", "tracking"),
      thread("other-patient", "staying", "Today 16:00", "11:30", "tracking"),
    ],
    [
      { id: "planned-home", homeTomorrow: true },
      { id: "staying", homeTomorrow: false },
    ],
    now,
  );

  assert.equal(result.bedDaysAtRisk, 1);
  assert.equal(result.openDischargeBlockers, 2);
  assert.equal(result.protectedBedDays, 0);
});
