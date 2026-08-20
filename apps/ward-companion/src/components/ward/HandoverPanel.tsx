import { useEffect, useState } from "react";
import { FileText, LoaderCircle, ShieldCheck } from "lucide-react";
import type { Patient } from "@/data/ward";
import {
  demoActors,
  FollowThroughApiError,
  requestPatientHandover,
  type GroundedHandover,
} from "@/lib/follow-through-api";

type Props = { patient: Patient };

function errorMessage(error: unknown): string {
  if (error instanceof FollowThroughApiError) {
    if (error.code === "HANDOVER_NOT_CONFIGURED") {
      return "The handover agent is not provisioned · set CORTI_HANDOVER_AGENT_ID and run agent provisioning.";
    }
    if (error.code === "REQUEST_FAILED" && error.message.includes("401")) {
      return "Handover access token missing · set INTEGRATION_API_BEARER_TOKEN for the UI dev server.";
    }
    return `${error.message}${error.retryable ? " · safe to retry" : ""}`;
  }
  return "The handover could not be generated; nothing was saved.";
}

/**
 * On-demand grounded handover: a fresh Corti Agentic context gathers the
 * record, open threads, and task state through MCP, saves an evidence-linked
 * packet, and Corti Text Generation renders it as prose. Stale drafts are
 * refused upstream, so anything shown here is current by construction.
 */
export function HandoverPanel({ patient }: Props) {
  const [busy, setBusy] = useState(false);
  const [handover, setHandover] = useState<GroundedHandover | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHandover(null);
    setError(null);
    setBusy(false);
  }, [patient.id]);

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestPatientHandover({
        patientId: patient.pipelinePatientId,
        actorId: demoActors.clinician,
        correlationId: crypto.randomUUID(),
      });
      setHandover(result);
      if (result.rendered === null) {
        setError("The handover packet was saved but prose rendering is still pending.");
      }
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div>
          <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
            <FileText className="size-3.5 text-teal" />
            Grounded handover · Corti agent
          </span>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            A fresh agent context reads the record and open work through MCP, then Corti Text
            Generation writes the handover. Every statement keeps its evidence.
          </p>
        </div>
        <button
          onClick={() => void generate()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md bg-teal px-3 py-1.5 text-[12.5px] font-medium text-panel disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy && <LoaderCircle className="size-3.5 animate-spin" />}
          {busy
            ? "Agent gathering context…"
            : handover === null
              ? `Generate for ${patient.name.split(" ").slice(-1)[0]}`
              : "Regenerate"}
        </button>
      </header>

      {error !== null && (
        <p role="alert" className="px-4 py-2.5 text-[12px] text-escalated-strong">
          {error}
        </p>
      )}

      {handover !== null && handover.rendered !== null && (
        <div className="space-y-3 px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-[13.5px] font-medium text-foreground">{handover.rendered.title}</h4>
            <span className="text-[10.5px] tabular-nums text-muted-foreground">
              Text Generation · {handover.rendered.creditsConsumed.toFixed(4)} credits
            </span>
          </div>
          {handover.rendered.sections
            .filter((section) => section.statements.length > 0)
            .map((section) => (
              <section key={section.sectionId}>
                <h5 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {section.heading}
                </h5>
                <ul className="space-y-1">
                  {section.statements.map((statement, index) => (
                    <li
                      key={`${section.sectionId}-${index}`}
                      className="flex items-start justify-between gap-3 text-[12.5px] leading-relaxed text-foreground"
                    >
                      <span>{statement.statement}</span>
                      {statement.sourceRefs.length > 0 && (
                        <span
                          title={statement.sourceRefs.join("\n")}
                          className="shrink-0 rounded border border-border px-1 py-px text-[9.5px] text-muted-foreground"
                        >
                          {statement.sourceRefs.length} source
                          {statement.sourceRefs.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          <p className="flex items-start gap-1.5 border-t border-border pt-2 text-[10.5px] text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3 shrink-0 text-teal" />
            Draft for the receiving clinician · refused if sources changed while generating ·
            snapshot {handover.sourceSnapshotHash.slice(0, 19)}…
          </p>
        </div>
      )}
    </section>
  );
}
