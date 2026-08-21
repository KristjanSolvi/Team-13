import { useEffect, useMemo, useState } from "react";
import { Check, FileCheck2, LoaderCircle, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import type {
  CodingSystem,
  NormalizedCodeSuggestion,
  NormalizedCodingEvidence,
} from "@pipeline/contracts.js";

import type { CaseNote, DocId } from "@/data/ward";
import { recordCortiActivity } from "@/lib/corti-activity";
import {
  createEhrDocument,
  fileEhrDocument,
  FollowThroughApiError,
  generateSupportingDocument,
  getEhrDocumentHistory,
  predictMedicalCodes,
  reviseEhrDocument,
  type CodingReviewInput,
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

type BusyAction = "generate" | "save" | "file" | "receipt" | null;

type SelectedCodingSuggestion = {
  group: "supported" | "candidate";
  index: number;
};

const codingSystemLabels: Record<CodingSystem, string> = {
  "icd10int-outpatient": "ICD-10 International · outpatient",
  "icd10int-inpatient": "ICD-10 International · inpatient",
  "icd10cm-outpatient": "ICD-10-CM · outpatient",
  "icd10cm-inpatient": "ICD-10-CM · inpatient",
};

function creditsLabel(credits: number): string {
  return `${credits.toFixed(4)} credits`;
}

function highlightedSource(source: string, evidence: NormalizedCodingEvidence | undefined) {
  if (
    evidence === undefined ||
    evidence.start < 0 ||
    evidence.end <= evidence.start ||
    evidence.end > source.length
  ) {
    return source;
  }
  return (
    <>
      {source.slice(0, evidence.start)}
      <mark className="bg-pending-soft text-ehr-foreground">
        {source.slice(evidence.start, evidence.end)}
      </mark>
      {source.slice(evidence.end)}
    </>
  );
}

function CodingSuggestionGroup({
  title,
  kind,
  suggestions,
  selected,
  onSelect,
}: {
  title: string;
  kind: SelectedCodingSuggestion["group"];
  suggestions: NormalizedCodeSuggestion[];
  selected: SelectedCodingSuggestion | null;
  onSelect: (selection: SelectedCodingSuggestion) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <section>
      <h5 className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-ehr-muted">
        {title} · {suggestions.length}
      </h5>
      <ul className="space-y-1">
        {suggestions.map((suggestion, index) => {
          const isSelected = selected?.group === kind && selected.index === index;
          return (
            <li key={`${kind}-${suggestion.code}-${index}`}>
              <button
                type="button"
                onClick={() => onSelect({ group: kind, index })}
                className={`w-full border px-2 py-1.5 text-left ${
                  isSelected
                    ? "border-ehr-accent bg-ehr-accent/[0.07]"
                    : "border-ehr-line bg-ehr-bg hover:border-ehr-accent/55"
                }`}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0 text-[10px] leading-snug">
                    <span className="font-semibold text-ehr-foreground">{suggestion.code}</span>{" "}
                    {suggestion.display}
                  </span>
                  <span
                    className={`shrink-0 text-[8.5px] font-semibold uppercase tracking-wide ${
                      kind === "supported" ? "text-verified-strong" : "text-pending-strong"
                    }`}
                  >
                    {kind === "supported" ? "Code" : "Candidate"}
                  </span>
                </span>
                {suggestion.evidences[0] !== undefined && (
                  <span className="mt-0.5 block truncate text-[9px] text-ehr-muted">
                    “{suggestion.evidences[0].text}”
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

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

function sameCodingReview(
  persisted: ClinicalDocument["codingReview"] | undefined,
  proposed: CodingReviewInput | null,
): boolean {
  if (persisted == null || proposed === null) return persisted == null && proposed === null;
  return (
    JSON.stringify({
      outcome: persisted.outcome,
      approvalId: persisted.approvalId,
      system: persisted.system,
      selectedCode: persisted.selectedCode,
    }) === JSON.stringify(proposed)
  );
}

export function RecordClosure({ patientId, category, notes, onDocumentChange }: Props) {
  const initialSource = useMemo(() => clinicalSource(notes), [notes]);
  const [source, setSource] = useState(initialSource);
  const [reviewed, setReviewed] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [codingSystem, setCodingSystem] = useState<CodingSystem>("icd10int-outpatient");
  const [codes, setCodes] = useState<Awaited<ReturnType<typeof predictMedicalCodes>> | null>(null);
  const [selectedCoding, setSelectedCoding] = useState<SelectedCodingSuggestion | null>(null);
  const [codingDecision, setCodingDecision] = useState<"accepted" | "rejected" | null>(null);
  const [documentCredits, setDocumentCredits] = useState<number | null>(null);
  const [codingCredits, setCodingCredits] = useState<number | null>(null);
  const [document, setDocument] = useState<ClinicalDocument | null>(null);
  const [history, setHistory] = useState<ClinicalDocumentVersion[]>([]);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [receipt, setReceipt] = useState<{
    title: string;
    content: string;
    credits: number;
  } | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [codingError, setCodingError] = useState<string | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);

  useEffect(() => {
    setSource(initialSource);
    setReviewed(false);
    setReviewId(null);
    setTitle("");
    setContent("");
    setCodingSystem("icd10int-outpatient");
    setCodes(null);
    setSelectedCoding(null);
    setCodingDecision(null);
    setDocumentCredits(null);
    setCodingCredits(null);
    setDocument(null);
    setHistory([]);
    setBusy(null);
    setReceipt(null);
    setReceiptError(null);
    setGenerationError(null);
    setCodingError(null);
    setRecordError(null);
  }, [category, initialSource, patientId]);

  const hasGeneratedDraft = reviewId !== null && title.trim() !== "" && content.trim() !== "";
  const selectedCode =
    selectedCoding?.group === "supported"
      ? codes?.codes[selectedCoding.index]
      : selectedCoding?.group === "candidate"
        ? codes?.candidates[selectedCoding.index]
        : undefined;
  const suggestionCount = codes === null ? 0 : codes.codes.length + codes.candidates.length;
  const codingReview: CodingReviewInput | null =
    reviewId === null
      ? null
      : codingError !== null
        ? {
            outcome: "unavailable",
            approvalId: reviewId,
            system: codingSystem,
            selectedCode: null,
          }
        : codes === null
          ? null
          : suggestionCount === 0
            ? {
                outcome: "no-suggestions",
                approvalId: reviewId,
                system: codes.system,
                selectedCode: null,
              }
            : codingDecision === "rejected"
              ? {
                  outcome: "rejected",
                  approvalId: reviewId,
                  system: codes.system,
                  selectedCode: null,
                }
              : codingDecision === "accepted" && selectedCode !== undefined
                ? {
                    outcome: "accepted",
                    approvalId: reviewId,
                    system: codes.system,
                    selectedCode: {
                      suggestionKind:
                        selectedCoding?.group === "supported" ? "supported" : "candidate",
                      code: selectedCode.code,
                      display: selectedCode.display,
                      evidenceStatus: selectedCode.evidenceStatus,
                      evidences: selectedCode.evidences.map((evidence) => ({
                        text: evidence.text,
                        start: evidence.start,
                        end: evidence.end,
                      })),
                    },
                  }
                : null;
  const documentIsDirty =
    document !== null &&
    (document.title !== title.trim() ||
      document.content !== content.trim() ||
      !sameCodingReview(document.codingReview, codingReview));
  const codingReviewComplete = codingReview !== null;
  const canGenerate = source.trim() !== "" && reviewed && busy === null;
  const canSave =
    hasGeneratedDraft && codingReviewComplete && document?.status !== "filed" && busy === null;
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
    setDocumentCredits(null);
    setCodingCredits(null);
    setSelectedCoding(null);
    setCodingDecision(null);
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
        system: codingSystem,
        correlationId,
      }),
    ]);

    if (documentResult.status === "fulfilled") {
      setReviewId(approvalId);
      setTitle(documentResult.value.name);
      setContent(generatedText(documentResult.value.sections));
      setDocumentCredits(documentResult.value.creditsConsumed);
      recordCortiActivity({
        product: "text-generation",
        status: "completed",
        action: "Clinician-reviewed EHR draft generated",
        credits: documentResult.value.creditsConsumed,
      });
    } else {
      setGenerationError(messageFor(documentResult.reason));
    }
    if (codingResult.status === "fulfilled") {
      setCodes(codingResult.value);
      setCodingCredits(codingResult.value.creditsConsumed);
      setSelectedCoding(
        codingResult.value.codes.length > 0
          ? { group: "supported", index: 0 }
          : codingResult.value.candidates.length > 0
            ? { group: "candidate", index: 0 }
            : null,
      );
      recordCortiActivity({
        product: "medical-coding",
        status: "completed",
        action: `${codingResult.value.codes.length + codingResult.value.candidates.length} evidence-linked suggestion${codingResult.value.codes.length + codingResult.value.candidates.length === 1 ? "" : "s"} returned for review`,
        credits: codingResult.value.creditsConsumed,
      });
    } else {
      setCodingError(messageFor(codingResult.reason));
      recordCortiActivity({
        product: "medical-coding",
        status: "unavailable",
        action: "Coding review unavailable; document workflow remained safe",
      });
    }
    setBusy(null);
  };

  const handlePatientReceipt = async () => {
    if (source.trim() === "" || !reviewed || busy !== null) return;
    setBusy("receipt");
    setReceiptError(null);
    try {
      const result = await generateSupportingDocument({
        approvalId: reviewId ?? `record-review-${crypto.randomUUID()}`,
        approvedClinicalText: source.trim(),
        documentType: "patient-receipt",
        correlationId: crypto.randomUUID(),
      });
      setReceipt({
        title: result.name,
        content: generatedText(result.sections),
        credits: result.creditsConsumed,
      });
      recordCortiActivity({
        product: "text-generation",
        status: "completed",
        action: "Plain-language patient instructions drafted",
        credits: result.creditsConsumed,
      });
    } catch (error) {
      setReceiptError(messageFor(error));
    } finally {
      setBusy(null);
    }
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
              codingReview,
            })
          : documentIsDirty
            ? await reviseEhrDocument({
                documentId: document.documentId,
                actorId: clinicianActorId,
                correlationId,
                expectedVersion: document.version,
                idempotencyKey: `record-revise-${crypto.randomUUID()}`,
                reason: "Clinician reviewed the generated draft",
                changes: { title: title.trim(), content: content.trim(), codingReview },
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
    setSelectedCoding(null);
    setCodingDecision(null);
    setDocumentCredits(null);
    setCodingCredits(null);
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
            <label className="block max-w-xs">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ehr-muted">
                Coding system and setting
              </span>
              <select
                value={codingSystem}
                onChange={(event) => setCodingSystem(event.target.value as CodingSystem)}
                className="mt-1 w-full border border-ehr-line bg-ehr-bg px-2 py-1.5 text-[10px] text-ehr-foreground outline-none focus:border-ehr-accent"
              >
                {Object.entries(codingSystemLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
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
              Generate Corti draft and coding review
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px] font-medium text-verified-strong">
                <ShieldCheck className="size-3" aria-hidden="true" />
                Clinician-reviewed source · Corti Text Generation draft
                {documentCredits !== null && (
                  <span className="font-normal text-ehr-muted">
                    · {creditsLabel(documentCredits)}
                  </span>
                )}
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
                  Corti Medical Coding review
                </h4>
                {codes !== null && (
                  <span className="text-right text-[9px] text-ehr-muted">
                    {codingSystemLabels[codes.system]}
                    {codingCredits !== null && <> · {creditsLabel(codingCredits)}</>}
                  </span>
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
                <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                  <div className="space-y-2">
                    <CodingSuggestionGroup
                      title="Codes returned by Corti"
                      kind="supported"
                      suggestions={codes.codes}
                      selected={selectedCoding}
                      onSelect={(selection) => {
                        setSelectedCoding(selection);
                        setCodingDecision(null);
                      }}
                    />
                    <CodingSuggestionGroup
                      title="Candidates requiring review"
                      kind="candidate"
                      suggestions={codes.candidates}
                      selected={selectedCoding}
                      onSelect={(selection) => {
                        setSelectedCoding(selection);
                        setCodingDecision(null);
                      }}
                    />
                  </div>
                  <aside className="border border-ehr-line bg-ehr-bg p-2">
                    {selectedCode === undefined ? (
                      <p className="text-[9.5px] text-ehr-muted">
                        Select a code to inspect its evidence.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[10px] font-semibold text-ehr-foreground">
                            {selectedCode.code} · evidence in reviewed source
                          </p>
                          <span
                            className={`shrink-0 text-[8.5px] font-semibold ${
                              selectedCode.evidenceStatus === "validated"
                                ? "text-verified-strong"
                                : "text-pending-strong"
                            }`}
                          >
                            {selectedCode.evidenceStatus === "validated"
                              ? "Offsets validated"
                              : "Evidence unavailable"}
                          </span>
                        </div>
                        <p className="max-h-32 overflow-y-auto whitespace-pre-wrap text-[9.5px] leading-relaxed text-ehr-muted">
                          {highlightedSource(source.trim(), selectedCode.evidences[0])}
                        </p>
                        {selectedCode.evidences.length > 1 && (
                          <ul className="space-y-0.5 border-t border-ehr-line pt-1 text-[9px] text-ehr-muted">
                            {selectedCode.evidences.slice(1).map((evidence, index) => (
                              <li key={`${evidence.start}-${evidence.end}-${index}`}>
                                Additional evidence: “{evidence.text}”
                              </li>
                            ))}
                          </ul>
                        )}
                        {selectedCode.alternatives.length > 0 && (
                          <p className="border-t border-ehr-line pt-1 text-[9px] text-ehr-muted">
                            Alternatives for clinician review:{" "}
                            {selectedCode.alternatives
                              .map((alternative) => `${alternative.code} ${alternative.display}`)
                              .join(" · ")}
                          </p>
                        )}
                      </div>
                    )}
                  </aside>
                </div>
              )}
              {codes !== null && suggestionCount > 0 && (
                <div className="mt-2 border-t border-ehr-line pt-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={selectedCode === undefined || document?.status === "filed"}
                      onClick={() => setCodingDecision("accepted")}
                      className="bg-ehr-chrome px-2.5 py-1 text-[9.5px] font-semibold text-ehr-chrome-foreground disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Accept selected code
                    </button>
                    <button
                      type="button"
                      disabled={document?.status === "filed"}
                      onClick={() => setCodingDecision("rejected")}
                      className="border border-ehr-line bg-ehr-bg px-2.5 py-1 text-[9.5px] font-semibold text-ehr-foreground disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Reject all suggestions
                    </button>
                    {codingDecision === null ? (
                      <span className="text-[9px] text-pending-strong">
                        Choose an outcome before saving the EHR draft.
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[9px] font-medium text-verified-strong">
                        <Check className="size-3" aria-hidden="true" />
                        {codingDecision === "accepted"
                          ? `${selectedCode?.code ?? "Code"} accepted for this version`
                          : "Suggestions rejected for this version"}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[9px] text-ehr-muted">
                    Saving attributes this decision to {clinicianActorId} and records it in the
                    immutable version history.
                  </p>
                </div>
              )}
              <p className="mt-2 text-[9px] leading-snug text-ehr-muted">
                Corti codes and candidates stay in separate review queues. Evidence offsets are
                validated locally when present; no suggestion is filed automatically.
              </p>
            </div>

            <div className="border border-ehr-line bg-ehr-panel p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-ehr-muted">
                  Patient instructions · Corti Text Generation
                </h4>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void handlePatientReceipt()}
                  className="inline-flex items-center gap-1.5 border border-ehr-chrome bg-ehr-panel px-2.5 py-1 text-[10px] font-semibold text-ehr-foreground disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {busy === "receipt" && (
                    <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
                  )}
                  {receipt === null ? "Draft patient copy" : "Redraft patient copy"}
                </button>
              </div>
              {receiptError !== null ? (
                <p role="alert" className="mt-1 text-[10px] text-escalated-strong">
                  {receiptError}
                </p>
              ) : receipt === null ? (
                <p className="mt-1 text-[10px] text-ehr-muted">
                  Plain-language copy of the plan for the patient and their carers, drafted from the
                  same clinician-reviewed text as the note.
                </p>
              ) : (
                <div className="mt-2 space-y-1">
                  <p className="text-[10px] font-semibold text-ehr-foreground">{receipt.title}</p>
                  <p className="max-h-36 overflow-y-auto whitespace-pre-wrap text-[10px] leading-relaxed text-ehr-foreground">
                    {receipt.content}
                  </p>
                  <p className="text-[9px] text-ehr-muted">
                    Draft for the clinician to hand over or read aloud · not sent automatically ·{" "}
                    {creditsLabel(receipt.credits)}
                  </p>
                </div>
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
                    ? codingReviewComplete
                      ? "Save EHR draft and coding decision"
                      : "Complete coding review to save"
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
                      {version.codingReview !== null
                        ? ` · coding ${version.codingReview.outcome}`
                        : ""}
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
