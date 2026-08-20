import { useMemo } from "react";
import type { Thread, ThreadStatus } from "@/data/ward";
import { bays, patients, staff } from "@/data/ward";

type Props = { threads: Thread[]; onOpenPatient: (id: string) => void };

const statusRank: Record<ThreadStatus, number> = {
  escalated: 3,
  pending: 2,
  tracking: 1,
  verified: 0,
};

function Ring({ pct }: { pct: number }) {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg
      viewBox="0 0 72 72"
      className="h-[72px] w-[72px] -rotate-90"
      role="img"
      aria-label={`${pct}% of tracked work verified`}
    >
      <circle
        cx="36"
        cy="36"
        r={radius}
        fill="none"
        strokeWidth="8"
        className="stroke-background"
      />
      <circle
        cx="36"
        cy="36"
        r={radius}
        fill="none"
        strokeWidth="8"
        strokeLinecap="round"
        className="stroke-verified transition-[stroke-dashoffset] duration-700"
        strokeDasharray={circumference}
        strokeDashoffset={circumference - (circumference * pct) / 100}
      />
    </svg>
  );
}

function Tile({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "pending" | "escalated" | "tracking";
}) {
  const tones = {
    pending: "bg-pending-soft text-pending-strong",
    escalated: "bg-escalated-soft text-escalated-strong",
    tracking: "bg-tracking-soft text-tracking-strong",
  } as const;

  return (
    <div className={`rounded-xl px-4 py-3 ${tones[tone]}`} aria-label={`${value} ${label}`}>
      <p className="text-[30px] font-medium leading-none tracking-tight tabular-nums">{value}</p>
      <p className="mt-1.5 text-[11px] font-medium uppercase tracking-widest opacity-80">{label}</p>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-panel p-4">
      <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function Insights({ threads, onOpenPatient }: Props) {
  const done = threads.filter((thread) => thread.status === "verified").length;
  const pending = threads.filter((thread) => thread.status === "pending").length;
  const escalated = threads.filter((thread) => thread.status === "escalated").length;
  const tracking = threads.filter((thread) => thread.status === "tracking").length;
  const pct = threads.length ? Math.round((done / threads.length) * 100) : 0;

  const teams = useMemo(() => {
    const map = new Map<string, boolean[]>();
    for (const member of staff) {
      map.set(member.team, [...(map.get(member.team) ?? []), member.free]);
    }
    return Array.from(map, ([name, members]) => ({
      name,
      members,
      free: members.filter(Boolean).length,
    })).sort((left, right) => right.free - left.free || left.name.localeCompare(right.name));
  }, []);

  const bedState = useMemo(
    () =>
      bays.map((bay) => ({
        id: bay.id,
        short: bay.name.split("—")[0]?.trim() ?? bay.name,
        beds: bay.beds.map((bed) => {
          const open = threads.filter(
            (thread) => thread.patientId === bed.patientId && thread.status !== "verified",
          );
          const worst = open.reduce<ThreadStatus>(
            (current, thread) =>
              statusRank[thread.status] > statusRank[current] ? thread.status : current,
            "verified",
          );
          return { ...bed, count: open.length, worst };
        }),
      })),
    [threads],
  );

  const goingHome = patients.filter((patient) => patient.homeTomorrow);
  const blocked = goingHome.filter((patient) =>
    threads.some((thread) => thread.patientId === patient.id && thread.status !== "verified"),
  );

  const bedTone: Record<ThreadStatus, string> = {
    escalated: "bg-escalated text-background",
    pending: "bg-pending text-background",
    tracking: "bg-tracking text-background",
    verified: "bg-verified-soft text-verified-strong",
  };

  return (
    <div className="h-full space-y-3.5 overflow-y-auto p-5">
      <section className="flex items-center gap-4 rounded-xl border border-border bg-panel p-4">
        <div className="relative shrink-0">
          <Ring pct={pct} />
          <span
            className="absolute inset-0 flex items-center justify-center text-[17px] font-medium tabular-nums text-foreground"
            aria-hidden="true"
          >
            {pct}%
          </span>
        </div>
        <div className="grid flex-1 grid-cols-3 gap-2">
          <Tile value={pending} label="Act now" tone="pending" />
          <Tile value={escalated} label="Overdue" tone="escalated" />
          <Tile value={tracking} label="Running" tone="tracking" />
        </div>
      </section>

      <Block title="Ward heat map">
        <div className="flex flex-wrap gap-4">
          {bedState.map((bay) => (
            <div key={bay.id} className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {bay.short}
              </p>
              <div className="flex gap-1.5">
                {bay.beds.map((bed) => (
                  <button
                    key={bed.bed}
                    disabled={!bed.patientId}
                    onClick={() => bed.patientId && onOpenPatient(bed.patientId)}
                    aria-label={
                      bed.patientId
                        ? `Bed ${bed.bed}: ${bed.count} open, highest status ${bed.worst}`
                        : `Bed ${bed.bed}: empty`
                    }
                    className={`flex h-11 w-11 flex-col items-center justify-center rounded-lg text-[11px] font-medium transition-transform active:scale-[0.985] ${
                      bed.patientId
                        ? `${bedTone[bed.worst]} hover:opacity-90`
                        : "border border-dashed border-border text-muted-foreground"
                    }`}
                  >
                    <span className="tabular-nums">{bed.bed}</span>
                    {bed.patientId && bed.count > 0 && (
                      <span className="text-[10px] opacity-90">{bed.count}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Block>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <Block title="Available staff">
          <ul className="space-y-2.5">
            {teams.map((team) => (
              <li key={team.name} className="flex items-center justify-between gap-3">
                <span className="truncate text-[12.5px] text-foreground">{team.name}</span>
                <span className="flex shrink-0 gap-1" aria-hidden="true">
                  {team.members.map((free, index) => (
                    <span
                      key={index}
                      className={`h-2.5 w-2.5 rounded-full ${
                        free ? "bg-verified" : "bg-background ring-1 ring-inset ring-border"
                      }`}
                    />
                  ))}
                </span>
                <span className="sr-only">
                  {team.free} of {team.members.length} free
                </span>
              </li>
            ))}
          </ul>
        </Block>

        <Block title="Discharges tomorrow">
          <div className="flex items-end gap-2">
            <span className="text-[30px] font-medium leading-none tabular-nums text-foreground">
              {goingHome.length - blocked.length}
            </span>
            <span className="pb-0.5 text-[12.5px] text-muted-foreground">
              of {goingHome.length} clear
            </span>
          </div>
          <div className="mt-2.5 flex h-2 gap-1 overflow-hidden rounded-full" aria-hidden="true">
            {goingHome.map((patient) => (
              <span
                key={patient.id}
                className={`h-full flex-1 rounded-full ${
                  blocked.includes(patient) ? "bg-escalated" : "bg-verified"
                }`}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {blocked.map((patient) => (
              <button
                key={patient.id}
                onClick={() => onOpenPatient(patient.id)}
                className="rounded-full bg-escalated-soft px-2.5 py-1 text-[11.5px] text-escalated-strong transition-transform active:scale-[0.985]"
              >
                Bed {patient.bed} blocked
              </button>
            ))}
            {blocked.length === 0 && (
              <span className="text-[12px] text-muted-foreground">All clear</span>
            )}
          </div>
        </Block>
      </div>
    </div>
  );
}
