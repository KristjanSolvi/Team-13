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

  it("retains multiple separately grounded review items from one recording", () => {
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

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]?.category).toBe("symptom");
    expect(result.candidates[1]?.category).toBe("medication-concern");
  });

  it("retains every distinct task in the presentation ward-round script", () => {
    const planSegment: TranscriptSegment = {
      interactionId: "interaction-presentation",
      segmentKey: "interaction-presentation:30",
      text: "Monitor observations today. Start IV furosemide 80mg OD. Daily weight monitoring. Accurate fluid balance chart. Order daily bloods.",
      startSeconds: 30,
      endSeconds: 42,
      speakerId: 1,
      isFinal: true,
    };
    const generatedValue = [
      ["follow-up", "Monitor observations today", "Monitor observations today"],
      ["medication-concern", "Start IV furosemide 80mg OD", "Start IV furosemide 80mg OD"],
      ["follow-up", "Daily weight monitoring", "Daily weight monitoring"],
      ["follow-up", "Accurate fluid balance chart", "Accurate fluid balance chart"],
      ["investigation", "Order daily bloods", "Order daily bloods"],
    ].map(([category, summary, sourceQuote]) => ({ category, summary, sourceQuote }));

    const result = normalizeGeneratedCandidates({
      generatedValue,
      patientId: "synthetic-sarah",
      interactionId: "interaction-presentation",
      correlationId: "presentation-script",
      segments: [planSegment],
    });

    expect(result.candidates.map((candidate) => candidate.summary)).toEqual([
      "Monitor observations today",
      "Start IV furosemide 80mg OD",
      "Daily weight monitoring",
      "Accurate fluid balance chart",
      "Order daily bloods",
    ]);
  });

  it("deduplicates conversational actions repeated in the presentation plan", () => {
    const presentationSegments: TranscriptSegment[] = [
      {
        interactionId: "interaction-presentation",
        segmentKey: "interaction-presentation:10",
        text: "We need to monitor your observations today. We need to start you on IV furosemide 80mg once a day to offload your fluid.",
        startSeconds: 10,
        endSeconds: 22,
        speakerId: 1,
        isFinal: true,
      },
      {
        interactionId: "interaction-presentation",
        segmentKey: "interaction-presentation:30",
        text: "Monitor observations today. Start IV furosemide 80mg OD. Daily weight monitoring. Accurate fluid balance chart. Order daily bloods.",
        startSeconds: 30,
        endSeconds: 42,
        speakerId: 1,
        isFinal: true,
      },
    ];
    const generatedValue = [
      {
        category: "follow-up",
        summary: "Monitor observations today",
        sourceQuote: "We need to monitor your observations today",
      },
      {
        category: "medication-concern",
        summary: "Start IV furosemide 80mg once daily to offload fluid",
        sourceQuote:
          "We need to start you on IV furosemide 80mg once a day to offload your fluid",
      },
      {
        category: "follow-up",
        summary: "Monitor observations today",
        sourceQuote: "Monitor observations today",
      },
      {
        category: "medication-concern",
        summary: "Start IV furosemide 80mg OD",
        sourceQuote: "Start IV furosemide 80mg OD",
      },
      {
        category: "follow-up",
        summary: "Daily weight monitoring",
        sourceQuote: "Daily weight monitoring",
      },
      {
        category: "follow-up",
        summary: "Accurate fluid balance chart",
        sourceQuote: "Accurate fluid balance chart",
      },
      {
        category: "investigation",
        summary: "Order daily bloods",
        sourceQuote: "Order daily bloods",
      },
    ];

    const result = normalizeGeneratedCandidates({
      generatedValue,
      patientId: "synthetic-sarah",
      interactionId: "interaction-presentation",
      correlationId: "presentation-script",
      segments: presentationSegments,
    });

    expect(result.candidates.map((candidate) => candidate.summary)).toEqual([
      "Monitor observations today",
      "Start IV furosemide 80mg OD",
      "Daily weight monitoring",
      "Accurate fluid balance chart",
      "Order daily bloods",
    ]);
  });

  it("retains distinct grounded actions that share one encompassing quote", () => {
    const planText =
      "Monitor observations today. Start IV furosemide 80mg OD. Daily weight monitoring. Accurate fluid balance chart. Order daily bloods.";
    const result = normalizeGeneratedCandidates({
      generatedValue: [
        ["follow-up", "Monitor observations today"],
        ["medication-concern", "Start IV furosemide 80mg OD"],
        ["follow-up", "Daily weight monitoring"],
        ["follow-up", "Accurate fluid balance chart"],
        ["investigation", "Order daily bloods"],
      ].map(([category, summary]) => ({ category, summary, sourceQuote: planText })),
      patientId: "synthetic-sarah",
      interactionId: "interaction-presentation",
      correlationId: "presentation-shared-evidence",
      segments: [
        {
          interactionId: "interaction-presentation",
          segmentKey: "interaction-presentation:30",
          text: planText,
          startSeconds: 30,
          endSeconds: 42,
          speakerId: 1,
          isFinal: true,
        },
      ],
    });

    expect(result.candidates).toHaveLength(5);
  });

  it("rejects clinical details in a summary that are absent from its exact quote", () => {
    const result = normalizeGeneratedCandidates({
      generatedValue: [
        {
          category: "medication-concern",
          summary: "Start IV furosemide 40mg OD",
          sourceQuote: "Start IV furosemide 80mg OD",
        },
      ],
      patientId: "synthetic-sarah",
      interactionId: "interaction-presentation",
      correlationId: "presentation-conflicting-fact",
      segments: [
        {
          interactionId: "interaction-presentation",
          segmentKey: "interaction-presentation:30",
          text: "Start IV furosemide 80mg OD",
          startSeconds: 30,
          endSeconds: 34,
          speakerId: 1,
          isFinal: true,
        },
      ],
    });

    expect(result.candidates).toEqual([]);
    expect(result.rejectedEvidenceCount).toBe(1);
  });

  it("rejects a positive task summary grounded only in negated speech", () => {
    const result = normalizeGeneratedCandidates({
      generatedValue: [
        {
          category: "medication-concern",
          summary: "Start IV furosemide 80mg",
          sourceQuote: "We do not need to start IV furosemide 80mg",
        },
      ],
      patientId: "synthetic-sarah",
      interactionId: "interaction-presentation",
      correlationId: "presentation-negated-action",
      segments: [
        {
          interactionId: "interaction-presentation",
          segmentKey: "interaction-presentation:30",
          text: "We do not need to start IV furosemide 80mg",
          startSeconds: 30,
          endSeconds: 34,
          speakerId: 1,
          isFinal: true,
        },
      ],
    });

    expect(result.candidates).toEqual([]);
    expect(result.rejectedEvidenceCount).toBe(1);
  });

  it("does not collapse distinct checks phrased with the same framing", () => {
    const result = normalizeGeneratedCandidates({
      generatedValue: [
        {
          category: "follow-up",
          summary: "Need to check blood pressure",
          sourceQuote: "Need to check blood pressure",
        },
        {
          category: "investigation",
          summary: "Need to check blood glucose",
          sourceQuote: "Need to check blood glucose",
        },
      ],
      patientId: "synthetic-sarah",
      interactionId: "interaction-presentation",
      correlationId: "presentation-distinct-checks",
      segments: [
        {
          interactionId: "interaction-presentation",
          segmentKey: "interaction-presentation:30",
          text: "Need to check blood pressure. Need to check blood glucose.",
          startSeconds: 30,
          endSeconds: 36,
          speakerId: 1,
          isFinal: true,
        },
      ],
    });

    expect(result.candidates).toHaveLength(2);
  });
});
