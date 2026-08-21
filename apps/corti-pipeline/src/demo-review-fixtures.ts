import type { TranscriptReviewSuggestion, TranscriptSegment } from "./contracts.js";

export interface TranscriptReviewDemoFixture {
  segments: TranscriptSegment[];
  suggestions: TranscriptReviewSuggestion[];
}

const samirPatientId = "synthetic-samir";
const interactionId = "demo-samir-post-scribe";
const patientSegmentText = "The parachutes helped, but I still get pain when I move.";
const originalText = "parachutes";
const originalStart = patientSegmentText.indexOf(originalText);

/**
 * Deterministic post-scribe replay for the hackathon demo. It enters the same
 * clinician-review boundary as a completed live Ambient capture, while keeping
 * the raw transcript immutable.
 */
export function transcriptReviewDemoForPatient(
  patientId: string,
): TranscriptReviewDemoFixture | null {
  if (patientId !== samirPatientId) return null;

  return {
    segments: [
      {
        interactionId,
        segmentKey: "demo-samir-doctor-1",
        text: "How has the pain been overnight, Samir?",
        startSeconds: 0,
        endSeconds: 2.8,
        speakerId: 1,
        isFinal: true,
        audioQuality: "clear",
      },
      {
        interactionId,
        segmentKey: "demo-samir-patient-1",
        text: patientSegmentText,
        startSeconds: 3.1,
        endSeconds: 7.6,
        speakerId: 2,
        isFinal: true,
        audioQuality: "clear",
      },
    ],
    suggestions: [
      {
        suggestionId: "demo-samir-paracetamol",
        segmentKey: "demo-samir-patient-1",
        originalText,
        suggestedText: "paracetamol",
        originalStart,
        originalEnd: originalStart + originalText.length,
        reason: "The review agent recognised a likely medication-name mishearing from context.",
        confidence: "high",
        requiresConfirmation: true,
      },
    ],
  };
}
