import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  BedDouble,
  Building2,
  Check,
  CircleAlert,
  Home,
  RotateCcw,
  Route,
  Sparkles,
  UserRoundPlus,
  X,
} from "lucide-react";

import type { Thread, WardBedAssignments } from "@/data/ward";
import { bays, patients } from "@/data/ward";

type Props = {
  threads: Thread[];
  bedAssignments: WardBedAssignments;
  activePatientId?: string | null | undefined;
  onOpenPatient: (patientId: string) => void;
  onPlacePatient: (patientId: string, bed: string) => void;
  onResetPlacements: () => void;
};

type BedTone = "empty" | "stable" | "moving" | "urgent" | "discharge";

const toneStyles: Record<BedTone, { card: string; edge: string; dot: string; label: string }> = {
  empty: {
    card: "border-dashed border-border bg-white/38 text-muted-foreground hover:bg-white/60",
    edge: "bg-muted-foreground/15",
    dot: "bg-muted-foreground/35",
    label: "Empty · ready",
  },
  stable: {
    card: "border-verified/25 bg-verified-soft/75 text-verified-strong hover:bg-verified-soft",
    edge: "bg-verified/20",
    dot: "bg-verified",
    label: "Stable",
  },
  moving: {
    card: "border-tracking/30 bg-tracking-soft/80 text-tracking-strong hover:bg-tracking-soft",
    edge: "bg-tracking/25",
    dot: "bg-tracking",
    label: "Follow-through active",
  },
  urgent: {
    card: "border-escalated/35 bg-escalated-soft/85 text-escalated-strong hover:bg-escalated-soft",
    edge: "bg-escalated/25",
    dot: "bg-escalated animate-pulse",
    label: "Needs attention",
  },
  discharge: {
    card: "border-pending/30 bg-pending-soft/80 text-pending-strong hover:bg-pending-soft",
    edge: "bg-pending/25",
    dot: "bg-pending",
    label: "Discharge runway",
  },
};

function isOverdue(thread: Thread): boolean {
  return thread.status === "escalated" || thread.due.toLowerCase().startsWith("yesterday");
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0])
    .join("");
}

