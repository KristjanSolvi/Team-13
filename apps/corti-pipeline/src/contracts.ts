export const candidateCategories = [
  "symptom",
  "medication-concern",
  "investigation",
  "referral",
  "follow-up",
  "social-barrier",
] as const;

export type CandidateCategory = (typeof candidateCategories)[number];

export interface TranscriptSegment {
  interactionId: string;
  segmentKey: string;
  text: string;
  startSeconds: number;
  endSeconds: number;
  speakerId?: number;
  isFinal: boolean;
}

export interface EvidenceReference {
  interactionId: string;
  sourceQuote: string;
  startSeconds: number;
  endSeconds: number;
  speakerId?: number;
}

export interface FollowThroughCandidate {
  candidateId: string;
  interactionId: string;
  patientId: string;
  category: CandidateCategory;
  summary: string;
  evidence: EvidenceReference[];
  status: "candidate";
}

export interface RevisionPatch {
  description?: string;
  recipientTeamId?: string;
  ownerUserId?: string | null;
  dueAt?: string;
  priority?: "routine" | "urgent";
}

export interface TaskRevisionDraft {
  taskId: string;
  inputMethod: "typed" | "dictated";
  transcript?: string;
  patch: RevisionPatch;
  reason?: string;
}

export interface TaskRevisionPreview {
  draft: TaskRevisionDraft;
  warnings: string[];
  requiresConfirmation: true;
}

export interface DirectoryOption {
  id: string;
  label: string;
  aliases?: string[];
}

export interface PipelineErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
  correlationId: string;
}

export interface PipelineEventMap {
  "ambient.started": { startedAt: string };
  "transcript.interim": { segments: TranscriptSegment[] };
  "transcript.final": { segments: TranscriptSegment[] };
  "ambient.ended": { creditsConsumed?: number };
  "candidate.proposed": { candidate: FollowThroughCandidate };
  "candidate.rejected": { candidateId?: string; reason: string };
  "dictation.interim": { text: string; startSeconds: number; endSeconds: number };
  "dictation.final": { text: string; startSeconds: number; endSeconds: number };
  "document.generated": { documentType: SupportingDocumentType; creditsConsumed: number };
  "coding.completed": { system: CodingSystem; creditsConsumed: number };
  "usage.updated": { product: "ambient" | "dictation"; creditsConsumed: number };
  "pipeline.error": PipelineErrorPayload;
}

export type PipelineEventType = keyof PipelineEventMap;

export type PipelineEvent<TType extends PipelineEventType = PipelineEventType> = {
  [K in TType]: {
    type: K;
    occurredAt: string;
    correlationId: string;
    interactionId?: string;
    payload: PipelineEventMap[K];
  };
}[TType];

export const codingSystems = [
  "icd10int-outpatient",
  "icd10int-inpatient",
  "icd10cm-outpatient",
  "icd10cm-inpatient",
] as const;

export type CodingSystem = (typeof codingSystems)[number];

export interface NormalizedCodingEvidence {
  contextIndex: number;
  text: string;
  start: number;
  end: number;
}

export interface NormalizedCodeSuggestion {
  system: CodingSystem;
  code: string;
  display: string;
  evidences: NormalizedCodingEvidence[];
  alternatives: Array<{ code: string; display: string }>;
  evidenceStatus: "validated" | "unavailable";
}

export interface CodingResult {
  system: CodingSystem;
  codes: NormalizedCodeSuggestion[];
  candidates: NormalizedCodeSuggestion[];
  creditsConsumed: number;
}

export const supportingDocumentTypes = [
  "clinical-note",
  "receiving-team-handoff",
  "patient-receipt",
] as const;

export type SupportingDocumentType = (typeof supportingDocumentTypes)[number];

export interface GeneratedSupportingDocument {
  documentType: SupportingDocumentType;
  name: string;
  sections: Array<{ sectionId: string; heading: string; text: string }>;
  creditsConsumed: number;
  status: "draft";
}

export interface AmbientSession {
  interactionId: string;
  accessToken: string;
  expiresIn: number;
  tenantName: string;
  environment: string;
  primaryLanguage: string;
  outputLanguage: string;
}

export interface ScopedToken {
  accessToken: string;
  expiresIn: number;
}
