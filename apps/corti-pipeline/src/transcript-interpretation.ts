import type {
  TranscriptReviewSuggestion,
  TranscriptSegment,
} from "./contracts.js";

export type TranscriptReviewDecision = "keep" | "use-suggestion";

export interface ReviewedTranscript {
  segments: TranscriptSegment[];
  appliedSuggestionIds: string[];
  keptSuggestionIds: string[];
  originalTranscriptPreserved: true;
}

/**
 * Build a separate clinician-reviewed interpretation of an immutable raw
 * transcript. Every proposed replacement must still match its exact original
 * span and must have an explicit clinician decision.
 */
export function buildReviewedTranscript(
  segments: readonly TranscriptSegment[],
  suggestions: readonly TranscriptReviewSuggestion[],
  decisions: Readonly<Record<string, TranscriptReviewDecision>>,
): ReviewedTranscript {
  const bySegment = new Map<string, TranscriptReviewSuggestion[]>();
  const segmentByKey = new Map<string, TranscriptSegment>();
  const appliedSuggestionIds: string[] = [];
  const keptSuggestionIds: string[] = [];

  for (const segment of segments) {
    if (segmentByKey.has(segment.segmentKey)) {
      throw new Error(`Transcript segment ${segment.segmentKey} is duplicated.`);
    }
    segmentByKey.set(segment.segmentKey, segment);
  }

  for (const suggestion of suggestions) {
    const decision = decisions[suggestion.suggestionId];
    if (decision === undefined) {
      throw new Error(
        `A clinician decision is required for suggestion ${suggestion.suggestionId}.`,
      );
    }
    const segment = segmentByKey.get(suggestion.segmentKey);
    if (segment === undefined) {
      throw new Error(
        `Transcript segment ${suggestion.segmentKey} is unavailable for review.`,
      );
    }
    if (
      suggestion.originalStart < 0 ||
      suggestion.originalEnd > segment.text.length ||
      suggestion.originalStart >= suggestion.originalEnd ||
      segment.text.slice(suggestion.originalStart, suggestion.originalEnd) !==
        suggestion.originalText
    ) {
      throw new Error(
        `Suggestion ${suggestion.suggestionId} no longer matches the raw transcript.`,
      );
    }
    const segmentSuggestions = bySegment.get(suggestion.segmentKey) ?? [];
    segmentSuggestions.push(suggestion);
    bySegment.set(suggestion.segmentKey, segmentSuggestions);
    if (decision === "use-suggestion") {
      appliedSuggestionIds.push(suggestion.suggestionId);
    } else {
      keptSuggestionIds.push(suggestion.suggestionId);
    }
  }

  const reviewedSegments = segments.map((segment) => {
    const segmentSuggestions = [...(bySegment.get(segment.segmentKey) ?? [])].sort(
      (left, right) => right.originalStart - left.originalStart,
    );
    let previousStart = segment.text.length;
    let text = segment.text;
    for (const suggestion of segmentSuggestions) {
      if (suggestion.originalEnd > previousStart) {
        throw new Error(
          `Suggestion ${suggestion.suggestionId} overlaps another reviewed phrase.`,
        );
      }
      previousStart = suggestion.originalStart;
      if (decisions[suggestion.suggestionId] !== "use-suggestion") continue;
      text = `${text.slice(0, suggestion.originalStart)}${suggestion.suggestedText}${text.slice(suggestion.originalEnd)}`;
    }
    return text === segment.text ? { ...segment } : { ...segment, text };
  });

  return {
    segments: reviewedSegments,
    appliedSuggestionIds,
    keptSuggestionIds,
    originalTranscriptPreserved: true,
  };
}
