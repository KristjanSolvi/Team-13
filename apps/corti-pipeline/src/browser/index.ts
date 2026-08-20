export { AmbientCapture } from "./ambient.js";
export type { AmbientCaptureOptions } from "./ambient.js";
export { bindCortiDictation } from "./dictation.js";
export type { BindDictationOptions } from "./dictation.js";
export {
  buildSpeechAudioConstraints,
  markTranscriptAudioQuality,
  normalizeAudioQualityEvent,
  normalizeSpeechKeyterms,
} from "./speech.js";
export type { SpeechQualityWindow } from "./speech.js";
export {
  generateCandidates,
  generateSupportingDocument,
  getDictationToken,
  investigateCandidate,
  predictMedicalCodes,
  refreshAmbientToken,
  startAmbientSession,
  submitConfirmedTaskCorrection,
} from "./http.js";
export type {
  CandidateGenerationResponse,
  CandidateInvestigationResponse,
} from "./http.js";
