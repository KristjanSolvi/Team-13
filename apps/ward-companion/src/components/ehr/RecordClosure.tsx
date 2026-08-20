import { useEffect, useMemo, useState } from "react";
import { Check, FileCheck2, LoaderCircle, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";

import type { CaseNote, DocId } from "@/data/ward";
import {
  createEhrDocument,
  fileEhrDocument,
  FollowThroughApiError,
  generateSupportingDocument,
  getEhrDocumentHistory,
  predictMedicalCodes,
  reviseEhrDocument,
  type ClinicalDocument,
  type ClinicalDocumentVersion,
} from "@/lib/follow-through-api";

const clinicianActorId = "clinician:marriott";

type Props = {
  patientId: string;
  category: DocId;
  notes: CaseNote[];
  onDocumentChange: (document: ClinicalDocument) => void;
};

type BusyAction = "generate" | "save" | "file" | null;

function clinicalSource(notes: CaseNote[]): string {
  return notes.map((note) => `[${note.at}] ${note.author}: ${note.text}`).join("\n\n");
}

function generatedText(sections: Array<{ heading: string; text: string }>): string {
  return sections.map((section) => `${section.heading}\n${section.text.trim()}`).join("\n\n");
}

function messageFor(error: unknown): string {
  if (error instanceof FollowThroughApiError) {
    return `${error.message}${error.retryable ? " You can safely retry." : ""}`;
  }
  return "The service could not complete this step.";
}

function timestamp(value: string | null): string {
  if (value === null) return "";
  return new Date(value).toLocaleString([], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RecordClosure({ patientId, category, notes, onDocumentChange }: Props) {
  const initialSource = useMemo(() => clinicalSource(notes), [notes]);
  const [source, setSource] = useState(initialSource);
  const [reviewed, setReviewed] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [codes, setCodes] = useState<Awaited<ReturnType<typeof predictMedicalCodes>> | null>(null);
  const [document, setDocument] = useState<ClinicalDocument | null>(null);
  const [history, setHistory] = useState<ClinicalDocumentVersion[]>([]);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [codingError, setCodingError] = useState<string | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);

  useEffect(() => {
    setSource(initialSource);
    setReviewed(false);
    setReviewId(null);
    setTitle("");
    setContent("");
    setCodes(null);
    setDocument(null);
    setHistory([]);
    setBusy(null);
    setGenerationError(null);
    setCodingError(null);
    setRecordError(null);
  }, [category, initialSource, patientId]);

  const hasGeneratedDraft = reviewId !== null && title.trim() !== "" && content.trim() !== "";
  const documentIsDirty =
    document !== null && (document.title !== title.trim() || document.content !== content.trim());
  const canGenerate = source.trim() !== "" && reviewed && busy === null;
  const canSave = hasGeneratedDraft && document?.status !== "filed" && busy === null;
  const canFile = document?.status === "draft" && !documentIsDirty && busy === null;

  const refreshHistory = async (documentId: string) => {
    const result = await getEhrDocumentHistory(documentId, crypto.randomUUID());
    setHistory(result.versions);
  };

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setBusy("generate");
    setGenerationError(null);
    setCodingError(null);
    setRecordError(null);
    const approvalId = `record-review-${crypto.randomUUID()}`;
    const correlationId = crypto.randomUUID();
    const [documentResult, codingResult] = await Promise.allSettled([
      generateSupportingDocument({
        approvalId,
        approvedClinicalText: source.trim(),
        documentType: category === "discharge" ? "receiving-team-handoff" : "clinical-note",
        correlationId,
      }),
      predictMedicalCodes({
        approvalId,
        approvedClinicalText: source.trim(),
        correlationId,
      }),
    ]);

    if (documentResult.status === "fulfilled") {
      setReviewId(approvalId);
      setTitle(documentResult.value.name);
      setContent(generatedText(documentResult.value.sections));
    } else {
      setGenerationError(messageFor(documentResult.reason));
    }
    if (codingResult.status === "fulfilled") {
      setCodes(codingResult.value);
    } else {
      setCodingError(messageFor(codingResult.reason));
    }
    setBusy(null);
  };

  const handleSave = async () => {
    if (!canSave) return;
    setBusy("save");
    setRecordError(null);
    try {
      const correlationId = crypto.randomUUID();
      const saved =
        document === null
          ? await createEhrDocument({
              patientId,
              actorId: clinicianActorId,
              correlationId,
              idempotencyKey: `record-create-${crypto.randomUUID()}`,
              category,
              title: title.trim(),
              content: content.trim(),
              source: "agent",
            })
          : documentIsDirty
            ? await reviseEhrDocument({
                documentId: document.documentId,
                actorId: clinicianActorId,
                correlationId,
                expectedVersion: document.version,
                idempotencyKey: `record-revise-${crypto.randomUUID()}`,
                reason: "Clinician reviewed the generated draft",
                changes: { title: title.trim(), content: content.trim() },
              })
            : document;
      setDocument(saved);
      onDocumentChange(saved);
      await refreshHistory(saved.documentId);
    } catch (error) {
      setRecordError(messageFor(error));
    } finally {
      setBusy(null);
    }
  };

  const handleFile = async () => {
    if (!canFile || document === null) return;
    setBusy("file");
    setRecordError(null);
    try {
      const filed = await fileEhrDocument({
        documentId: document.documentId,
        actorId: clinicianActorId,
        correlationId: crypto.randomUUID(),
        expectedVersion: document.version,
        idempotencyKey: `record-file-${crypto.randomUUID()}`,
        reason: "Clinician approved this version for the patient record",
      });
      setDocument(filed);
      onDocumentChange(filed);
      await refreshHistory(filed.documentId);
    } catch (error) {
      setRecordError(messageFor(error));
    } finally {
      setBusy(null);
    }
  };

  const startOver = () => {
    setSource(initialSource);
    setReviewed(false);
    setReviewId(null);
    setTitle("");
    setContent("");
    setCodes(null);
    setDocument(null);
    setHistory([]);
    setGenerationError(null);
    setCodingError(null);
    setRecordError(null);
  };

  return (
    <section className="border border-ehr-accent/35 bg-ehr-accent/[0.035]">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-ehr-accent/20 px-3 py-2">
        <div>
          <div className="flex items-center gap-1.5">
            <FileCheck2 className="size-3.5 text-ehr-accent" aria-hidden="true" />
            <h3 className="text-[11px] font-semibold text-ehr-foreground">Record closure</h3>
          </div>
          <p className="mt-0.5 text-[10px] text-ehr-muted">
            Review the source, draft with Corti, then file one explicit version.
          </p>
        </div>
        {document !== null && (
          <span
            className={`px-1.5 py-0.5 text-[10px] font-semibold ${
              document.status === "filed"
                ? "bg-verified-soft text-verified-strong"
                : "bg-pending-soft text-pending-strong"
            }`}
          >
            {document.status === "filed" ? "Filed" : `Draft v${document.version}`}
          </span>
        )}
      </header>

      <div className="space-y-3 p-3">
        {!hasGeneratedDraft ? (
          <>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ehr-muted">
                Clinical source for review
              </span>
              <textarea
                value={source}
                onChange={(event) => {
                  setSource(event.target.value);
                  setReviewed(false);
                }}
                rows={6}
                placeholder="Add the clinician-reviewed clinical context to use for this document."
                className="mt-1 w-full resize-y border border-ehr-line bg-ehr-bg px-2 py-1.5 text-[11px] leading-snug outline-none focus:border-ehr-accent"
              />
            </label>
            <label className="flex items-start gap-2 text-[10px] leading-snug text-ehr-foreground">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(event) => setReviewed(event.target.checked)}
                className="mt-0.5 accent-[var(--ehr-accent)]"
              />
              <span>
                I reviewed this source text. Corti may use it to create a draft and coding
                suggestions; neither will be filed automatically.
              </span>
            </label>
            <button
              type="button"
              disabled={!canGenerate}
              onClick={() => void handleGenerate()}
              className="inline-flex items-center gap-1.5 bg-ehr-chrome px-3 py-1.5 text-[10px] font-semibold text-ehr-chrome-foreground disabled:cursor-not-allowed disabled:opacity-45"
            >
              {busy === "generate" ? (
                <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="size-3" aria-hidden="true" />
              )}
              Generate draft and codes
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-verified-strong">
                <ShieldCheck className="size-3" aria-hidden="true" />
                Clinician-reviewed source · Corti draft
              </span>
              {document === null && (
                <button
                  type="button"
                  onClick={startOver}
                  className="inline-flex items-center gap-1 text-[10px] text-ehr-muted hover:text-ehr-foreground"
                >
                  <RotateCcw className="size-3" aria-hidden="true" />
                  Start over
                </button>
              )}
            </div>

            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ehr-muted">
                Document title
              </span>
              <input
                value={title}
                disabled={document?.status === "filed"}
                onChange={(event) => setTitle(event.target.value)}
                className="mt-1 w-full border border-ehr-line bg-ehr-bg px-2 py-1.5 text-[11px] font-semibold outline-none focus:border-ehr-accent disabled:opacity-75"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ehr-muted">
                Draft content
              </span>
              <textarea
                value={content}
                disabled={document?.status === "filed"}
                onChange={(event) => setContent(event.target.value)}
                rows={9}
                className="mt-1 w-full resize-y border border-ehr-line bg-ehr-bg px-2 py-1.5 text-[11px] leading-snug outline-none focus:border-ehr-accent disabled:opacity-75"
              />
            </label>

            <div className="border border-ehr-line bg-ehr-panel p-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-ehr-muted">
                  Coding suggestions
                </h4>
                {codes !== null && (
                  <span className="text-[9px] text-ehr-muted">{codes.system}</span>
                )}
              </div>
              {codingError !== null ? (
                <p className="mt-1 text-[10px] text-escalated-strong">{codingError}</p>
              ) : codes === null ? (
                <p className="mt-1 text-[10px] text-ehr-muted">Coding request still pending.</p>
              ) : codes.codes.length + codes.candidates.length === 0 ? (
                <p className="mt-1 text-[10px] text-ehr-muted">
                  Corti returned no reviewable code suggestions for this source.
                </p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {[...codes.codes, ...codes.candidates].slice(0, 5).map((code, index) => (
                    <li
                      key={`${code.code}-${index}`}
                      className="flex items-start justify-between gap-2 border-t border-ehr-line/70 pt-1 first:border-0 first:pt-0"
                    >
                      <span className="min-w-0 text-[10px] leading-snug">
                        <span className="font-semibold text-ehr-foreground">{code.code}</span>{" "}
                        {code.display}
                        {code.evidences[0] !== undefined && (
                          <span className="mt-0.5 block truncate text-[9px] text-ehr-muted">
                            Evidence: “{code.evidences[0].text}”
                          </span>
                        )}
                      </span>
                      <span
                        className={`shrink-0 text-[9px] ${
                          code.evidenceStatus === "validated"
                            ? "text-verified-strong"
                            : "text-ehr-muted"
                        }`}
                      >
                        {code.evidenceStatus === "validated" ? "Evidence checked" : "Review"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {document?.status !== "filed" && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!canSave}
                  onClick={() => void handleSave()}
                  className="inline-flex items-center gap-1.5 border border-ehr-chrome bg-ehr-panel px-3 py-1.5 text-[10px] font-semibold text-ehr-foreground disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {busy === "save" && (
                    <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
                  )}
                  {document === null
                    ? "Save EHR draft"
                    : documentIsDirty
                      ? "Save new version"
                      : "Draft saved"}
                </button>
                <button
                  type="button"
                  disabled={!canFile}
                  onClick={() => void handleFile()}
                  className="inline-flex items-center gap-1.5 bg-ehr-chrome px-3 py-1.5 text-[10px] font-semibold text-ehr-chrome-foreground disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {busy === "file" ? (
                    <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <FileCheck2 className="size-3" aria-hidden="true" />
                  )}
                  File to record
                </button>
                {documentIsDirty && (
                  <span className="text-[10px] text-pending-strong">
                    Save this edited version before filing.
                  </span>
                )}
              </div>
            )}

            {document?.status === "filed" && (
              <div className="flex items-start gap-2 border border-verified/35 bg-verified-soft p-2 text-[10px] text-verified-strong">
                <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  Filed by {document.filedBy} at {timestamp(document.filedAt)}. This version is
                  immutable; corrections require a new document.
                </span>
              </div>
            )}

            {history.length > 0 && (
              <div>
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-ehr-muted">
                  Version history
                </h4>
                <ol className="mt-1 flex flex-wrap gap-1.5">
                  {history.map((version) => (
                    <li
                      key={`${version.documentId}-${version.version}`}
                      title={version.changeReason}
                      className="border border-ehr-line bg-ehr-bg px-1.5 py-1 text-[9px] text-ehr-muted"
                    >
                      v{version.version} · {version.status} · {version.updatedBy}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}

        {generationError !== null && (
          <p role="alert" className="text-[10px] text-escalated-strong">
            Draft generation: {generationError}
          </p>
        )}
        {recordError !== null && (
          <p role="alert" className="text-[10px] text-escalated-strong">
            EHR filing: {recordError}
          </p>
        )}
      </div>
    </section>
  );
}
