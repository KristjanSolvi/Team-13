import { describe, expect, it } from "vitest";

import type { TranscriptSegment } from "./contracts.js";
import { locateExactQuote, validateCodingEvidence } from "./evidence.js";

const segment: TranscriptSegment = {
  interactionId: "interaction-1",
  segmentKey: "interaction-1:12",
  text: "I have been dizzy since my medication changed.",
  startSeconds: 12,
  endSeconds: 16,
  speakerId: 1,
  isFinal: true,
};

describe("evidence validation", () => {
  it("retains only an exact transcript quote", () => {
    expect(locateExactQuote([segment], "dizzy since my medication changed")).toEqual({
      interactionId: "interaction-1",
      sourceQuote: "dizzy since my medication changed",
      startSeconds: 12,
      endSeconds: 16,
      speakerId: 1,
    });
    expect(locateExactQuote([segment], "dizzy after my medication changed")).toBeNull();
  });

  it("uses inclusive start and exclusive end for coding evidence", () => {
    const text = "Patient reports dizziness.";
    expect(
      validateCodingEvidence([text], {
        contextIndex: 0,
        text: "dizziness",
        start: 16,
        end: 25,
      }),
    ).toEqual({ contextIndex: 0, text: "dizziness", start: 16, end: 25 });

    expect(
      validateCodingEvidence([text], {
        contextIndex: 0,
        text: "dizzy",
        start: 16,
        end: 25,
      }),
    ).toBeNull();
  });
});
