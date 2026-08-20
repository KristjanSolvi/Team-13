import { describe, expect, it } from "vitest";

import type { TranscriptSegment } from "./contracts.js";
import {
  normalizeTranscriptReview,
  transcriptReviewContext,
} from "./transcript-review.js";

function segment(
  text: string,
  overrides: Partial<TranscriptSegment> = {},
): TranscriptSegment {
  return {
    interactionId: "interaction-1",
    segmentKey: "interaction-1:12",
    text,
    startSeconds: 12,
    endSeconds: 16,
    isFinal: true,
    audioQuality: "clear",
    ...overrides,
  };
}

describe("normalizeTranscriptReview", () => {
  it("retains one exact high-confidence possible mishearing for confirmation", () => {
    const result = normalizeTranscriptReview({
      generatedValue: [
        {
          segmentKey: "interaction-1:12",
          originalText: "parachutes",
          suggestedText: "paracetamol",
          reason: "Paracetamol better matches the surrounding medication context.",
          confidence: "high",
        },
      ],
      interactionId: "interaction-1",
      segments: [segment("The patient has been taking parachutes for pain.")],
      createId: () => "suggestion-1",
    });

    expect(result).toEqual({
      suggestions: [
        {
          suggestionId: "suggestion-1",
          segmentKey: "interaction-1:12",
          originalText: "parachutes",
          suggestedText: "paracetamol",
          originalStart: 28,
          originalEnd: 38,
          reason: "Paracetamol better matches the surrounding medication context.",
          confidence: "high",
          requiresConfirmation: true,
        },
      ],
      rejectedSuggestionCount: 0,
    });
  });

  it("treats an empty review as a successful no-change result", () => {
    expect(
      normalizeTranscriptReview({
        generatedValue: [],
        interactionId: "interaction-1",
        segments: [segment("Continue the current medication.")],
      }),
    ).toEqual({ suggestions: [], rejectedSuggestionCount: 0 });
  });

  it("rejects low confidence, invented source text, and cosmetic rewrites", () => {
    const result = normalizeTranscriptReview({
      generatedValue: [
        {
          segmentKey: "interaction-1:12",
          originalText: "parachutes",
          suggestedText: "paracetamol",
          reason: "Possible medication term.",
          confidence: "medium",
        },
        {
          segmentKey: "interaction-1:12",
          originalText: "invented phrase",
          suggestedText: "paracetamol",
          reason: "Not grounded.",
          confidence: "high",
        },
        {
          segmentKey: "interaction-1:12",
          originalText: "parachutes",
          suggestedText: "Parachutes",
          reason: "Capitalization only.",
          confidence: "high",
        },
      ],
      interactionId: "interaction-1",
      segments: [segment("The patient said parachutes.")],
    });

    expect(result).toEqual({ suggestions: [], rejectedSuggestionCount: 3 });
  });

  it.each([
    ["no chest pain", "chest pain"],
    ["didn't fall", "did fall"],
    ["5 mg", "50 mg"],
    ["allergic to penicillin", "taking penicillin"],
    ["review at 3 pm", "review at 3 am"],
    ["review on Monday", "review on Tuesday"],
    ["take it daily", "take it weekly"],
  ])("never proposes protected clinical changes from %s to %s", (originalText, suggestedText) => {
    const result = normalizeTranscriptReview({
      generatedValue: [
        {
          segmentKey: "interaction-1:12",
          originalText,
          suggestedText,
          reason: "Unsafe generated change.",
          confidence: "high",
        },
      ],
      interactionId: "interaction-1",
      segments: [segment(`They said ${originalText}.`)],
    });

    expect(result).toEqual({ suggestions: [], rejectedSuggestionCount: 1 });
  });

  it("never proposes a change to a protected patient name", () => {
    const result = normalizeTranscriptReview({
      generatedValue: [
        {
          segmentKey: "interaction-1:12",
          originalText: "Jensen",
          suggestedText: "Jenson",
          reason: "Possible name spelling.",
          confidence: "high",
        },
      ],
      interactionId: "interaction-1",
      segments: [segment("The patient is Karen Jensen.")],
      protectedTerms: ["Karen Jensen"],
    });

    expect(result).toEqual({ suggestions: [], rejectedSuggestionCount: 1 });
  });

  it("rejects overlapping replacements for the same exact phrase", () => {
    const result = normalizeTranscriptReview({
      generatedValue: [
        {
          segmentKey: "interaction-1:12",
          originalText: "taking parachutes",
          suggestedText: "taking paracetamol",
          reason: "Possible medication phrase.",
          confidence: "high",
        },
        {
          segmentKey: "interaction-1:12",
          originalText: "parachutes",
          suggestedText: "paracetamol",
          reason: "Possible medication word.",
          confidence: "high",
        },
      ],
      interactionId: "interaction-1",
      segments: [segment("The patient is taking parachutes.")],
      createId: () => "suggestion-1",
    });

    expect(result.suggestions).toHaveLength(1);
    expect(result.rejectedSuggestionCount).toBe(1);
  });
});

describe("transcriptReviewContext", () => {
  it("includes only final segments from the requested interaction and deduplicated hints", () => {
    const value = JSON.parse(
      transcriptReviewContext(
        "interaction-1",
        [
          segment("Final wording."),
          segment("Interim wording.", { segmentKey: "interim", isFinal: false }),
          segment("Another interaction.", {
            interactionId: "interaction-2",
            segmentKey: "interaction-2:1",
          }),
        ],
        [" paracetamol ", "paracetamol", ""],
        [" Karen Jensen ", "Karen Jensen"],
      ),
    ) as Record<string, unknown>;

    expect(value).toEqual({
      interactionId: "interaction-1",
      contextTerms: ["paracetamol"],
      protectedTerms: ["Karen Jensen"],
      finalSegments: [
        { segmentKey: "interaction-1:12", text: "Final wording." },
      ],
    });
  });
});
