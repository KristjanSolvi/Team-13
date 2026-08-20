import type {
  AmbientSession,
  CodingResult,
  CodingSystem,
  FollowThroughCandidate,
  GeneratedSupportingDocument,
  ScopedToken,
  SupportingDocumentType,
  TranscriptSegment,
} from "./contracts.js";

export interface GenerateCandidatesInput {
  patientId: string;
  interactionId: string;
  segments: TranscriptSegment[];
}

export interface GenerateCandidatesResult {
  candidates: FollowThroughCandidate[];
  rejectedEvidenceCount: number;
  creditsConsumed: number;
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
  generateSupportingDocument(
    input: GenerateSupportingDocumentInput,
  ): Promise<GeneratedSupportingDocument>;
  predictCodes(input: PredictCodesInput): Promise<CodingResult>;
}
