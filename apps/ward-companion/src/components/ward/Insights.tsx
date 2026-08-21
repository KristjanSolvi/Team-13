import { useCallback, useMemo } from "react";
import type { Thread } from "@/data/ward";
import { patients } from "@/data/ward";
import { demoStaff } from "@/data/demo-staff";
import { estimateBedDaysProtected } from "@/lib/bed-days";
import { PatientJourneyMap } from "./PatientJourneyMap";

type Props = {
  threads: Thread[];
  initialPatientId?: string;
  onOpenPatient: (id: string) => void;
  onOpenThread: (id: string) => void;
};

/* ------------------------------------------------------------------ */
/* primitives                                                          */
/* ------------------------------------------------------------------ */

function Card({
  title,
  hint,
  children,
  className = "",
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border bg-panel p-4 ${className}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </h3>
        {hint && <span className="text-[11px] text-muted-foreground/80">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* modelled discharge-delay exposure                                  */
/* ------------------------------------------------------------------ */

function BedDaysProtected({ threads }: { threads: Thread[] }) {
  const estimate = useMemo(() => estimateBedDaysProtected(threads, patients), [threads]);

  return (
    <Card
      title="Discharge delay exposure"
      hint="Modelled opportunity · not measured outcome"
      className="bed-days-insight overflow-hidden lg:col-span-2"
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="min-w-0">
          <p className="text-[44px] font-medium leading-none tracking-tight tabular-nums text-foreground">
            {estimate.bedDaysAtRisk.toFixed(1)}
            <span className="ml-2 text-[17px] font-normal tracking-normal text-muted-foreground">
              bed-days at risk
            </span>
          </p>
          <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-muted-foreground">
            {estimate.openDischargeBlockers} open follow-through item
            {estimate.openDischargeBlockers === 1 ? "" : "s"} for patients planned home tomorrow ×{" "}
            {estimate.assumedBedDaysPerBlocker.toFixed(1)} modelled day of possible discharge delay.
          </p>
        </div>
        <div className="grid min-w-[220px] grid-cols-2 gap-2">
          <div className="rounded-xl border border-white/70 bg-white/45 px-3 py-2.5 shadow-sm backdrop-blur-md">
            <p className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">
              Protected so far
            </p>
            <p className="mt-1 text-[20px] font-medium tabular-nums text-verified-strong">
              {estimate.protectedBedDays.toFixed(1)}
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">bed-days</span>
            </p>
          </div>
          <div className="rounded-xl border border-white/70 bg-white/45 px-3 py-2.5 shadow-sm backdrop-blur-md">
            <p className="text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">
              Closed on time
            </p>
            <p className="mt-1 text-[20px] font-medium tabular-nums text-foreground">
              {estimate.timelyVerifiedBlockers}
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">items</span>
            </p>
          </div>
        </div>
      </div>
      <p className="mt-3 border-t border-border/70 pt-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
        Protection is credited only after independent verification before the task deadline; open
        work remains exposure, not impact claimed.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 1 · time returned                                                   */
/* ------------------------------------------------------------------ */

const savedSplit = [
  { label: "Chasing & phone calls", minutes: 96, tone: "bg-tracking/70" },
  { label: "Documentation", minutes: 74, tone: "bg-verified/70" },
  { label: "Handover prep", minutes: 50, tone: "bg-pending/70" },
];

function TimeReturned() {
  const total = savedSplit.reduce((n, s) => n + s.minutes, 0);
  const hrs = Math.floor(total / 60);
  const mins = total % 60;

  return (
    <Card title="Clinician time returned" hint="today, ward-wide">
      <div className="flex items-end gap-3">
        <p className="text-[40px] font-medium leading-none tracking-tight tabular-nums text-foreground">
          {hrs}
          <span className="text-[20px] text-muted-foreground">h </span>
          {mins}
          <span className="text-[20px] text-muted-foreground">m</span>
        </p>
        <p className="pb-1 text-[11.5px] leading-tight text-muted-foreground">
          ≈ {(total / 60 / 8).toFixed(1)} shifts
          <br />
          of doctor time
        </p>
      </div>

      <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-background">
        {savedSplit.map((s) => (
          <div
            key={s.label}
            className={`h-full ${s.tone}`}
            style={{ width: `${(s.minutes / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {savedSplit.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-[12.5px]">
            <span className={`size-2 shrink-0 rounded-full ${s.tone}`} />
            <span className="flex-1 truncate text-muted-foreground">{s.label}</span>
            <span className="tabular-nums text-foreground">{s.minutes}m</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 2 · flow funnel                                                     */
/* ------------------------------------------------------------------ */

function Funnel({ threads }: { threads: Thread[] }) {
  const captured = threads.length;
  const owned = threads.filter((t) => t.assignee).length;
  const inMotion = threads.filter((t) => t.status === "tracking" || t.status === "verified").length;
  const verified = threads.filter((t) => t.status === "verified").length;

  const steps = [
    { label: "Heard", value: captured },
    { label: "Owned", value: owned },
    { label: "In motion", value: inMotion },
    { label: "Verified", value: verified },
  ];

  const drops = steps.slice(1).map((s, i) => (steps[i]?.value ?? 0) - s.value);
  const worst = drops.indexOf(Math.max(...drops));

  return (
    <Card title="Where the day gets stuck" hint="spoken → done">
      <div className="flex items-end gap-1.5">
        {steps.map((s, i) => {
          const pct = captured === 0 ? 0 : (s.value / captured) * 100;
          const isBreak = i === worst + 1;
          return (
            <div key={s.label} className="flex-1">
              <div className="flex h-24 items-end">
                <div
                  className={`w-full rounded-t-md transition-all duration-500 ${
                    isBreak ? "bg-escalated/35" : "bg-tracking/25"
                  }`}
                  style={{ height: `${Math.max(8, pct)}%` }}
                />
              </div>
              <p className="mt-2 text-[15px] font-medium leading-none tabular-nums text-foreground">
                {s.value}
              </p>
              <p className="mt-1 truncate text-[10.5px] uppercase tracking-wide text-muted-foreground">
                {s.label}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-3 border-t border-border pt-3 text-[12.5px] leading-relaxed text-muted-foreground">
        Biggest loss is{" "}
        <span className="text-foreground">
          {steps[worst]?.label} → {steps[worst + 1]?.label}
        </span>{" "}
        — {Math.max(...drops)} task{Math.max(...drops) === 1 ? "" : "s"} sitting without movement.
        Offering them to a free team clears it fastest.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 3 · ward rhythm                                                     */
/* ------------------------------------------------------------------ */

const rhythm = [
  { h: "07", raised: 2, closed: 0 },
  { h: "08", raised: 5, closed: 1 },
  { h: "09", raised: 7, closed: 2 },
  { h: "10", raised: 4, closed: 3 },
  { h: "11", raised: 3, closed: 4 },
  { h: "12", raised: 2, closed: 3 },
  { h: "13", raised: 1, closed: 2 },
  { h: "14", raised: 3, closed: 1 },
  { h: "15", raised: 2, closed: 2 },
  { h: "16", raised: 1, closed: 3 },
  { h: "17", raised: 1, closed: 2 },
];

function Rhythm() {
  const max = Math.max(...rhythm.flatMap((r) => [r.raised, r.closed]));
  const nowIndex = 4; // 11:00

  return (
    <Card title="Ward rhythm" hint="raised vs closed, per hour">
      <div className="flex items-end gap-[3px]">
        {rhythm.map((r, i) => (
          <div key={r.h} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-20 w-full items-end justify-center gap-[2px]">
              <div
                className="w-1/2 rounded-t-sm bg-pending/60"
                style={{ height: `${(r.raised / max) * 100}%` }}
                title={`${r.raised} raised`}
              />
              <div
                className="w-1/2 rounded-t-sm bg-verified/60"
                style={{ height: `${(r.closed / max) * 100}%` }}
                title={`${r.closed} closed`}
              />
            </div>
            <span
              className={`text-[9.5px] tabular-nums ${
                i === nowIndex ? "font-semibold text-foreground" : "text-muted-foreground/70"
              }`}
            >
              {r.h}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4 border-t border-border pt-3 text-[11.5px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-pending/70" /> Raised
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-verified/70" /> Closed
        </span>
        <span className="ml-auto">Round peak 09:00 · backlog clears after 15:00</span>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 4 · discharge runway                                                */
/* ------------------------------------------------------------------ */

function Runway({
  threads,
  onOpenPatient,
}: {
  threads: Thread[];
  onOpenPatient: (id: string) => void;
}) {
  const rows = patients
    .filter((p) => p.homeTomorrow)
    .map((p) => {
      const blockers = threads.filter((t) => t.patientId === p.id && t.status !== "verified");
      const escalated = blockers.some((t) => t.status === "escalated");
      return { patient: p, blockers, escalated };
    })
    .sort((a, b) => b.blockers.length - a.blockers.length);

  return (
    <Card title="Discharge runway" hint="planned home tomorrow">
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">No discharges planned for tomorrow.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map(({ patient, blockers, escalated }) => {
            const ready = blockers.length === 0;
            const progressPct = ready ? 100 : Math.max(18, 100 - blockers.length * 34);
            return (
              <li key={patient.id}>
                <button
                  onClick={() => onOpenPatient(patient.id)}
                  className="w-full rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:bg-background"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[13.5px] text-foreground">{patient.name}</span>
                    <span className="shrink-0 text-[10.5px] text-muted-foreground">
                      Bed {patient.bed}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        ready ? "bg-verified" : escalated ? "bg-escalated/70" : "bg-tracking/70"
                      }`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <p className="mt-1.5 truncate text-[11.5px] text-muted-foreground">
                    {ready
                      ? "Nothing outstanding — safe to confirm transport"
                      : `Waiting on ${blockers.map((b) => b.title.toLowerCase()).join(", ")}`}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* 5 · team capacity                                                   */
/* ------------------------------------------------------------------ */

function Capacity({ threads }: { threads: Thread[] }) {
  const staff = demoStaff;
  const teamOf = useCallback(
    (name: string | null | undefined) =>
      name ? (staff.find((member) => member.name === name)?.team ?? null) : null,
    [staff],
  );
  const open = threads.filter((t) => t.status !== "verified");

  const rows = useMemo(() => {
    const map = new Map<string, { total: number; free: number; load: number }>();
    for (const s of staff) {
      const e = map.get(s.team) ?? { total: 0, free: 0, load: 0 };
      e.total += 1;
      if (s.free) e.free += 1;
      map.set(s.team, e);
    }
    for (const t of open) {
      const team = t.team ?? teamOf(t.assignee);
      if (!team) continue;
      const e = map.get(team);
      if (e) e.load += 1;
    }
    return Array.from(map.entries())
      .map(([name, d]) => ({ name, ...d }))
      .sort((a, b) => b.load - a.load || b.free - a.free);
  }, [open, staff, teamOf]);

  const unowned = open.filter((t) => !t.assignee && !t.team).length;

  return (
    <Card title="Team capacity" hint="live availability vs load">
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.name}>
            <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
              <span className="truncate text-foreground">{r.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {r.free}/{r.total} free
                {r.load > 0 && <span className="text-foreground"> · {r.load} on</span>}
              </span>
            </div>
            <div className="mt-1 flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full bg-background">
              {Array.from({ length: r.total }).map((_, i) => (
                <span
                  key={i}
                  className={`h-full flex-1 rounded-full ${
                    i < r.load
                      ? "bg-tracking/70"
                      : i < r.load + r.free
                        ? "bg-verified/55"
                        : "bg-muted"
                  }`}
                />
              ))}
            </div>
          </li>
        ))}
      </ul>
      {unowned > 0 && (
        <p className="mt-3 border-t border-border pt-3 text-[12.5px] leading-relaxed text-muted-foreground">
          <span className="text-foreground">
            {unowned} task{unowned === 1 ? "" : "s"}
          </span>{" "}
          still have no team. Spare hands sit with{" "}
          {rows
            .filter((r) => r.free > 0)
            .slice(0, 2)
            .map((r) => r.name)
            .join(" and ")}
          .
        </p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */

export function Insights({ threads, initialPatientId, onOpenPatient, onOpenThread }: Props) {
  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <BedDaysProtected threads={threads} />
        <TimeReturned />
        <Funnel threads={threads} />
        <Rhythm />
        <Runway threads={threads} onOpenPatient={onOpenPatient} />
        <Capacity threads={threads} />
        <PatientJourneyMap
          threads={threads}
          initialPatientId={initialPatientId}
          onOpenPatient={onOpenPatient}
          onOpenThread={onOpenThread}
        />
      </div>
    </div>
  );
}
