import { useMemo, useState, type ComponentType } from "react";
import {
  AudioLines,
  Check,
  ClipboardCheck,
  FileCheck2,
  HeartPulse,
  Route,
  Sparkles,
  UserRoundCheck,
} from "lucide-react";

import type { Thread } from "@/data/ward";
import { patients } from "@/data/ward";

type Props = {
  threads: Thread[];
  initialPatientId?: string | undefined;
  onOpenPatient: (id: string) => void;
};

type Stage = {
  label: string;
  shortLabel: string;
  detail: string;
  count: number;
  Icon: ComponentType<{ className?: string }>;
};

const stageTones = {
  complete: {
    node: "border-verified/45 bg-verified-soft text-verified-strong shadow-[0_0_0_5px_hsl(var(--verified)/0.07)]",
    count: "bg-verified/12 text-verified-strong",
  },
  current: {
    node: "border-tracking/55 bg-tracking-soft text-tracking-strong shadow-[0_0_0_6px_hsl(var(--tracking)/0.09)]",
    count: "bg-tracking/12 text-tracking-strong",
  },
  waiting: {
    node: "border-border bg-panel text-muted-foreground",
    count: "bg-background text-muted-foreground",
  },
} as const;

function taskHasClearedReview(thread: Thread): boolean {
  const state = thread.backend?.taskState;
  return state == null
    ? thread.status !== "pending" || Boolean(thread.assignee ?? thread.team)
    : state !== "draft";
}

function taskHasOwner(thread: Thread): boolean {
  return Boolean(thread.assignee ?? thread.team ?? thread.backend?.targetTeamId);
}