export function IsometricWardMap({
  threads,
  bedAssignments,
  activePatientId,
  onOpenPatient,
  onPlacePatient,
  onResetPlacements,
}: Props) {
  const [placementBed, setPlacementBed] = useState<string | null>(null);
  const patientById = useMemo(() => new Map(patients.map((patient) => [patient.id, patient])), []);
  const currentBedFor = (patientId: string) =>
    Object.entries(bedAssignments).find(([, assignedId]) => assignedId === patientId)?.[0] ?? null;
  const threadsFor = (patientId: string) =>
    threads.filter((thread) => thread.patientId === patientId);

  const toneFor = (patientId: string): BedTone => {
    const patient = patientById.get(patientId);
    const patientThreads = threadsFor(patientId);
    if (patientThreads.some(isOverdue)) return "urgent";
    if (patient?.homeTomorrow && patientThreads.some((thread) => thread.status !== "verified")) {
      return "discharge";
    }
    if (patientThreads.some((thread) => thread.status !== "verified")) return "moving";
    return "stable";
  };

  const urgentBeds = Object.values(bedAssignments).filter(
    (patientId) => patientId !== null && toneFor(patientId) === "urgent",
  ).length;
  const movingBeds = Object.values(bedAssignments).filter(
    (patientId) => patientId !== null && toneFor(patientId) === "moving",
  ).length;
  const emptyBeds = Object.values(bedAssignments).filter((patientId) => patientId === null).length;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-panel shadow-sm">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full bg-tracking/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-28 left-1/4 size-64 rounded-full bg-verified/10 blur-3xl"
      />

      <header className="relative flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-4 lg:px-5">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-tracking-strong">
            <Sparkles className="size-3.5" /> Live spatial command map
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-[18px] font-medium tracking-tight text-foreground">
              North Wing · Level 4
            </h2>
            <span className="text-[11px] text-muted-foreground">
              Select an occupied bed to open its Fluence workspace
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full border border-escalated/20 bg-escalated-soft px-2.5 py-1 text-[10.5px] font-medium text-escalated-strong">
            {urgentBeds} attention
          </span>
          <span className="rounded-full border border-tracking/20 bg-tracking-soft px-2.5 py-1 text-[10.5px] font-medium text-tracking-strong">
            {movingBeds} moving
          </span>
          <span className="rounded-full border border-border bg-background/70 px-2.5 py-1 text-[10.5px] font-medium text-muted-foreground">
            {emptyBeds} free
          </span>
        </div>
      </header>

      <div className="relative overflow-x-auto px-3 pb-4 pt-2 lg:px-5">
        <div className="relative mx-auto min-h-[390px] min-w-[720px] max-w-[900px] overflow-hidden rounded-2xl border border-white/70 bg-[linear-gradient(145deg,rgba(255,255,255,0.82),rgba(238,244,248,0.62))] px-6 pb-9 pt-8 shadow-inner">
          <div
            aria-hidden
            className="absolute inset-0 opacity-45"
            style={{
              backgroundImage:
                "linear-gradient(30deg, hsl(var(--border) / .45) 1px, transparent 1px), linear-gradient(150deg, hsl(var(--border) / .32) 1px, transparent 1px)",
              backgroundSize: "30px 18px",
            }}
          />
          <div
            aria-hidden
            className="absolute bottom-4 left-1/2 top-4 w-20 -translate-x-1/2 rounded-[50%] border-x border-dashed border-tracking/20 bg-white/25"
          />
          <div className="relative grid grid-cols-3 gap-5 [perspective:1100px]">
            {bays.map((bay, bayIndex) => (
              <section
                key={bay.id}
                className="relative rounded-2xl border border-white/80 bg-white/58 p-3 shadow-[0_18px_40px_rgba(45,62,80,0.10),0_5px_0_rgba(106,125,145,0.12)] backdrop-blur-sm"
                style={{
                  transform: `perspective(900px) rotateX(5deg) rotateZ(${bayIndex === 0 ? -1.5 : bayIndex === 2 ? 1.5 : 0}deg) translateY(${bayIndex === 1 ? 20 : 0}px)`,
                  transformStyle: "preserve-3d",
                }}
              >
                <div className="mb-3 flex items-center justify-between gap-2 px-1">
                  <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    <Building2 className="size-3" /> {bay.name}
                  </h3>
                  <span className="text-[9.5px] text-muted-foreground/70">3.2m corridor</span>
                </div>
                <div className="space-y-3">
                  {bay.beds.map((slot) => {
                    const patientId = bedAssignments[slot.bed] ?? null;
                    const patient =
                      patientId === null ? null : (patientById.get(patientId) ?? null);
                    const tone = patient === null ? "empty" : toneFor(patient.id);
                    const styles = toneStyles[tone];
                    const openThreads =
                      patient === null
                        ? []
                        : threadsFor(patient.id).filter((thread) => thread.status !== "verified");
                    const active = patient?.id === activePatientId;

                    return (
                      <button
                        key={slot.bed}
                        type="button"
                        onClick={() => {
                          if (patient) onOpenPatient(patient.id);
                          else setPlacementBed(slot.bed);
                        }}
                        aria-label={
                          patient
                            ? `Bed ${slot.bed}, ${patient.name}. Open patient workspace`
                            : `Bed ${slot.bed}, empty. Assign patient from EHR roster`
                        }
                        className={`liquid-press group relative w-full rounded-xl border px-3 py-2.5 text-left shadow-[0_8px_0_rgba(71,89,108,0.12),0_14px_22px_rgba(56,73,91,0.10)] transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_12px_0_rgba(71,89,108,0.12),0_20px_28px_rgba(56,73,91,0.13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tracking/45 ${styles.card} ${
                          active ? "ring-2 ring-tracking/40" : ""
                        }`}
                        style={{ transform: "translateZ(16px)" }}
                      >
                        <span
                          aria-hidden
                          className={`absolute inset-x-2 -bottom-[7px] h-[7px] rounded-b-lg ${styles.edge}`}
                        />
                        <span className="flex items-start justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="relative flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/70 bg-white/65 text-[10px] font-bold shadow-sm">
                              {patient ? initials(patient.name) : <BedDouble className="size-4" />}
                              <span
                                className={`absolute -right-1 -top-1 size-2.5 rounded-full border-2 border-white ${styles.dot}`}
                              />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-[12px] font-semibold text-foreground">
                                {patient?.name ?? "Assign from EHR"}
                              </span>
                              <span className="mt-0.5 block truncate text-[9.5px] font-medium">
                                {patient
                                  ? openThreads.length > 0
                                    ? `${openThreads.length} open · ${styles.label}`
                                    : styles.label
                                  : styles.label}
                              </span>
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1 rounded-md border border-white/70 bg-white/60 px-1.5 py-1 text-[10px] font-bold tabular-nums text-foreground shadow-sm">
                            {slot.bed}
                            {patient ? (
                              <ArrowUpRight className="size-2.5 opacity-55 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                            ) : (
                              <UserRoundPlus className="size-2.5 opacity-55" />
                            )}
                          </span>
                        </span>
                        {patient?.homeTomorrow && (
                          <span className="mt-2 flex items-center gap-1 text-[9.5px] font-medium text-pending-strong">
                            <Home className="size-2.5" /> Expected discharge tomorrow
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          <div className="relative mt-7 flex items-center justify-center gap-5 text-[9.5px] font-medium text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-escalated" /> Needs attention
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-tracking" /> Work in motion
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-pending" /> Discharge runway
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-verified" /> Stable / closed
            </span>
          </div>
        </div>
      </div>

      <footer className="relative flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-background/45 px-4 py-3 text-[10.5px] text-muted-foreground lg:px-5">
        <span className="flex items-center gap-1.5">
          <Route className="size-3.5 text-tracking-strong" /> Spatial context from the EHR ·
          follow-through from Fluence
        </span>
        <button
          type="button"
          onClick={onResetPlacements}
          className="liquid-press flex items-center gap-1.5 rounded-full border border-border bg-panel px-2.5 py-1 font-medium text-foreground transition-colors hover:bg-white"
        >
          <RotateCcw className="size-3" /> Reset demo placements
        </button>
      </footer>

      {placementBed && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-panel/88 p-4 backdrop-blur-md">
          <div className="max-h-[90%] w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-panel shadow-2xl">
            <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-4">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-tracking-strong">
                  <UserRoundPlus className="size-3.5" /> Assign from EHR roster
                </div>
                <h3 className="mt-1.5 text-[18px] font-medium tracking-tight text-foreground">
                  Place a patient in Bed {placementBed}
                </h3>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Selecting a patient moves their demo placement; clinical records remain
                  patient-scoped.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlacementBed(null)}
                aria-label="Close patient placement"
                className="liquid-press flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </header>
            <div className="max-h-[360px] overflow-y-auto p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                {patients.map((patient) => {
                  const currentBed = currentBedFor(patient.id);
                  const patientThreads = threadsFor(patient.id);
                  const alerting = patientThreads.some(isOverdue);
                  return (
                    <button
                      type="button"
                      key={patient.id}
                      onClick={() => {
                        onPlacePatient(patient.id, placementBed);
                        setPlacementBed(null);
                      }}
                      className="liquid-press group flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3 text-left transition-all hover:border-tracking/35 hover:bg-tracking-soft/45"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-panel text-[11px] font-semibold text-foreground shadow-sm">
                        {initials(patient.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium text-foreground">
                          {patient.name}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          {alerting && <CircleAlert className="size-3 text-escalated-strong" />}
                          {currentBed ? `Move from Bed ${currentBed}` : "Awaiting placement"}
                        </span>
                      </span>
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-panel text-muted-foreground transition-colors group-hover:border-tracking/30 group-hover:text-tracking-strong">
                        <Check className="size-3" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
