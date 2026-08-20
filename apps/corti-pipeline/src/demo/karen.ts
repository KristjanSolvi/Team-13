import type {
  FollowThroughCandidate,
  TranscriptSegment,
} from "../contracts.js";

export const KAREN_DEMO_PATIENT_ID = "synthetic-karen";
export const KAREN_DEMO_INTERACTION_ID = "preloaded-karen-interaction";
export const KAREN_DEMO_ARTIFACT_LABEL = "preloaded demo fallback";

/**
 * Disclosed transcript fallback for testing Text Generation independently of a
 * browser microphone. It is synthetic and must never be presented as a live
 * Ambient result.
 */
export const KAREN_PRELOADED_SEGMENTS: readonly TranscriptSegment[] = [
  {
    interactionId: KAREN_DEMO_INTERACTION_ID,
    segmentKey: `${KAREN_DEMO_INTERACTION_ID}:0`,
    text: "We are mainly talking about what needs to happen before I go home.",
    startSeconds: 0,
    endSeconds: 5,
    speakerId: 0,
    isFinal: true,
    audioQuality: "clear",
  },
  {
    interactionId: KAREN_DEMO_INTERACTION_ID,
    segmentKey: `${KAREN_DEMO_INTERACTION_ID}:6`,
    text: "I have felt dizzy since my medication changed, and my daughter does not know who is checking my blood pressure after I go home.",
    startSeconds: 6,
    endSeconds: 15,
    speakerId: 1,
    isFinal: true,
    audioQuality: "clear",
  },
  {
    interactionId: KAREN_DEMO_INTERACTION_ID,
    segmentKey: `${KAREN_DEMO_INTERACTION_ID}:16`,
    text: "Thank you for mentioning that. I will review it before we finish.",
    startSeconds: 16,
    endSeconds: 21,
    speakerId: 0,
    isFinal: true,
    audioQuality: "clear",
  },
];

/**
 * A deterministic fallback for the candidate display only. The UI must retain
 * the artifact label so it cannot be mistaken for a live Corti response.
 */
export const KAREN_PRELOADED_CANDIDATE: FollowThroughCandidate = {
  schemaVersion: "1",
  candidateId: "preloaded-demo-fallback-karen-1",
  correlationId: "preloaded-demo-fallback",
  interactionId: KAREN_DEMO_INTERACTION_ID,
  patientId: KAREN_DEMO_PATIENT_ID,
  category: "medication-concern",
  summary:
    "Patient reports dizziness since a medication change and uncertainty about blood-pressure follow-up.",
  evidence: [
    {
      interactionId: KAREN_DEMO_INTERACTION_ID,
      segmentKey: `${KAREN_DEMO_INTERACTION_ID}:6`,
      sourceQuote:
        "I have felt dizzy since my medication changed, and my daughter does not know who is checking my blood pressure after I go home.",
      startSeconds: 6,
      endSeconds: 15,
      speakerId: 1,
      audioQuality: "clear",
    },
  ],
  status: "candidate",
};

/**
 * This is deliberately downstream of an explicit synthetic clinician approval.
 * It contains the approved concern and action and is the only demo text sent to
 * supporting-document generation or Medical Coding.
 */
export const KAREN_APPROVED_OUTPUT_INPUT = {
  approvalId: "synthetic-demo-approval-karen-1",
  approvedClinicalText:
    "Patient reports dizziness since a medication change. Clinician-approved follow-through action: District Nursing Team to check blood pressure within 48 hours. Clinical urgency: medium.",
  documentType: "receiving-team-handoff" as const,
  codingSystem: "icd10int-outpatient" as const,
};
