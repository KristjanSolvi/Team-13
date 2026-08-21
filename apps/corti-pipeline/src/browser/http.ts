import type {
  AmbientFact,
  AmbientSession,
  CodingResult,
  CodingSystem,
  FollowThroughCandidate,
  GeneratedSupportingDocument,
  ScopedToken,
  SupportingDocumentType,
  TaskRevisionDraft,
  TranscriptSegment,
} from "../contracts.js";
import {
  buildIntegrationCandidateRequest,
  buildTaskCorrectionCommand,
} from "../integration-handoff.js";

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Pipeline request failed with status ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

function requestHeaders(correlationId?: string): Record<string, string> {
  return correlationId === undefined
    ? { "content-type": "application/json" }
    : {
        "content-type": "application/json",
        "x-correlation-id": correlationId,
      };
}

export async function startAmbientSession(
  pipelineBaseUrl: string,
  encounterIdentifier?: string,
  correlationId?: string,
): Promise<AmbientSession> {
  const body =
    encounterIdentifier === undefined ? {} : { encounterIdentifier };
  const response = await fetch(
    new URL("/api/corti/ambient/session", pipelineBaseUrl),
    {
      method: "POST",
      headers: requestHeaders(correlationId),
      body: JSON.stringify(body),
    },
  );
  return responseJson<AmbientSession>(response);
}

export async function refreshAmbientToken(
  pipelineBaseUrl: string,
  correlationId?: string,
): Promise<ScopedToken> {
  const response = await fetch(
    new URL("/api/corti/ambient/token", pipelineBaseUrl),
    { method: "POST", headers: requestHeaders(correlationId) },
  );
  return responseJson<ScopedToken>(response);
}

export async function getDictationToken(
  pipelineBaseUrl: string,
  correlationId?: string,
): Promise<ScopedToken> {
  const response = await fetch(
    new URL("/api/corti/dictation/token", pipelineBaseUrl),
    { method: "POST", headers: requestHeaders(correlationId) },
  );
  return responseJson<ScopedToken>(response);
}

export interface CandidateInvestigationResponse {
  candidateId: string;
  handoff: unknown;
}

export interface CandidateGenerationResponse {
  candidates: FollowThroughCandidate[];
  rejectedEvidenceCount: number;
  rejectedAudioQualityCount: number;
  creditsConsumed: number;
}

export async function generateCandidates(
  pipelineBaseUrl: string,
  input: {
    patientId: string;
    interactionId: string;
    segments: readonly TranscriptSegment[];
    facts?: readonly AmbientFact[];
  },
  correlationId: string,
): Promise<CandidateGenerationResponse> {
  const response = await fetch(
    new URL("/api/corti/candidates/generate", pipelineBaseUrl),
    {
      method: "POST",
      headers: requestHeaders(correlationId),
      body: JSON.stringify(input),
    },
  );
  return responseJson<CandidateGenerationResponse>(response);
}

export async function generateSupportingDocument(
  pipelineBaseUrl: string,
  input: {
    approvalId: string;
    approvedClinicalText: string;
    documentType: SupportingDocumentType;
  },
  correlationId: string,
): Promise<GeneratedSupportingDocument> {
  const response = await fetch(
    new URL("/api/corti/documents/generate", pipelineBaseUrl),
    {
      method: "POST",
      headers: requestHeaders(correlationId),
      body: JSON.stringify(input),
    },
  );
  return responseJson<GeneratedSupportingDocument>(response);
}

export async function predictMedicalCodes(
  pipelineBaseUrl: string,
  input: {
    approvalId: string;
    approvedClinicalText: string;
    system?: CodingSystem;
  },
  correlationId: string,
): Promise<CodingResult> {
  const response = await fetch(
    new URL("/api/corti/coding/predict", pipelineBaseUrl),
    {
      method: "POST",
      headers: requestHeaders(correlationId),
      body: JSON.stringify(input),
    },
  );
  return responseJson<CodingResult>(response);
}

/** Send a reviewed pipeline candidate through the integration API boundary. */
export async function investigateCandidate(
  integrationBaseUrl: string,
  candidate: FollowThroughCandidate,
): Promise<CandidateInvestigationResponse> {
  const request = buildIntegrationCandidateRequest(candidate);
  const response = await fetch(
    new URL("/api/candidates/investigate", integrationBaseUrl),
    {
      method: "POST",
      headers: requestHeaders(request.correlationId),
      body: JSON.stringify(request.body),
    },
  );
  return responseJson<CandidateInvestigationResponse>(response);
}

/**
 * Submit a correction only after the product UI has shown the preview and the
 * clinician has explicitly confirmed it.
 */
export async function submitConfirmedTaskCorrection(
  integrationBaseUrl: string,
  draft: TaskRevisionDraft,
  actorId: string,
  correlationId: string,
): Promise<unknown> {
  const response = await fetch(
    new URL(`/api/tasks/${encodeURIComponent(draft.taskId)}/correct`, integrationBaseUrl),
    {
      method: "POST",
      headers: {
        ...requestHeaders(correlationId),
        "x-actor-id": actorId,
      },
      body: JSON.stringify(buildTaskCorrectionCommand(draft)),
    },
  );
  return responseJson<unknown>(response);
}
