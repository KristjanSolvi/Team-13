import type {
  EvidenceReference,
  NormalizedCodingEvidence,
  TranscriptSegment,
} from "./contracts.js";

export function locateExactQuote(
  segments: readonly TranscriptSegment[],
  sourceQuote: string,
): EvidenceReference | null {
  if (sourceQuote.length === 0) {
    return null;
  }

  for (const segment of segments) {
    if (!segment.isFinal || !segment.text.includes(sourceQuote)) {
      continue;
    }

    const evidence: EvidenceReference = {
      interactionId: segment.interactionId,
      segmentKey: segment.segmentKey,
      sourceQuote,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      audioQuality: segment.audioQuality ?? "clear",
    };

    if (segment.speakerId !== undefined) {
      evidence.speakerId = segment.speakerId;
    }

    return evidence;
  }

  return null;
}

export function validateCodingEvidence(
  contexts: readonly string[],
  evidence: NormalizedCodingEvidence,
): NormalizedCodingEvidence | null {
  const context = contexts[evidence.contextIndex];
  if (context === undefined) {
    return null;
  }

  if (
    !Number.isInteger(evidence.start) ||
    !Number.isInteger(evidence.end) ||
    evidence.start < 0 ||
    evidence.end <= evidence.start ||
    evidence.end > context.length
  ) {
    return null;
  }

  return context.slice(evidence.start, evidence.end) === evidence.text
    ? evidence
    : null;
}
