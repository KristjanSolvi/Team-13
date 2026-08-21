import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  candidateCategories,
  type FollowThroughCandidate,
  type TranscriptSegment,
} from "./contracts.js";
import { locateExactQuote } from "./evidence.js";

const generatedCandidateSchema = z.object({
  category: z.enum(candidateCategories),
  summary: z.string().min(5).max(240),
  sourceQuote: z.string().min(1).max(500),
});

const generatedCandidatesSchema = z.array(generatedCandidateSchema).max(8);

export interface NormalizeGeneratedCandidatesInput {
  generatedValue: unknown;
  patientId: string;
  interactionId: string;
  correlationId: string;
  segments: readonly TranscriptSegment[];
  createId?: () => string;
}

function canonicalClinicalText(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/(\d)\s+(mcg|mg|g|ml)\b/g, "$1$2")
    .replace(/\b(?:once\s+(?:a|per)\s+day|once\s+daily|o\.?d\.?)\b/g, "daily")
    .replace(/\bdizziness\b/g, "dizzy")
    .replace(/\bchanged\b/g, "change")
    .replace(/\bmonitoring\b/g, "monitor")
    .replace(/\bobservations\b/g, "observation")
    .replace(/\bbloods\b/g, "blood")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizedActionKey(text: string): string {
  return canonicalClinicalText(
    text
      .replace(
        /\s+to\s+offload\b.*$/i,
        "",
      )
      .replace(/\blet(?:'|’)s\b|\blet\s+us\b/gi, "")
      .replace(/\b(?:we|i)\s+(?:also\s+)?(?:need|will|should|must|plan)\s+to\b/gi, "")
      .replace(/\b(?:need|needs)\s+to\b/gi, "")
      .replace(/\b(?:you|your|the|a|an|please)\b/gi, ""),
  );
}

const nonClinicalGroundingWords = new Set([
  "a",
  "an",
  "the",
  "we",
  "i",
  "you",
  "your",
  "to",
  "on",
  "for",
  "of",
  "and",
  "also",
  "was",
  "were",
  "is",
  "are",
  "be",
  "been",
  "need",
  "needs",
  "explicitly",
  "reported",
  "followed",
  "following",
  "symptom",
  "maintain",
]);

function clinicalGroundingTokens(text: string): string[] {
  return canonicalClinicalText(text)
    .split(" ")
    .filter((token) => token.length > 0 && !nonClinicalGroundingWords.has(token));
}

const polarityTokens = new Set([
  "no",
  "not",
  "never",
  "without",
  "cancel",
  "cancelled",
  "defer",
  "deferred",
  "withhold",
  "withheld",
]);

function summaryIsGrounded(summary: string, sourceQuote: string): boolean {
  const summaryTokens = clinicalGroundingTokens(summary);
  const sourceTokens = clinicalGroundingTokens(sourceQuote);
  const sourcePolarity = sourceTokens.filter((token) => polarityTokens.has(token));
  if (
    sourcePolarity.length > 0 &&
    !summaryTokens.some((token) => polarityTokens.has(token))
  ) {
    return false;
  }
  let sourceIndex = 0;
  for (const token of summaryTokens) {
    const matchIndex = sourceTokens.indexOf(token, sourceIndex);
    if (matchIndex === -1) return false;
    sourceIndex = matchIndex + 1;
  }
  return summaryTokens.length > 0;
}

export function normalizeGeneratedCandidates(
  input: NormalizeGeneratedCandidatesInput,
): {
  candidates: FollowThroughCandidate[];
  rejectedEvidenceCount: number;
  rejectedAudioQualityCount: number;
} {
  const generated = generatedCandidatesSchema.parse(input.generatedValue);
  const createId = input.createId ?? randomUUID;
  const candidates: FollowThroughCandidate[] = [];
  const actionIndexes = new Map<string, number>();
  let rejectedEvidenceCount = 0;
  let rejectedAudioQualityCount = 0;

  for (const item of generated) {
    const evidence = locateExactQuote(input.segments, item.sourceQuote);
    if (evidence === null || evidence.interactionId !== input.interactionId) {
      rejectedEvidenceCount += 1;
      continue;
    }
    if (evidence.audioQuality === "uncertain") {
      rejectedAudioQualityCount += 1;
      continue;
    }
    if (!summaryIsGrounded(item.summary, evidence.sourceQuote)) {
      rejectedEvidenceCount += 1;
      continue;
    }
    const actionKey = normalizedActionKey(item.summary);
    const candidate: FollowThroughCandidate = {
      schemaVersion: "1",
      candidateId: createId(),
      correlationId: input.correlationId,
      interactionId: input.interactionId,
      patientId: input.patientId,
      category: item.category,
      summary: item.summary,
      evidence: [evidence],
      status: "candidate",
    };
    const existingIndex = actionIndexes.get(actionKey);
    if (existingIndex !== undefined) {
      const existing = candidates[existingIndex] as FollowThroughCandidate;
      const existingQuoteLength = existing.evidence[0]?.sourceQuote.length ?? Number.MAX_SAFE_INTEGER;
      const candidateQuoteLength = candidate.evidence[0]?.sourceQuote.length ?? Number.MAX_SAFE_INTEGER;
      if (
        candidate.summary.length < existing.summary.length ||
        (candidate.summary.length === existing.summary.length &&
          candidateQuoteLength < existingQuoteLength)
      ) {
        candidates[existingIndex] = candidate;
      }
      continue;
    }
    actionIndexes.set(actionKey, candidates.length);
    candidates.push(candidate);
  }

  return { candidates, rejectedEvidenceCount, rejectedAudioQualityCount };
}
