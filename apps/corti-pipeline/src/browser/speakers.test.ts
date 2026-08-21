import { describe, expect, it } from "vitest";

import type { TranscriptSegment } from "../contracts.js";
import { transcriptSpeakerLabels } from "./speakers.js";

function segment(segmentKey: string, startSeconds: number, speakerId?: number): TranscriptSegment {
  return {
    interactionId: "interaction-1",
    segmentKey,
    text: segmentKey,
    startSeconds,
    endSeconds: startSeconds + 1,
    isFinal: true,
    ...(speakerId === undefined ? {} : { speakerId }),
  };
}

describe("transcriptSpeakerLabels", () => {
  it("labels distinct speakers by chronological appearance, not numeric ID", () => {
    const labels = transcriptSpeakerLabels([
      segment("second", 4, 2),
      segment("first", 1, 17),
      segment("doctor-again", 6, 17),
    ]);

    expect([...labels.entries()]).toEqual([
      [17, "Doctor"],
      [2, "Patient"],
    ]);
  });

  it("leaves undiarized segments unlabeled and gives later speakers neutral labels", () => {
    const labels = transcriptSpeakerLabels([
      segment("unknown", 0),
      segment("first", 1, 8),
      segment("second", 2, 4),
      segment("third", 3, 12),
    ]);

    expect([...labels.entries()]).toEqual([
      [8, "Doctor"],
      [4, "Patient"],
      [12, "Speaker 3"],
    ]);
  });
});
