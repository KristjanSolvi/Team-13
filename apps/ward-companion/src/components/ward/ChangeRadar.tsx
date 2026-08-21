import { ArrowRight, GitBranch, Radar, RefreshCw, ShieldAlert } from "lucide-react";
import { useState } from "react";
import type { AuthoritativeSyncState, Patient, Thread } from "@/data/ward";
import {
  type ChangeImpact,
  FollowThroughApiError,
  simulateSyntheticSourceRevision,
} from "@/lib/follow-through-api";
import { Spinner } from "./Loading";

type Props = {
  patient: Patient;
  threads: Thread[];
  impacts: ChangeImpact[] | null;
  syncState: AuthoritativeSyncState;
  onRefresh: () => Promise<void>;
};

const reasonLabels: Record<ChangeImpact["reason"], string> = {
  new_result: "New result",
  medication_update: "Medication update",
  clinical_note_revision: "Clinical note revised",
  other: "Source revised",
};

export function ChangeRadar({ patient, threads, impacts, syncState, onRefresh }: Props) {
  const [simulating, setSimulating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const impactCount = impacts?.length ?? 0;
  const waiting = syncState === "idle" || syncState === "syncing";
  const unavailable = syncState === "unavailable";
  const canSimulate =
    impacts !== null &&
    patient.pipelinePatientId === "synthetic-karen" &&
    impactCount === 0 &&
    threads.some((thread) => thread.backend?.evidenceRefs.includes("encounter:sentence-42"));

  const simulate = async () => {
    setSimulating(true);
    setError(null);
    try {
      await simulateSyntheticSourceRevision({
        patientId: patient.pipelinePatientId,
        actorId: "clinician:ward-demo",
        correlationId: crypto.randomUUID(),
        idempotencyKey: `change-radar-${crypto.randomUUID()}`,
      });
      await onRefresh();
    } catch (caught) {
      setError(
        caught instanceof FollowThroughApiError
          ? caught.message
          : "The synthetic source revision could not be recorded.",
      );
    } finally {
      setSimulating(false);
    }
  };

  const retry = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section
      className={`rounded-xl border px-4 py-3 ${
        impactCount > 0
          ? "border-escalated/35 bg-escalated-soft/55"
          : "border-border bg-background/65"
      }`}
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={`mt-0.5 rounded-lg p-1.5 ${
              impactCount > 0 ? "bg-escalated/15 text-escalated-strong" : "bg-teal/10 text-teal"
            }`}
          >
            {impactCount > 0 ? <ShieldAlert className="size-4" /> : <Radar className="size-4" />}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[12px] font-semibold uppercase tracking-widest text-foreground">
                Change Radar
              </h3>
              <span className="rounded-full border border-current/15 px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
                {unavailable
                  ? "Sync unavailable"
                  : waiting
                    ? "Syncing"
                    : impactCount > 0
                      ? `${impactCount} review required`
                      : "No changes detected"}
              </span>
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              {unavailable
                ? "The authoritative ledger could not be reached. Local work is unchanged; retry when services recover."
                : waiting
                  ? "Reading source versions and linked work from the authoritative ledger…"
                  : impactCount > 0
                    ? "Evidence changed after downstream work was created. Nothing was altered automatically."
                    : "Watching linked evidence for changes that could affect tracked work."}
            </p>
          </div>
        </div>
        {unavailable ? (
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void retry()}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 py-1.5 text-[11.5px] font-medium text-foreground hover:bg-background disabled:opacity-45"
          >
            {refreshing ? <Spinner className="size-3" /> : <RefreshCw className="size-3" />}
            {refreshing ? "Retrying…" : "Retry sync"}
          </button>
        ) : canSimulate ? (
          <button
            type="button"
            disabled={simulating}
            onClick={() => void simulate()}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 py-1.5 text-[11.5px] font-medium text-foreground hover:bg-background disabled:opacity-45"
          >
            {simulating ? <Spinner className="size-3" /> : <GitBranch className="size-3" />}
            {simulating ? "Revising…" : "Run demo"}
          </button>
        ) : null}
      </div>

      {error !== null && (
        <p className="mt-2 rounded-md bg-escalated-soft px-2.5 py-2 text-[12px] text-escalated-strong">
          {error}
        </p>
      )}

      {impacts !== null && impactCount > 0 && (
        <ul className="mt-3 space-y-2 border-t border-escalated/20 pt-3">
          {impacts.map((impact) => {
            const linkedTask = threads.find(
              (thread) => thread.backend?.taskId === impact.artifactId,
            );
            return (
              <li key={impact.impactId} className="rounded-lg bg-panel/70 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] font-medium text-foreground">
                  <span>{impact.sourceRef}</span>
                  <ArrowRight className="size-3 text-muted-foreground" />
                  <span>
                    {impact.artifactKind === "task"
                      ? (linkedTask?.title ?? `Task ${impact.artifactId.slice(0, 8)}`)
                      : `Handover ${impact.artifactId.slice(0, 8)}`}
                  </span>
                  <span className="text-muted-foreground">v{impact.artifactVersion}</span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  {reasonLabels[impact.reason]} · {impact.summary}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
