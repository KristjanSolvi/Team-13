import { useMemo, useState, type ReactNode } from "react";
import { ArrowUpRight, BedDouble, Home, TriangleAlert } from "lucide-react";
import type { CaseNote, Patient, Thread } from "@/data/ward";
import { bays, patients } from "@/data/ward";
import { StatusBand } from "./StatusBand";

type Props = {
  threads: Thread[];
  notes?: Record<string, CaseNote[]>;
  onOpenThread: (threadId: string) => void;
  onOpenPatient: (patientId: string) => void;
  activePatientId?: string | null;
};

function isDueTodayOrOverdue(due: string) {
  const normalized = due.toLowerCase();
  return normalized.startsWith("today") || normalized.startsWith("yesterday");
}

function isOverdue(due: string) {
  return due.toLowerCase().startsWith("yesterday");
}

function dueStyle(due: string) {
  return isOverdue(due)
    ? "bg-escalated-soft text-escalated-strong"
    : "bg-tracking-soft text-tracking-strong";
}

function SummaryCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-panel p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </h3>
        {hint !== undefined && <span className="text-[11px] text-muted-foreground/80">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function FollowThroughFlow({ threads }: { threads: Thread[] }) {
  const captured = threads.length;
  const inMotion = threads.filter(
    (thread) => thread.status === "tracking" || thread.status === "verified",
  ).length;
  const owned = threads.filter(
    (thread) =>
      thread.assignee !== null ||
      thread.backend?.targetTeamId != null ||
      thread.status === "tracking" ||
      thread.status === "verified",
  ).length;
  const verified = threads.filter((thread) => thread.status === "verified").length;
  const steps = [
    { label: "Captured", value: captured },
    { label: "Owned", value: owned },
    { label: "In motion", value: inMotion },
    { label: "Verified", value: verified },
  ];
  const drops = steps.slice(1).map((step, index) => (steps[index]?.value ?? 0) - step.value);
  const largestDrop = Math.max(...drops);
  const breakIndex = drops.indexOf(largestDrop);

  return (
    <SummaryCard title="From captured to verified" hint="current ward state">
      <div className="flex items-end gap-1.5">
        {steps.map((step, index) => {
          const percentage = captured === 0 ? 0 : (step.value / captured) * 100;
          return (
            <div key={step.label} className="flex-1">
              <div className="flex h-20 items-end">
                <div
                  className={`w-full rounded-t-md transition-all duration-500 ${
                    index === breakIndex + 1 ? "bg-escalated/30" : "bg-tracking/25"
                  }`}
                  style={{ height: captured === 0 ? "0%" : `${Math.max(8, percentage)}%` }}
                />
              </div>
              <p className="mt-2 text-[15px] font-medium leading-none tabular-nums text-foreground">
                {step.value}
              </p>
              <p className="mt-1 truncate text-[10.5px] uppercase tracking-wide text-muted-foreground">
                {step.label}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-3 border-t border-border pt-3 text-[12.5px] leading-relaxed text-muted-foreground">
        {captured === 0 || largestDrop <= 0 ? (
          "No follow-through bottleneck is visible yet."
        ) : (
          <>
            The largest wait is between{" "}
            <span className="text-foreground">
              {steps[breakIndex]?.label} and {steps[breakIndex + 1]?.label}
            </span>
            : {largestDrop} item{largestDrop === 1 ? "" : "s"}.
          </>
        )}
      </p>
    </SummaryCard>
  );
}

function AvailablePeople({ threads }: { threads: Thread[] }) {
  const people = useMemo(() => {
    const candidates = new Map<
      string,
      { name: string; role: string; free: boolean; assigned: number }
    >();
    for (const thread of threads) {
      for (const candidate of thread.candidates) {
        const current = candidates.get(candidate.name);
        candidates.set(candidate.name, {
          name: candidate.name,
          role: candidate.role,
          free: current?.free === true || candidate.free,
          assigned: current?.assigned ?? 0,
        });
      }
    }
    for (const thread of threads) {
      if (thread.status === "verified" || thread.assignee === null) continue;
      const current = candidates.get(thread.assignee);
      if (current !== undefined) current.assigned += 1;
    }
    return [...candidates.values()]
      .sort(
        (left, right) => Number(right.free) - Number(left.free) || left.assigned - right.assigned,
      )
      .slice(0, 5);
  }, [threads]);
  const unowned = threads.filter(
    (thread) => thread.status !== "verified" && thread.assignee === null,
  ).length;

  return (
    <SummaryCard title="Who can take it" hint="candidate availability">
      {people.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">
          Candidate availability will appear when a task has a receiving team.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {people.map((person) => (
            <li key={person.name} className="flex items-center justify-between gap-3 text-[12.5px]">
              <span className="min-w-0">
                <span className="block truncate text-foreground">{person.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {person.role}
                </span>
              </span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                  person.free
                    ? "bg-verified-soft text-verified-strong"
                    : "bg-background text-muted-foreground"
                }`}
              >
                {person.assigned > 0
                  ? `${person.assigned} active`
                  : person.free
                    ? "Available"
                    : "Busy"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 border-t border-border pt-3 text-[12.5px] leading-relaxed text-muted-foreground">
        {unowned === 0
          ? "Every open item currently has an owner."
          : `${unowned} open item${unowned === 1 ? " still needs" : "s still need"} an owner.`}
      </p>
    </SummaryCard>
  );
}

export function WardBoard({ threads, notes, onOpenPatient, onOpenThread, activePatientId }: Props) {
  const [onlyAttention, setOnlyAttention] = useState(false);

  const latestPlanFor = (patient: Patient) => {
    const patientNotes = notes?.[patient.id] ?? [];
    const medical = patientNotes.filter((note) => note.doc === "medical");
    const note = (medical.length > 0 ? medical : patientNotes).at(-1);
    return note?.text ?? null;
  };

  const openThreadsFor = (patient: Patient) =>
    threads.filter(
      (thread) =>
        thread.patientId === patient.id &&
        thread.status !== "verified" &&
        isDueTodayOrOverdue(thread.due),
    );

  const urgentFor = (patient: Patient) =>
    openThreadsFor(patient).filter(
      (thread) => isOverdue(thread.due) || thread.status === "escalated",
    );

  const priority = useMemo(
    () =>
      threads
        .filter(
          (thread) =>
            thread.status !== "verified" &&
            (thread.status === "escalated" || isOverdue(thread.due)),
        )
        .slice(0, 4),
    [threads],
  );

  const patientFor = (patientId: string) => patients.find((patient) => patient.id === patientId);

  return (
    <div className="space-y-8">
      <StatusBand threads={threads} />

      {priority.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-escalated/25 bg-escalated-soft/40">
          <header className="flex items-center gap-2 px-4 pt-3 text-[11px] font-semibold uppercase tracking-widest text-escalated-strong">
            <TriangleAlert className="size-3.5" /> Needs you now
          </header>
          <ul className="divide-y divide-escalated/15 px-1.5 py-1.5">
            {priority.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  onClick={() => onOpenThread(thread.id)}
                  className="liquid-press group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-panel/70"
                >
                  <span className="w-16 shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
                    Bed {patientFor(thread.patientId)?.bed ?? "—"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-foreground">
                    {thread.title}
                    <span className="text-muted-foreground">
                      {" "}
                      · {patientFor(thread.patientId)?.name ?? "Unknown patient"}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11.5px] font-medium tabular-nums text-escalated-strong">
                    {thread.due}
                  </span>
                  <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          <BedDouble className="size-3.5" /> Beds
        </p>
        <div className="flex items-center overflow-hidden rounded-full border border-border bg-panel text-[12px] font-medium">
          {[
            ["All beds", false],
            ["Needs attention", true],
          ].map(([label, value]) => (
            <button
              key={String(label)}
              type="button"
              onClick={() => setOnlyAttention(value as boolean)}
              className={`px-3 py-1 transition-colors ${
                onlyAttention === value
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label as string}
            </button>
          ))}
        </div>
      </div>

      {bays.map((bay) => {
        const visibleBeds = bay.beds.filter((slot) => {
          if (!onlyAttention) return true;
          const patient = patients.find((candidate) => candidate.id === slot.patientId);
          return patient !== undefined && openThreadsFor(patient).length > 0;
        });
        if (visibleBeds.length === 0) return null;

        return (
          <section key={bay.id}>
            <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {bay.name}
            </h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleBeds.map((slot) => {
                const patient =
                  patients.find((candidate) => candidate.id === slot.patientId) ?? null;
                if (patient === null) {
                  return (
                    <div
                      key={slot.bed}
                      className="flex min-h-[132px] items-center justify-center rounded-xl border border-dashed border-border/80"
                    >
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
                        Bed {slot.bed} · empty
                      </span>
                    </div>
                  );
                }

                const openThreads = openThreadsFor(patient);
                const urgentCount = urgentFor(patient).length;
                const latestPlan = latestPlanFor(patient);
                const rail =
                  urgentCount > 0
                    ? "before:bg-escalated"
                    : openThreads.length > 0
                      ? "before:bg-tracking"
                      : "before:bg-verified";

                return (
                  <article
                    key={slot.bed}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenPatient(patient.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpenPatient(patient.id);
                      }
                    }}
                    className={`relative cursor-pointer overflow-hidden rounded-xl border bg-panel py-3.5 pl-5 pr-4 text-left transition-all before:absolute before:inset-y-0 before:left-0 before:w-[3px] hover:-translate-y-[1px] hover:shadow-md ${rail} ${
                      activePatientId === patient.id
                        ? "border-tracking/60 ring-1 ring-tracking/25"
                        : "border-border"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="truncate text-[16px] font-medium leading-tight tracking-tight text-foreground">
                        {patient.name}
                      </h3>
                      <span className="mt-[3px] shrink-0 rounded-md bg-background px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-foreground">
                        {patient.bed}
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {openThreads.length > 0
                          ? `${openThreads.length} open today`
                          : "Nothing open today"}
                      </span>
                      {urgentCount > 0 && (
                        <span className="rounded-full bg-escalated-soft px-1.5 py-0.5 text-[10.5px] font-medium text-escalated-strong">
                          {urgentCount} overdue
                        </span>
                      )}
                      {patient.homeTomorrow && (
                        <span className="flex items-center gap-1 rounded-full bg-verified-soft px-1.5 py-0.5 text-[10.5px] font-medium text-verified-strong">
                          <Home className="size-2.5" /> EDD tomorrow
                        </span>
                      )}
                    </div>

                    {latestPlan !== null && (
                      <p className="mt-2 line-clamp-2 border-l border-border pl-2 text-[11.5px] leading-relaxed text-muted-foreground">
                        {latestPlan}
                      </p>
                    )}

                    {openThreads.length > 0 ? (
                      <div className="mt-2.5 space-y-1">
                        {openThreads.slice(0, 3).map((thread) => (
                          <button
                            key={thread.id}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenThread(thread.id);
                            }}
                            className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[11.5px] transition-opacity hover:opacity-80 ${dueStyle(thread.due)}`}
                          >
                            <span className="truncate">{thread.title}</span>
                            <span className="shrink-0 tabular-nums opacity-90">{thread.due}</span>
                          </button>
                        ))}
                        {openThreads.length > 3 && (
                          <p className="pl-2 text-[11px] text-muted-foreground">
                            +{openThreads.length - 3} more
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="mt-2.5 text-[11.5px] font-medium text-verified-strong">
                        Clear for discharge
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      <div className="grid gap-4 lg:grid-cols-2">
        <FollowThroughFlow threads={threads} />
        <AvailablePeople threads={threads} />
      </div>
    </div>
  );
}
