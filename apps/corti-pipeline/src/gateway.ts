import type {
  AmbientSession,
  CodingResult,
  CodingSystem,
  FollowThroughCandidate,
  GeneratedSupportingDocument,
  RenderedHandover,
  RenderHandoverInput,
  ScopedToken,
  SupportingDocumentType,
  TranscriptReviewResult,
  TranscriptSegment,
} from "./contracts.js";

export interface GenerateCandidatesInput {
  patientId: string;
  interactionId: string;
  correlationId: string;
  segments: TranscriptSegment[];
}

export interface GenerateCandidatesResult {
  candidates: FollowThroughCandidate[];
  rejectedEvidenceCount: number;
  rejectedAudioQualityCount: number;
  creditsConsumed: number;
}

export interface ReviewTranscriptInput {
  interactionId: string;
  correlationId: string;
  segments: TranscriptSegment[];
  contextTerms: string[];
  protectedTerms: string[];
}

export interface GenerateSupportingDocumentInput {
  approvalId: string;
  approvedClinicalText: string;
  documentType: SupportingDocumentType;
}

export interface PredictCodesInput {
  approvalId: string;
  approvedClinicalText: string;
  system?: CodingSystem;
}

export interface CortiGateway {
  createAmbientSession(encounterIdentifier?: string): Promise<AmbientSession>;
  mintAmbientToken(): Promise<ScopedToken>;
  mintDictationToken(): Promise<ScopedToken>;
  generateCandidates(
    input: GenerateCandidatesInput,
  ): Promise<GenerateCandidatesResult>;
  reviewTranscript(input: ReviewTranscriptInput): Promise<TranscriptReviewResult>;
  generateSupportingDocument(
    input: GenerateSupportingDocumentInput,
  ): Promise<GeneratedSupportingDocument>;
  renderHandover(input: RenderHandoverInput): Promise<RenderedHandover>;
  predictCodes(input: PredictCodesInput): Promise<CodingResult>;
}
