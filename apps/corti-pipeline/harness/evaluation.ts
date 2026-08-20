import {
  generateCandidates,
  generateSupportingDocument,
  predictMedicalCodes,
} from "../src/browser/index.js";
import type {
  CandidateGenerationResponse,
} from "../src/browser/index.js";
import type {
  CodingResult,
  FollowThroughCandidate,
  GeneratedSupportingDocument,
  TranscriptSegment,
} from "../src/contracts.js";
import {
  KAREN_APPROVED_OUTPUT_INPUT,
  KAREN_DEMO_ARTIFACT_LABEL,
  KAREN_DEMO_INTERACTION_ID,
  KAREN_DEMO_PATIENT_ID,
  KAREN_PRELOADED_CANDIDATE,
  KAREN_PRELOADED_SEGMENTS,
} from "../src/demo/karen.js";
import {
  evaluateCandidateGrounding,
  evaluateCodingGrounding,
  evaluateDocumentGrounding,
  type EvaluationCheck,
} from "../src/evaluation.js";
import "./styles.css";

type Tone = "neutral" | "active" | "success" | "error";

const correlationId = `karen-evaluation-${crypto.randomUUID()}`;
const checks = new Map<string, EvaluationCheck>();
let candidateReady = false;

function requireElement<T extends HTMLElement>(
  id: string,
  constructor: { new (): T },
): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) {
    throw new Error(`Required evaluation element #${id} is unavailable.`);
  }
  return element;
}

const pipelineIndicator = requireElement("pipeline-indicator", HTMLSpanElement);
const pipelineStatus = requireElement("pipeline-status", HTMLSpanElement);
const transcriptOutput = requireElement("evaluation-transcript", HTMLDivElement);
const runCandidate = requireElement("run-candidate", HTMLButtonElement);
const useCandidateFallback = requireElement(
  "use-candidate-fallback",
  HTMLButtonElement,
);
const candidateStatus = requireElement("candidate-status", HTMLSpanElement);
const candidateOutput = requireElement("candidate-output", HTMLDivElement);
const candidateError = requireElement("candidate-error", HTMLParagraphElement);
const approvalConfirmed = requireElement("approval-confirmed", HTMLInputElement);
const runApprovedOutputs = requireElement(
  "run-approved-outputs",
  HTMLButtonElement,
);
const approvedOutputError = requireElement(
  "approved-output-error",
  HTMLParagraphElement,
);
const outputsStatus = requireElement("outputs-status", HTMLSpanElement);
const documentOutput = requireElement("document-output", HTMLDivElement);
const documentCredits = requireElement("document-credits", HTMLSpanElement);
const codingOutput = requireElement("coding-output", HTMLDivElement);
const codingCredits = requireElement("coding-credits", HTMLSpanElement);
const evaluationChecks = requireElement("evaluation-checks", HTMLDivElement);

function setStatus(element: HTMLElement, text: string, tone: Tone): void {
  element.textContent = text;
  element.dataset.tone = tone;
}

function setError(element: HTMLElement, message?: string): void {
  element.hidden = message === undefined;
  element.textContent = message ?? "";
}

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function renderTranscript(segments: readonly TranscriptSegment[]): void {
  transcriptOutput.replaceChildren();
  for (const segment of segments) {
    const row = document.createElement("article");
    row.className = "transcript-row";
    row.dataset.final = String(segment.isFinal);
    const meta = document.createElement("div");
    meta.className = "transcript-meta";
    const speaker = document.createElement("span");
    speaker.textContent = segment.speakerId === 1 ? "Patient" : "Clinician";
    const time = document.createElement("time");
    time.textContent = formatSeconds(segment.startSeconds);
    const source = document.createElement("span");
    source.className = "transcript-state";
    source.textContent = KAREN_DEMO_ARTIFACT_LABEL;
    const copy = document.createElement("p");
    copy.textContent = segment.text;
    meta.append(speaker, time, source);
    row.append(meta, copy);
    transcriptOutput.append(row);
  }
}

function addChecks(items: readonly EvaluationCheck[]): void {
  for (const item of items) checks.set(item.id, item);
  renderChecks();
}

function renderChecks(): void {
  evaluationChecks.replaceChildren();
  for (const check of checks.values()) {
    const row = document.createElement("div");
    row.className = "check-row";
    row.dataset.passed = String(check.passed);
    const mark = document.createElement("span");
    mark.className = "check-mark";
    mark.textContent = check.passed ? "✓" : "!";
    const copy = document.createElement("span");
    const label = document.createElement("strong");
    label.textContent = check.id.replaceAll("-", " ");
    const detail = document.createElement("small");
    detail.textContent = check.detail;
    copy.append(label, detail);
    row.append(mark, copy);
    evaluationChecks.append(row);
  }
}

