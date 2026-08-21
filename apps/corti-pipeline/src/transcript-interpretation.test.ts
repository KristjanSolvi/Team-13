import { describe, expect, it } from "vitest";

import type {
  TranscriptReviewSuggestion,
  TranscriptSegment,
} from "./contracts.js";
import { buildReviewedTranscript } from "./transcript-interpretation.js";

function segment(text: string): TranscriptSegment {
  return {
    interactionId: "interaction-1",
    segmentKey: "interaction-1:12",
    text,
    startSeconds: 12,
    endSeconds: 16,
    isFinal: true,
    audioQuality: "clear",
  };
}

function suggestion(
  originalText: string,
  suggestedText: string,
  originalStart: number,
  suggestionId = "suggestion-1",
): TranscriptReviewSuggestion {
  return {
    suggestionId,
    segmentKey: "interaction-1:12",
    originalText,
    suggestedText,
    originalStart,
    originalEnd: originalStart + originalText.length,
    reason: "Possible speech-recognition mismatch.",
    confidence: "high",
    requiresConfirmation: true,
  };
}

describe("buildReviewedTranscript", () => {
  it("uses a clinician-confirmed interpretation without mutating the raw transcript", () => {
    const raw = [segment("The patient has been taking parachutes for pain.")];
    const review = suggestion("parachutes", "paracetamol", 28);

    const result = buildReviewedTranscript(raw, [review], {
      "suggestion-1": "use-suggestion",
    });

    expect(result.segments[0]?.text).toBe(
      "The patient has been taking paracetamol for pain.",
    );
    expect(raw[0]?.text).toBe(
      "The patient has been taking parachutes for pain.",
    );
    expect(result.appliedSuggestionIds).toEqual(["suggestion-1"]);
    expect(result.keptSuggestionIds).toEqual([]);
    expect(result.originalTranscriptPreserved).toBe(true);
  });

  it("retains wording the clinician chose to keep", () => {
    const raw = [segment("The patient said parachutes.")];
    const review = suggestion("parachutes", "paracetamol", 17);

    const result = buildReviewedTranscript(raw, [review], {
      "suggestion-1": "keep",
    });

    expect(result.segments).toEqual(raw);
    expect(result.appliedSuggestionIds).toEqual([]);
    expect(result.keptSuggestionIds).toEqual(["suggestion-1"]);
  });

  it("applies multiple confirmed phrases from right to left", () => {
    const raw = [segment("parachutes then physio")];
    const reviews = [
      suggestion("parachutes", "paracetamol", 0, "medication"),
      suggestion("physio", "physiotherapy", 16, "therapy"),
    ];

    const result = buildReviewedTranscript(raw, reviews, {
      medication: "use-suggestion",
      therapy: "use-suggestion",
    });

    expect(result.segments[0]?.text).toBe("paracetamol then physiotherapy");
  });

  it("refuses to build an interpretation while a decision is missing", () => {
    expect(() =>
      buildReviewedTranscript(
        [segment("The patient said parachutes.")],
        [suggestion("parachutes", "paracetamol", 17)],
        {},
      ),
    ).toThrow(/decision is required/i);
  });

  it("refuses a stale suggestion whose exact source span no longer matches", () => {
    expect(() =>
      buildReviewedTranscript(
        [segment("The patient said paracetamol.")],
        [suggestion("parachutes", "paracetamol", 17)],
        { "suggestion-1": "use-suggestion" },
      ),
    ).toThrow(/no longer matches/i);
  });
});
