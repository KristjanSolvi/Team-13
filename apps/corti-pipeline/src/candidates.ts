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
  summary: z.string().min(1).max(240),
  sourceQuote: z.string().min(1).max(500),
});

const generatedCandidatesSchema = z.array(generatedCandidateSchema).max(3);

export interface NormalizeGeneratedCandidatesInput {
  generatedValue: unknown;
  patientId: string;
  interactionId: string;
  segments: readonly TranscriptSegment[];
  createId?: () => string;
}

export function normalizeGeneratedCandidates(
  input: NormalizeGeneratedCandidatesInput,
): { candidates: FollowThroughCandidate[]; rejectedEvidenceCount: number } {
  const generated = generatedCandidatesSchema.parse(input.generatedValue);
  const createId = input.createId ?? randomUUID;
  const candidates: FollowThroughCandidate[] = [];
  let rejectedEvidenceCount = 0;

  for (const item of generated) {
    const evidence = locateExactQuote(input.segments, item.sourceQuote);
    if (evidence === null || evidence.interactionId !== input.interactionId) {
      rejectedEvidenceCount += 1;
      continue;
    }
    candidates.push({
      candidateId: createId(),
      interactionId: input.interactionId,
      patientId: input.patientId,
      category: item.category,
      summary: item.summary,
      evidence: [evidence],
      status: "candidate",
    });
  }

  return { candidates, rejectedEvidenceCount };
}
