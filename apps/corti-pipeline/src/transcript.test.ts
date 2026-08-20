import { describe, expect, it } from "vitest";

import type { TranscriptSegment } from "./contracts.js";
import {
  canonicalTranscriptText,
  mergeTranscriptSegments,
} from "./transcript.js";

function segment(
  key: string,
  startSeconds: number,
  text: string,
  isFinal: boolean,
): TranscriptSegment {
  return {
    interactionId: "interaction-1",
    segmentKey: key,
    text,
    startSeconds,
    endSeconds: startSeconds + 1,
    isFinal,
  };
}

describe("mergeTranscriptSegments", () => {
  it("replaces interim text with final text without losing other utterances", () => {
    const previous = [segment("i:1", 1, "I have been", false)];
    const incoming = [
      segment("i:3", 3, "Who is checking it?", true),
      segment("i:1", 1, "I have been dizzy.", true),
    ];

    expect(mergeTranscriptSegments(previous, incoming)).toEqual([
      segment("i:1", 1, "I have been dizzy.", true),
      segment("i:3", 3, "Who is checking it?", true),
    ]);
  });

  it("creates canonical text from final segments only", () => {
    const segments = [
      segment("i:2", 2, "Not final", false),
      segment("i:3", 3, "Second sentence.", true),
      segment("i:1", 1, "First sentence.", true),
    ];

    expect(canonicalTranscriptText(segments)).toBe(
      "First sentence.\nSecond sentence.",
    );
  });
});