function renderCandidates(
  candidates: readonly FollowThroughCandidate[],
  mode: "live" | "fallback",
): void {
  candidateOutput.replaceChildren();
  if (candidates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No evidence-backed candidate was returned.";
    candidateOutput.append(empty);
    candidateReady = false;
    syncApprovalButton();
    return;
  }

  for (const candidate of candidates) {
    const card = document.createElement("article");
    card.className = "candidate-card";
    const header = document.createElement("div");
    header.className = "candidate-meta";
    const category = document.createElement("span");
    category.textContent = candidate.category;
    const source = document.createElement("span");
    source.textContent = mode === "live" ? "live Corti Text Generation" : KAREN_DEMO_ARTIFACT_LABEL;
    header.append(category, source);
    const summary = document.createElement("h3");
    summary.textContent = candidate.summary;
    card.append(header, summary);
    for (const evidence of candidate.evidence) {
      const quote = document.createElement("blockquote");
      quote.className = "evidence-quote";
      quote.textContent = `“${evidence.sourceQuote}”`;
      const evidenceMeta = document.createElement("small");
      evidenceMeta.textContent = `${formatSeconds(evidence.startSeconds)} · exact transcript evidence · ${evidence.audioQuality}`;
      card.append(quote, evidenceMeta);
    }
    candidateOutput.append(card);
  }
  candidateReady = true;
  syncApprovalButton();
}

function syncApprovalButton(): void {
  runApprovedOutputs.disabled = !(candidateReady && approvalConfirmed.checked);
  addChecks([
    {
      id: "human-confirmation",
      passed: approvalConfirmed.checked,
      detail: approvalConfirmed.checked
        ? "The synthetic action was explicitly reviewed before downstream calls."
        : "Downstream document and coding calls remain locked until review.",
    },
  ]);
}

async function runLiveCandidateGeneration(): Promise<void> {
  runCandidate.disabled = true;
  useCandidateFallback.disabled = true;
  setError(candidateError);
  setStatus(candidateStatus, "Running", "active");
  try {
    const result: CandidateGenerationResponse = await generateCandidates(
      window.location.origin,
      {
        patientId: KAREN_DEMO_PATIENT_ID,
        interactionId: KAREN_DEMO_INTERACTION_ID,
        segments: KAREN_PRELOADED_SEGMENTS,
      },
      correlationId,
    );
    renderCandidates(result.candidates, "live");
    addChecks(
      evaluateCandidateGrounding(result.candidates, KAREN_PRELOADED_SEGMENTS),
    );
    setStatus(
      candidateStatus,
      `${result.candidates.length} live · ${result.rejectedEvidenceCount + result.rejectedAudioQualityCount} withheld · ${result.creditsConsumed.toFixed(4)} credits`,
      result.candidates.length > 0 ? "success" : "error",
    );
  } catch (error) {
    candidateReady = false;
    syncApprovalButton();
    setStatus(candidateStatus, "Live call unavailable", "error");
    setError(
      candidateError,
      `${error instanceof Error ? error.message : "Candidate generation failed."} Use the disclosed fallback only for demo recovery.`,
    );
  } finally {
    runCandidate.disabled = false;
    useCandidateFallback.disabled = false;
  }
}

function loadCandidateFallback(): void {
  setError(candidateError);
  renderCandidates([KAREN_PRELOADED_CANDIDATE], "fallback");
  addChecks(
    evaluateCandidateGrounding(
      [KAREN_PRELOADED_CANDIDATE],
      KAREN_PRELOADED_SEGMENTS,
    ),
  );
  setStatus(candidateStatus, "Fallback loaded", "active");
}

function renderDocument(result: GeneratedSupportingDocument): void {
  documentOutput.replaceChildren();
  if (result.sections.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "The draft returned without a populated section.";
    documentOutput.append(empty);
    return;
  }
  for (const section of result.sections) {
    const item = document.createElement("section");
    const heading = document.createElement("h4");
    heading.textContent = section.heading;
    const copy = document.createElement("p");
    copy.textContent = section.text;
    item.append(heading, copy);
    documentOutput.append(item);
  }
  const boundary = document.createElement("p");
  boundary.className = "draft-boundary";
  boundary.textContent = "Corti output · draft · requires review";
  documentOutput.append(boundary);
  documentCredits.textContent = `Credits ${result.creditsConsumed.toFixed(4)}`;
}

