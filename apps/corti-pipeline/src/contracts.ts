export const candidateCategories = [
  "symptom",
  "medication-concern",
  "investigation",
  "referral",
  "follow-up",
  "social-barrier",
] as const;

export type CandidateCategory = (typeof candidateCategories)[number];

export const audioQualityStates = ["clear", "uncertain"] as const;

export type AudioQualityState = (typeof audioQualityStates)[number];

export interface TranscriptSegment {
  interactionId: string;
  segmentKey: string;
  text: string;
  startSeconds: number;
  endSeconds: number;
  speakerId?: number;
  isFinal: boolean;
  audioQuality?: AudioQualityState;
}

export interface TranscriptReviewSuggestion {
  suggestionId: string;
  segmentKey: string;
  originalText: string;
  suggestedText: string;
  originalStart: number;
  originalEnd: number;
  reason: string;
  confidence: "high";
  requiresConfirmation: true;
}

export interface TranscriptReviewResult {
  status: "reviewed";
  suggestions: TranscriptReviewSuggestion[];
  rejectedSuggestionCount: number;
  creditsConsumed: number;
  originalTranscriptPreserved: true;
}

export interface EvidenceReference {
  interactionId: string;
  segmentKey: string;
  sourceQuote: string;
  startSeconds: number;
  endSeconds: number;
  speakerId?: number;
  audioQuality: AudioQualityState;
}

export interface FollowThroughCandidate {
  schemaVersion: "1";
  candidateId: string;
  correlationId: string;
  interactionId: string;
  patientId: string;
  category: CandidateCategory;
  summary: string;
  evidence: EvidenceReference[];
  status: "candidate";
}

export interface RevisionPatch {
  summary?: string;
  targetTeamId?: string;
  clinicalUrgency?: "high" | "medium" | "routine";
  dueInMs?: number;
}

export interface TaskRevisionDraft {
  taskId: string;
  expectedVersion: number;
  idempotencyKey: string;
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

export interface IntegrationCandidateRequestV1 {
  schemaVersion: "1";
  correlationId: string;
  body: FollowThroughCandidate;
}

export interface TaskCorrectionCommandV1 {
  expectedVersion: number;
  summary?: string;
  targetTeamId?: string;
  clinicalUrgency?: "high" | "medium" | "routine";
  dueInMs?: number;
  idempotencyKey: string;
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

export type AudioQualityEventState =
  | "speech-quality-issue"
  | "speech-quality-recovered"
  | "long-silence"
  | "speech-resumed";

export interface AudioQualityEventPayload {
  product: "ambient" | "dictation";
  state: AudioQualityEventState;
  channel: number;
  startSeconds: number;
}

export interface PipelineEventMap {
  "ambient.started": { startedAt: string };
  "transcript.interim": { segments: TranscriptSegment[] };
  "transcript.final": { segments: TranscriptSegment[] };
  "ambient.ended": { creditsConsumed?: number };
  "audio.quality_changed": AudioQualityEventPayload;
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
    schemaVersion: "1";
    eventId: string;
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

export interface HandoverGroundedStatement {
  statement: string;
  sourceRefs: string[];
}

export type HandoverTaskState =
  | "draft"
  | "offered_to_team"
  | "assigned_to_member"
  | "accepted"
  | "completed"
  | "escalated";

export interface HandoverTaskItem {
  taskId: string;
  threadId: string;
  summary: string;
  state: HandoverTaskState;
  targetTeamId: string;
  assignedMemberId: string | null;
  clinicalUrgency: "high" | "medium" | "routine";
  acceptBy: string;
  dueBy: string;
  version: number;
  sourceRefs: string[];
}

export interface HandoverPacket {
  situation: HandoverGroundedStatement[];
  background: HandoverGroundedStatement[];
  currentConcerns: HandoverGroundedStatement[];
  outstandingTasks: HandoverTaskItem[];
  awaitingVerification: HandoverTaskItem[];
  escalations: HandoverTaskItem[];
  unknowns: string[];
}

export interface RenderHandoverInput {
  handoverId: string;
  patientId: string;
  sourceSnapshotHash: string;
  packet: HandoverPacket;
}

export interface RenderedHandover {
  title: string;
  sections: Array<{
    sectionId: string;
    heading: string;
    statements: HandoverGroundedStatement[];
  }>;
  creditsConsumed: number;
}
