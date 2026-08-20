import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  TranscriptReviewSuggestion,
  TranscriptSegment,
} from "./contracts.js";

const generatedSuggestionSchema = z
  .object({
    segmentKey: z.string().min(1).max(200),
    originalText: z.string().trim().min(1).max(120),
    suggestedText: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(240),
    confidence: z.enum(["high", "medium", "low"]),
  })
  .strict();

const generatedSuggestionsSchema = z.array(generatedSuggestionSchema).max(3);

const protectedClinicalMeaning =
  /(?:n['’]t\b|\b(?:no|not|never|none|neither|nor|denies?|denied|without|nil|negative|absent|allerg(?:y|ic|ies)|anaphylaxis)\b|\b\d+(?:\.\d+)?\b|\b(?:mg|mcg|micrograms?|grams?|kg|kilograms?|ml|millilitres?|litres?|units?|hours?|days?|weeks?|am|pm|once|twice|daily|weekly|monthly|hourly|nightly|morning|evening)\b|\b(?:today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b)/i;

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function containsProtectedMeaning(value: string): boolean {
  return protectedClinicalMeaning.test(value);
}

function containsProtectedTerm(
  value: string,
  protectedTerms: readonly string[],
): boolean {
  const valueTokens = new Set(
    normalizedText(value)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 2),
  );
  return protectedTerms.some((term) =>
    normalizedText(term)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 2)
      .some((token) => valueTokens.has(token)),
  );
}

export interface NormalizeTranscriptReviewInput {
  generatedValue: unknown;
  interactionId: string;
  segments: readonly TranscriptSegment[];
  protectedTerms?: readonly string[];
  createId?: () => string;
}

export function normalizeTranscriptReview(
  input: NormalizeTranscriptReviewInput,
): {
  suggestions: TranscriptReviewSuggestion[];
  rejectedSuggestionCount: number;
} {
  const generated = generatedSuggestionsSchema.parse(input.generatedValue);
  const createId = input.createId ?? randomUUID;
  const finalSegments = new Map(
    input.segments
      .filter(
        (segment) =>
          segment.isFinal && segment.interactionId === input.interactionId,
      )
      .map((segment) => [segment.segmentKey, segment]),
  );
  const suggestions: TranscriptReviewSuggestion[] = [];
  let rejectedSuggestionCount = 0;

  for (const generatedSuggestion of generated) {
    const segment = finalSegments.get(generatedSuggestion.segmentKey);
    const originalText = generatedSuggestion.originalText.trim();
    const suggestedText = generatedSuggestion.suggestedText.trim();
    const originalStart = segment?.text.indexOf(originalText) ?? -1;
    const originalAppearsOnce =
      segment !== undefined &&
      originalStart >= 0 &&
      segment.text.indexOf(originalText, originalStart + originalText.length) < 0;
    const valid =
      generatedSuggestion.confidence === "high" &&
      segment !== undefined &&
      originalAppearsOnce &&
      normalizedText(originalText) !== normalizedText(suggestedText) &&
      wordCount(originalText) <= 8 &&
      wordCount(suggestedText) <= 8 &&
      !containsProtectedMeaning(originalText) &&
      !containsProtectedMeaning(suggestedText) &&
      !containsProtectedTerm(originalText, input.protectedTerms ?? []) &&
      !containsProtectedTerm(suggestedText, input.protectedTerms ?? []);

    if (!valid) {
      rejectedSuggestionCount += 1;
      continue;
    }

    const originalEnd = originalStart + originalText.length;
    const overlaps = suggestions.some(
      (suggestion) =>
        suggestion.segmentKey === segment.segmentKey &&
        suggestion.originalStart < originalEnd &&
        originalStart < suggestion.originalEnd,
    );
    if (overlaps) {
      rejectedSuggestionCount += 1;
      continue;
    }

    suggestions.push({
      suggestionId: createId(),
      segmentKey: segment.segmentKey,
      originalText,
      suggestedText,
      originalStart,
      originalEnd,
      reason: generatedSuggestion.reason.trim(),
      confidence: "high",
      requiresConfirmation: true,
    });
  }

  return { suggestions, rejectedSuggestionCount };
}

export function transcriptReviewContext(
  interactionId: string,
  segments: readonly TranscriptSegment[],
  contextTerms: readonly string[],
  protectedTerms: readonly string[],
): string {
  const finalSegments = segments
    .filter(
      (segment) =>
        segment.isFinal && segment.interactionId === interactionId,
    )
    .sort(
      (left, right) =>
        left.startSeconds - right.startSeconds ||
        left.segmentKey.localeCompare(right.segmentKey),
    );
  return JSON.stringify({
    interactionId,
    contextTerms: [...new Set(contextTerms.map((term) => term.trim()).filter(Boolean))],
    protectedTerms: [
      ...new Set(protectedTerms.map((term) => term.trim()).filter(Boolean)),
    ],
    finalSegments: finalSegments.map((segment) => ({
        segmentKey: segment.segmentKey,
        text: segment.text,
      })),
  });
}
