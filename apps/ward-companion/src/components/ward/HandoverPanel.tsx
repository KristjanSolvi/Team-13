import { useEffect, useState } from "react";
import { Check, Copy, Download, FileText, LoaderCircle, ShieldCheck } from "lucide-react";
import type { Patient } from "@/data/ward";
import {
  demoActors,
  FollowThroughApiError,
  requestPatientHandover,
  type GroundedHandover,
} from "@/lib/follow-through-api";
import { recordCortiActivity } from "@/lib/corti-activity";

type Props = { patient: Patient };

function errorMessage(error: unknown): string {
  if (error instanceof FollowThroughApiError) {
    if (error.code === "HANDOVER_NOT_CONFIGURED") {
      return "The handover agent is not provisioned · set CORTI_HANDOVER_AGENT_ID and run agent provisioning.";
    }
    if (error.code === "REQUEST_FAILED" && error.message.includes("401")) {
      return "Handover access token missing · set INTEGRATION_API_BEARER_TOKEN for the UI dev server.";
    }
    if (error.code === "PATIENT_NOT_FOUND") {
      return "This patient is not present in the Agentic record store yet. Refresh after the ward roster has synchronized.";
    }
    return `${error.message}${error.retryable ? " · safe to retry" : ""}`;
  }
  return "The handover could not be generated; nothing was saved.";
}

function handoverDocument(patient: Patient, handover: GroundedHandover): string {
  if (handover.rendered == null) return "";
  return [
    "FLUENCE PATIENT HANDOVER",
    `Patient: ${patient.name}`,
    "Status: Saved draft — not sent automatically",
    `Handover ID: ${handover.handoverId}`,
    "",
    handover.rendered.title,
    ...handover.rendered.sections
      .filter((section) => section.statements.length > 0)
      .flatMap((section) => [
        `\n${section.heading}`,
        ...section.statements.map((statement) => `- ${statement.statement}`),
      ]),
    "",
    `Source snapshot: ${handover.sourceSnapshotHash}`,
  ].join("\n");
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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setHandover(null);
    setError(null);
    setBusy(false);
    setCopied(false);
  }, [patient.id]);

  const generate = async () => {
    if (busy || patient.agenticLinked !== true) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestPatientHandover({
        patientId: patient.pipelinePatientId,
        actorId: demoActors.clinician,
        correlationId: crypto.randomUUID(),
      });
      setHandover(result);
      recordCortiActivity({
        product: "agentic",
        status: "completed",
        action: "Fresh handover context assembled through patient-scoped MCP",
      });
      if (result.rendered === null) {
        setError("The handover packet was saved but prose rendering is still pending.");
      } else {
        recordCortiActivity({
          product: "text-generation",
          status: "completed",
          action: "Evidence-linked handover rendered for clinician review",
          credits: result.rendered.creditsConsumed,
        });
      }
    } catch (requestError) {
      recordCortiActivity({
        product: "agentic",
        status: "unavailable",
        action: "Handover agent did not return a current evidence packet",
      });
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  const copyForHandover = async () => {
    if (handover?.rendered == null) return;
    try {
      await navigator.clipboard.writeText(handoverDocument(patient, handover));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setError("The draft is saved, but it could not be copied from this browser.");
    }
  };

  const downloadHandover = () => {
    if (handover?.rendered == null) return;
    const blob = new Blob([handoverDocument(patient, handover)], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const patientSlug = patient.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    link.href = url;
    link.download = `fluence-handover-${patientSlug || patient.id}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded-xl border border-border bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div>
          <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
            <FileText className="size-3.5 text-teal" />
            Patient handover
          </span>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            Corti creates an evidence-linked draft from the current record and open work, then saves
            it to this patient&apos;s Fluence record for clinician review.
          </p>
        </div>
        <button
          onClick={() => void generate()}
          disabled={busy || patient.agenticLinked !== true}
          className="flex items-center gap-1.5 rounded-md bg-teal px-3 py-1.5 text-[12.5px] font-medium text-panel disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy && <LoaderCircle className="size-3.5 animate-spin" />}
          {busy
            ? "Agent gathering context…"
            : patient.agenticLinked !== true
              ? "Agentic not connected"
              : handover === null
                ? "Generate & save draft"
                : "Regenerate draft"}
        </button>
      </header>

      {patient.agenticLinked !== true && (
        <p className="px-4 py-2.5 text-[12px] text-muted-foreground">
          Patient-scoped Agentic tools are unavailable for this roster entry; no request was sent.
        </p>
      )}

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
            Saved as a patient-scoped draft · refused if sources changed while generating · snapshot{" "}
            {handover.sourceSnapshotHash.slice(0, 19)}…
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-pending-soft px-3 py-2">
            <p className="text-[10.5px] leading-relaxed text-pending-strong">
              <span className="font-semibold">Saved draft · not sent.</span> Copy it into the
              receiving team&apos;s existing handover channel; no notification is sent
              automatically.
            </p>
            <div className="flex shrink-0 gap-1.5">
              <button
                type="button"
                onClick={() => void copyForHandover()}
                className="flex items-center gap-1.5 rounded-md border border-pending/25 bg-panel px-2.5 py-1.5 text-[11.5px] font-medium text-foreground"
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={downloadHandover}
                className="flex items-center gap-1.5 rounded-md border border-pending/25 bg-panel px-2.5 py-1.5 text-[11.5px] font-medium text-foreground"
              >
                <Download className="size-3.5" /> Download .txt
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
