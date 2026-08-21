import type { TranscriptSegment } from "../contracts.js";

export type ConversationSpeakerLabel = "Doctor" | "Patient" | `Speaker ${number}`;

/**
 * Corti speaker IDs are identifiers, not clinical roles. Assign display roles
 * from the first chronological appearance of each distinct diarized speaker.
 */
export function transcriptSpeakerLabels(
  segments: readonly TranscriptSegment[],
): ReadonlyMap<number, ConversationSpeakerLabel> {
  const labels = new Map<number, ConversationSpeakerLabel>();
  const ordered = [...segments].sort((left, right) => {
    if (left.startSeconds !== right.startSeconds) {
      return left.startSeconds - right.startSeconds;
    }
    return left.segmentKey.localeCompare(right.segmentKey);
  });

  for (const segment of ordered) {
    if (segment.speakerId === undefined || labels.has(segment.speakerId)) continue;
    const speakerNumber = labels.size + 1;
    labels.set(
      segment.speakerId,
      speakerNumber === 1 ? "Doctor" : speakerNumber === 2 ? "Patient" : `Speaker ${speakerNumber}`,
    );
  }

  return labels;
}
