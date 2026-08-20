import type {
  CodingResult,
  FollowThroughCandidate,
  GeneratedSupportingDocument,
  TranscriptSegment,
} from "./contracts.js";
import { evaluateSupportingDocumentSafety } from "./document-safety.js";
import { validateCodingEvidence } from "./evidence.js";

export interface EvaluationCheck {
  id: string;
  passed: boolean;
  detail: string;
}

export function evaluateCandidateGrounding(
  candidates: readonly FollowThroughCandidate[],
  segments: readonly TranscriptSegment[],
): EvaluationCheck[] {
  const segmentByKey = new Map(
    segments.map((segment) => [
      `${segment.interactionId}\0${segment.segmentKey}`,
      segment,
    ]),
  );
  let evidenceCount = 0;
  let invalidEvidenceCount = 0;

  for (const candidate of candidates) {
    for (const evidence of candidate.evidence) {
      evidenceCount += 1;
      const segment = segmentByKey.get(
        `${evidence.interactionId}\0${evidence.segmentKey}`,
      );
      if (
        segment === undefined ||
        !segment.isFinal ||
        segment.interactionId !== candidate.interactionId ||
        segment.startSeconds !== evidence.startSeconds ||
        segment.endSeconds !== evidence.endSeconds ||
        (segment.audioQuality ?? "clear") !== "clear" ||
        evidence.audioQuality !== "clear" ||
        !segment.text.includes(evidence.sourceQuote)
      ) {
        invalidEvidenceCount += 1;
      }
    }
  }

  return [
    {
      id: "candidate-present",
      passed: candidates.length > 0,
      detail:
        candidates.length > 0
          ? `${candidates.length} conservative candidate${candidates.length === 1 ? "" : "s"} returned.`
          : "No candidate was returned; review the transcript or Corti output.",
    },
    {
      id: "candidate-focused",
      passed: candidates.length <= 1,
      detail:
        candidates.length <= 1
          ? "The review surface contains at most one candidate."
          : `${candidates.length} candidates would create alert noise; consolidate or reject them.`,
    },
    {
      id: "candidate-evidence",
      passed: evidenceCount > 0 && invalidEvidenceCount === 0,
      detail:
        evidenceCount === 0
          ? "No evidence was attached."
          : invalidEvidenceCount === 0
            ? `${evidenceCount} evidence quote${evidenceCount === 1 ? "" : "s"} matched an exact final transcript segment.`
            : `${invalidEvidenceCount} of ${evidenceCount} evidence quotes failed closed validation.`,
    },
  ];
}

export function evaluateCodingGrounding(
  result: CodingResult,
  approvedClinicalText: string,
): EvaluationCheck[] {
  const suggestions = [...result.codes, ...result.candidates];
  const evidences = suggestions.flatMap((suggestion) => suggestion.evidences);
  const invalidEvidenceCount = evidences.filter(
    (evidence) =>
      validateCodingEvidence([approvedClinicalText], evidence) === null,
  ).length;

  return [
    {
      id: "coding-separated",
      passed: Array.isArray(result.codes) && Array.isArray(result.candidates),
      detail: `${result.codes.length} supported code${result.codes.length === 1 ? "" : "s"}; ${result.candidates.length} review candidate${result.candidates.length === 1 ? "" : "s"}.`,
    },
    {
      id: "coding-evidence",
      passed: invalidEvidenceCount === 0,
      detail:
        invalidEvidenceCount === 0
          ? `${evidences.length} returned evidence span${evidences.length === 1 ? "" : "s"} reproduced the submitted text exactly.`
          : `${invalidEvidenceCount} returned evidence span${invalidEvidenceCount === 1 ? "" : "s"} failed closed validation.`,
    },
  ];
}

export function evaluateDocumentGrounding(
  document: GeneratedSupportingDocument,
  approvedClinicalText: string,
): EvaluationCheck[] {
  const safety = evaluateSupportingDocumentSafety(
    document,
    approvedClinicalText,
  );
  return [
    {
      id: "document-draft",
      passed:
        document.status === "draft" &&
        document.sections.some((section) => section.text.length > 0),
      detail: "Supporting output is explicitly marked draft and based on approved input.",
    },
    {
      id: "document-lifecycle-grounded",
      passed: safety.safe,
      detail: safety.safe
        ? "The draft adds no unsupported created, assigned, completed, or verified status."
        : `Unsupported lifecycle wording detected: ${safety.unsupportedClaims.map((claim) => claim.text).join(", ")}.`,
    },
  ];
}