function sentenceCase(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function PatientJourneyMap({ threads, initialPatientId, onOpenPatient }: Props) {
  const patientOptions = useMemo(
    () => patients.filter((patient) => threads.some((thread) => thread.patientId === patient.id)),
    [threads],
  );
  const fallbackPatientId =
    patientOptions.find((patient) => patient.id === "p9")?.id ?? patientOptions[0]?.id ?? "p9";
  const [selectedPatientId, setSelectedPatientId] = useState(() =>
    patientOptions.some((patient) => patient.id === initialPatientId)
      ? (initialPatientId ?? fallbackPatientId)
      : fallbackPatientId,
  );
  const selectedPatient =
    patientOptions.find((patient) => patient.id === selectedPatientId) ?? patientOptions[0];
  const patientThreads = threads.filter((thread) => thread.patientId === selectedPatient?.id);
  const reviewed = patientThreads.filter(taskHasClearedReview);
  const routed = patientThreads.filter(taskHasOwner);
  const moving = patientThreads.filter(
    (thread) => thread.status === "tracking" || thread.status === "verified",
  );
  const verified = patientThreads.filter((thread) => thread.status === "verified");
  const activeThread =
    patientThreads.find((thread) => thread.status === "tracking") ??
    patientThreads.find((thread) => thread.status === "escalated") ??
    patientThreads.find((thread) => thread.status === "pending") ??
    patientThreads[0];

  const stages: Stage[] = [
    {
      label: "Heard at bedside",
      shortLabel: "Heard",
      detail: "Corti captures the commitment",
      count: patientThreads.length,
      Icon: AudioLines,
    },
    {
      label: "Clinician reviewed",
      shortLabel: "Reviewed",
      detail: "Human intent stays in control",
      count: reviewed.length,
      Icon: ClipboardCheck,
    },
    {
      label: "Safely routed",
      shortLabel: "Routed",
      detail: "Availability and capability checked",
      count: routed.length,
      Icon: Route,
    },
    {
      label: "Owned by a person",
      shortLabel: "Owned",
      detail: "One accountable next step",
      count: routed.filter((thread) => thread.assignee).length,
      Icon: UserRoundCheck,
    },
    {
      label: "Moving to completion",
      shortLabel: "In motion",
      detail: "Progress and readback stay visible",
      count: moving.length,
      Icon: HeartPulse,
    },
    {
      label: "Verified in the record",
      shortLabel: "Recorded",
      detail: "Independent closure reaches the EHR",
      count: verified.length,
      Icon: FileCheck2,
    },
  ];
  const furthestStage = stages.reduce(
    (furthest, stage, index) => (stage.count > 0 ? index : furthest),
    0,
  );
  const progress = stages.length === 1 ? 100 : (furthestStage / (stages.length - 1)) * 100;
  const openCount = patientThreads.length - verified.length;

  if (!selectedPatient) return null;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-panel px-4 py-4 shadow-sm lg:col-span-2 lg:px-5 lg:py-5">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full bg-tracking/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 left-1/3 size-64 rounded-full bg-verified/10 blur-3xl"
      />

      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-tracking-strong">
            <Sparkles className="size-3.5" />
            Patient journey · live follow-through
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-[20px] font-medium tracking-tight text-foreground">
              {selectedPatient.name}
            </h2>
            <span className="text-[12px] text-muted-foreground">
              Bed {selectedPatient.bed} · {selectedPatient.bay}
            </span>
          </div>
          <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-muted-foreground">
            {patientThreads.length} commitment{patientThreads.length === 1 ? "" : "s"} captured
            {openCount > 0
              ? ` · ${openCount} still moving through the ward`
              : " · every loop independently closed"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onOpenPatient(selectedPatient.id)}
          className="liquid-press rounded-full border border-border bg-white/55 px-3 py-1.5 text-[11.5px] font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:bg-white/85"
        >
          Open patient timeline →
        </button>
      </div>

      <div className="relative mt-4 flex gap-1.5 overflow-x-auto pb-1">
        {patientOptions.map((patient) => {
          const active = patient.id === selectedPatient.id;
          return (
            <button
              type="button"
              key={patient.id}
              onClick={() => setSelectedPatientId(patient.id)}
              aria-pressed={active}
              className={`liquid-press shrink-0 rounded-full border px-3 py-1.5 text-[11px] transition-all ${
                active
                  ? "border-tracking/35 bg-tracking-soft font-medium text-tracking-strong"
                  : "border-border bg-background/65 text-muted-foreground hover:text-foreground"
              }`}
            >
              {patient.bed} · {patient.name.split(" ").at(-1)}
            </button>
          );
        })}
      </div>

      <div className="relative mt-5 overflow-x-auto rounded-xl border border-border/80 bg-background/55">
        <div className="relative min-w-[680px] px-5 py-5">
          <div className="absolute left-[8.5%] right-[8.5%] top-[43px] h-[3px] overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-gradient-to-r from-tracking via-tracking to-verified transition-[width] duration-700"
              style={{ width: `${progress}%` }}
            />
            {openCount > 0 && (
              <span
                className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-tracking shadow-[0_0_14px_hsl(var(--tracking)/0.8)]"
                style={{ left: `${Math.max(3, progress)}%` }}
              />
            )}
          </div>

          <ol className="relative grid grid-cols-6 gap-3">
            {stages.map((stage, index) => {
              const state =
                stage.count > 0 ? "complete" : index === furthestStage + 1 ? "current" : "waiting";
              const tone = stageTones[state];
              return (
                <li key={stage.label} className="flex min-w-0 flex-col items-center text-center">
                  <div
                    className={`relative z-10 flex size-11 items-center justify-center rounded-full border transition-all duration-500 ${tone.node}`}
                  >
                    <stage.Icon className="size-[18px]" />
                    {state === "complete" && (
                      <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-verified text-white shadow-sm">
                        <Check className="size-2.5" strokeWidth={3} />
                      </span>
                    )}
                  </div>
                  <span
                    className={`mt-3 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${tone.count}`}
                  >
                    {stage.count}
                  </span>
                  <h3 className="mt-1.5 text-[11.5px] font-medium leading-tight text-foreground">
                    {stage.shortLabel}
                  </h3>
                  <p className="mt-1 text-[9.5px] leading-snug text-muted-foreground">
                    {stage.detail}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <div className="relative mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0 rounded-lg border border-border/70 bg-background/55 px-3 py-2.5">
          <p className="truncate text-[12px] font-medium text-foreground">
            {activeThread?.title ?? "No active follow-through item"}
          </p>
          <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">
            {activeThread
              ? `${sentenceCase(activeThread.status)} · ${sentenceCase(activeThread.assignee ?? activeThread.team ?? activeThread.backend?.targetTeamId ?? "awaiting safe routing")}`
              : "The journey will light up when a commitment is captured."}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[10.5px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-tracking" /> Live movement
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-verified" /> Independently verified
          </span>
        </div>
      </div>
    </section>
  );
}
