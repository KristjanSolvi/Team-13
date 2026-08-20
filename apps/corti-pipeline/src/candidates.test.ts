import { describe, expect, it } from "vitest";

import { normalizeGeneratedCandidates } from "./candidates.js";
import type { TranscriptSegment } from "./contracts.js";

const segments: TranscriptSegment[] = [
  {
    interactionId: "interaction-1",
    segmentKey: "interaction-1:12",
    text: "I have been dizzy since my medication changed.",
    startSeconds: 12,
    endSeconds: 16,
    speakerId: 1,
    isFinal: true,
  },
];

describe("normalizeGeneratedCandidates", () => {
  it("drops hallucinated evidence and retains exact evidence", () => {
    const result = normalizeGeneratedCandidates({
      generatedValue: [
        {
          category: "medication-concern",
          summary: "Dizziness followed a medication change.",
          sourceQuote: "dizzy since my medication changed",
        },
        {
          category: "follow-up",
          summary: "A blood-pressure check was requested.",
          sourceQuote: "Please arrange a blood-pressure check.",
        },
      ],
      patientId: "karen",
      interactionId: "interaction-1",
      correlationId: "corr-karen-1",
      segments,
      createId: () => "candidate-1",
    });

    expect(result.rejectedEvidenceCount).toBe(1);
    expect(result.rejectedAudioQualityCount).toBe(0);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      candidateId: "candidate-1",
      correlationId: "corr-karen-1",
      category: "medication-concern",
      evidence: [
        {
          segmentKey: "interaction-1:12",
          sourceQuote: "dizzy since my medication changed",
          startSeconds: 12,
          endSeconds: 16,
          audioQuality: "clear",
        },
      ],
    });
  });

  it("withholds candidates whose exact evidence overlaps uncertain audio", () => {
    const result = normalizeGeneratedCandidates({
      generatedValue: [
        {
          category: "medication-concern",
          summary: "Dizziness followed a medication change.",
          sourceQuote: "dizzy since my medication changed",
        },
      ],
      patientId: "karen",
      interactionId: "interaction-1",
      correlationId: "corr-karen-1",
      segments: segments.map((segment) => ({
        ...segment,
        audioQuality: "uncertain" as const,
      })),
    });

    expect(result.candidates).toEqual([]);
    expect(result.rejectedEvidenceCount).toBe(0);
    expect(result.rejectedAudioQualityCount).toBe(1);
  });

  it("retains at most one grounded review item when upstream returns extras", () => {
    const result = normalizeGeneratedCandidates({
      generatedValue: [
        {
          category: "symptom",
          summary: "Dizziness was explicitly reported.",
          sourceQuote: "dizzy since my medication changed",
        },
        {
          category: "medication-concern",
          summary: "The symptom followed a medication change.",
          sourceQuote: "my medication changed",
        },
      ],
      patientId: "karen",
      interactionId: "interaction-1",
      correlationId: "corr-karen-1",
      segments,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.category).toBe("symptom");
  });
});
