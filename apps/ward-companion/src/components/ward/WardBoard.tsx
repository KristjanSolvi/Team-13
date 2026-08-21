import { useMemo, useState } from "react";
import { ArrowUpRight, BedDouble, Home, TriangleAlert } from "lucide-react";
import type { CaseNote, Patient, Thread, WardBedAssignments } from "@/data/ward";
import { bays, patients } from "@/data/ward";
import { IsometricWardMap } from "./IsometricWardMap";
import { StatusBand } from "./StatusBand";

type Props = {
  threads: Thread[];
  notes?: Record<string, CaseNote[]>;
  onOpenThread: (threadId: string) => void;
  onOpenPatient: (patientId: string) => void;
  activePatientId?: string | null;
  bedAssignments: WardBedAssignments;
  onPlacePatient: (patientId: string, bed: string) => void;
  onResetPlacements: () => void;
};

function isDueTodayOrOverdue(due: string) {
  const d = due.toLowerCase();
  return d.startsWith("today") || d.startsWith("yesterday");
}

function isOverdue(due: string) {
  return due.toLowerCase().startsWith("yesterday");
}

function dueStyle(due: string) {
  return isOverdue(due)
    ? "bg-escalated-soft text-escalated-strong"
    : "bg-tracking-soft text-tracking-strong";
}

export function WardBoard({
  threads,
  notes,
  onOpenPatient,
  onOpenThread,
  activePatientId,
  bedAssignments,
  onPlacePatient,
  onResetPlacements,
}: Props) {
  const [onlyAttention, setOnlyAttention] = useState(false);

  const latestPlanFor = (p: Patient) => {
    const list = notes?.[p.id] ?? [];
    const candidates = list.filter((n) => n.doc === "medical");
    const note = (candidates.length ? candidates : list).at(-1);
    return note ? { text: note.text, at: note.at } : null;
  };

  const openThreadsFor = (p: Patient) =>
    threads.filter(
      (t) => t.patientId === p.id && t.status !== "verified" && isDueTodayOrOverdue(t.due),
    );

  const urgentFor = (p: Patient) =>
    openThreadsFor(p).filter((t) => isOverdue(t.due) || t.status === "escalated");

  const priority = useMemo(
    () =>
      threads
        .filter((t) => t.status !== "verified" && (t.status === "escalated" || isOverdue(t.due)))
        .slice(0, 4),
    [threads],
  );

  const patientOf = (id: string) => patients.find((p) => p.id === id);
  const patientIdForBed = (bed: string, fallback: string | null) =>
    Object.prototype.hasOwnProperty.call(bedAssignments, bed) ? bedAssignments[bed] : fallback;
  const bedForPatient = (patientId: string) =>
    Object.entries(bedAssignments).find(([, assignedId]) => assignedId === patientId)?.[0] ??
    patientOf(patientId)?.bed;

  return (
    <div className="space-y-8">
      <StatusBand threads={threads} />

      <IsometricWardMap
        threads={threads}
        bedAssignments={bedAssignments}
        activePatientId={activePatientId}
        onOpenPatient={onOpenPatient}
        onPlacePatient={onPlacePatient}
        onResetPlacements={onResetPlacements}
      />

      {priority.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-escalated/25 bg-escalated-soft/40">
          <header className="flex items-center gap-2 px-4 pt-3 text-[11px] font-semibold uppercase tracking-widest text-escalated-strong">
            <TriangleAlert className="size-3.5" /> Needs you now
          </header>
          <ul className="divide-y divide-escalated/15 px-1.5 py-1.5">
            {priority.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => onOpenThread(t.id)}
                  className="liquid-press group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-panel/70"
                >
                  <span className="w-16 shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
                    Bed {bedForPatient(t.patientId)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-foreground">
                    {t.title}
                    <span className="text-muted-foreground"> · {patientOf(t.patientId)?.name}</span>
                  </span>
                  <span className="shrink-0 text-[11.5px] font-medium tabular-nums text-escalated-strong">
                    {t.due}
                  </span>
                  <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          <BedDouble className="size-3.5" /> Board ward
        </p>
        <div className="flex items-center gap-0 overflow-hidden rounded-full border border-border bg-panel text-[12px] font-medium">
          {[
            ["All beds", false],
            ["Needs attention", true],
          ].map(([label, val]) => (
            <button
              key={String(label)}
              onClick={() => setOnlyAttention(val as boolean)}
              className={`px-3 py-1 transition-colors ${
                onlyAttention === val
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
        const beds = bay.beds.filter((slot) => {
          if (!onlyAttention) return true;
          const patientId = patientIdForBed(slot.bed, slot.patientId);
          const p = patients.find((x) => x.id === patientId);
          return p ? openThreadsFor(p).length > 0 : false;
        });
        if (beds.length === 0) return null;

        return (
          <section key={bay.id}>
            <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {bay.name}
            </h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {beds.map((slot) => {
                const patientId = patientIdForBed(slot.bed, slot.patientId);
                const patient = patients.find((p) => p.id === patientId) ?? null;
                if (!patient) {
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
                const open = openThreadsFor(patient);
                const urgent = urgentFor(patient).length;
                const plan = latestPlanFor(patient);
                const rail = urgent
                  ? "before:bg-escalated"
                  : open.length
                    ? "before:bg-tracking"
                    : "before:bg-verified";

                return (
                  <article
                    key={slot.bed}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenPatient(patient.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpenPatient(patient.id);
                      }
                    }}
                    className={`relative cursor-pointer overflow-hidden rounded-xl border bg-panel pl-5 pr-4 py-3.5 text-left transition-all before:absolute before:inset-y-0 before:left-0 before:w-[3px] hover:-translate-y-[1px] hover:shadow-md ${rail} ${
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
                        {slot.bed}
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {open.length ? `${open.length} open today` : "Nothing open today"}
                      </span>
                      {urgent > 0 && (
                        <span className="rounded-full bg-escalated-soft px-1.5 py-0.5 text-[10.5px] font-medium text-escalated-strong">
                          {urgent} overdue
                        </span>
                      )}
                      {patient.homeTomorrow && (
                        <span className="flex items-center gap-1 rounded-full bg-verified-soft px-1.5 py-0.5 text-[10.5px] font-medium text-verified-strong">
                          <Home className="size-2.5" /> EDD tomorrow
                        </span>
                      )}
                    </div>

                    {plan && (
                      <p className="mt-2 line-clamp-2 border-l border-border pl-2 text-[11.5px] leading-relaxed text-muted-foreground">
                        {plan.text}
                      </p>
                    )}

                    {open.length > 0 ? (
                      <div className="mt-2.5 space-y-1">
                        {open.slice(0, 3).map((t) => (
                          <button
                            key={t.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenThread(t.id);
                            }}
                            className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[11.5px] transition-opacity hover:opacity-80 ${dueStyle(t.due)}`}
                          >
                            <span className="truncate">{t.title}</span>
                            <span className="shrink-0 tabular-nums opacity-90">{t.due}</span>
                          </button>
                        ))}
                        {open.length > 3 && (
                          <p className="pl-2 text-[11px] text-muted-foreground">
                            +{open.length - 3} more
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
    </div>
  );
}
