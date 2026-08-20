import type { Corti } from "@corti/sdk";

import type { TranscriptSegment } from "./contracts.js";

function segmentKey(interactionId: string, startSeconds: number): string {
  return `${interactionId}:${startSeconds}`;
}

export function normalizeStreamTranscript(
  input: Corti.StreamTranscript,
): TranscriptSegment {
  const segment: TranscriptSegment = {
    interactionId: input.id,
    segmentKey: segmentKey(input.id, input.time.start),
    text: input.transcript,
    startSeconds: input.time.start,
    endSeconds: input.time.end,
    isFinal: input.final,
  };

  if (input.speakerId >= 0) {
    segment.speakerId = input.speakerId;
  }

  return segment;
}

export function mergeTranscriptSegments(
  previous: readonly TranscriptSegment[],
  incoming: readonly TranscriptSegment[],
): TranscriptSegment[] {
  const merged = new Map<string, TranscriptSegment>();

  for (const segment of [...previous, ...incoming]) {
    merged.set(segment.segmentKey, segment);
  }

  return [...merged.values()].sort((left, right) => {
    if (left.startSeconds !== right.startSeconds) {
      return left.startSeconds - right.startSeconds;
    }
    return left.segmentKey.localeCompare(right.segmentKey);
  });
}

export function canonicalTranscriptText(
  segments: readonly TranscriptSegment[],
): string {
  return segments
    .filter((segment) => segment.isFinal)
    .sort((left, right) => left.startSeconds - right.startSeconds)
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join("\n");
}