function renderCodingGroup(
  headingText: string,
  items: CodingResult["codes"],
): HTMLElement {
  const group = document.createElement("section");
  group.className = "coding-group";
  const heading = document.createElement("h4");
  heading.textContent = headingText;
  group.append(heading);
  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "None returned.";
    group.append(empty);
    return group;
  }
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "code-row";
    const code = document.createElement("strong");
    code.textContent = item.code;
    const display = document.createElement("span");
    display.textContent = item.display;
    row.append(code, display);
    for (const evidence of item.evidences) {
      const evidenceCopy = document.createElement("small");
      evidenceCopy.textContent = `Evidence: “${evidence.text}”`;
      row.append(evidenceCopy);
    }
    if (item.evidenceStatus === "unavailable") {
      const unavailable = document.createElement("small");
      unavailable.textContent = "Evidence unavailable · clinician review required";
      row.append(unavailable);
    }
    group.append(row);
  }
  return group;
}

function renderCoding(result: CodingResult): void {
  codingOutput.replaceChildren(
    renderCodingGroup("Codes", result.codes),
    renderCodingGroup("Review candidates", result.candidates),
  );
  codingCredits.textContent = `Credits ${result.creditsConsumed.toFixed(4)}`;
}

async function runOutputs(): Promise<void> {
  if (!candidateReady || !approvalConfirmed.checked) return;
  runApprovedOutputs.disabled = true;
  setError(approvedOutputError);
  setStatus(outputsStatus, "Generating", "active");
  const { approvalId, approvedClinicalText, documentType, codingSystem } =
    KAREN_APPROVED_OUTPUT_INPUT;
  const [documentResult, codingResult] = await Promise.allSettled([
    generateSupportingDocument(
      window.location.origin,
      { approvalId, approvedClinicalText, documentType },
      correlationId,
    ),
    predictMedicalCodes(
      window.location.origin,
      { approvalId, approvedClinicalText, system: codingSystem },
      correlationId,
    ),
  ]);

  let readyCount = 0;
  if (documentResult.status === "fulfilled") {
    readyCount += 1;
    renderDocument(documentResult.value);
    addChecks(
      evaluateDocumentGrounding(documentResult.value, approvedClinicalText),
    );
  } else {
    documentOutput.textContent = "Document generation unavailable; no draft was fabricated.";
    addChecks([
      {
        id: "document-draft",
        passed: false,
        detail: "Live supporting-document generation was unavailable.",
      },
    ]);
  }

  if (codingResult.status === "fulfilled") {
    readyCount += 1;
    renderCoding(codingResult.value);
    addChecks(
      evaluateCodingGrounding(codingResult.value, approvedClinicalText),
    );
  } else {
    codingOutput.textContent = "Medical Coding unavailable; no code was fabricated.";
    addChecks([
      {
        id: "coding-separated",
        passed: false,
        detail: "The live Medical Coding call was unavailable.",
      },
      {
        id: "coding-evidence",
        passed: false,
        detail: "No live evidence spans were available to validate.",
      },
    ]);
  }

  setStatus(
    outputsStatus,
    readyCount === 2 ? "Both live" : `${readyCount}/2 live`,
    readyCount === 2 ? "success" : "error",
  );
  if (readyCount < 2) {
    setError(
      approvedOutputError,
      "One or more Corti calls were unavailable. The successful result remains visible; missing output was not invented.",
    );
  }
  syncApprovalButton();
}

async function checkPipeline(): Promise<void> {
  try {
    const response = await fetch("/health");
    const health = (await response.json()) as {
      status?: unknown;
      cortiConfigured?: unknown;
    };
    const configured =
      response.ok &&
      health.status === "ok" &&
      health.cortiConfigured === true;
    pipelineStatus.textContent = configured
      ? "Pipeline live · Corti configured"
      : "Pipeline live · credentials missing";
    pipelineIndicator.dataset.tone = configured ? "success" : "error";
    addChecks([
      {
        id: "pipeline-configured",
        passed: configured,
        detail: configured
          ? "Server-side Corti credentials are available."
          : "Add credentials to the ignored pipeline .env file.",
      },
    ]);
  } catch {
    pipelineStatus.textContent = "Pipeline offline · start npm run dev";
    pipelineIndicator.dataset.tone = "error";
    addChecks([
      {
        id: "pipeline-configured",
        passed: false,
        detail: "The pipeline health endpoint is unavailable.",
      },
    ]);
  }
}

renderTranscript(KAREN_PRELOADED_SEGMENTS);
addChecks([
  {
    id: "fallback-disclosed",
    passed: true,
    detail: "The synthetic transcript and candidate fallback are visibly labelled.",
  },
  {
    id: "ledger-unchanged",
    passed: true,
    detail: "This evaluator has no ledger mutation route.",
  },
]);
syncApprovalButton();
runCandidate.addEventListener("click", () => void runLiveCandidateGeneration());
useCandidateFallback.addEventListener("click", loadCandidateFallback);
approvalConfirmed.addEventListener("change", syncApprovalButton);
runApprovedOutputs.addEventListener("click", () => void runOutputs());
await checkPipeline();
