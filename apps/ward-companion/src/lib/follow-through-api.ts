import type {
  AmbientSession,
  CodingResult,
  CodingSystem,
  FollowThroughCandidate,
  GeneratedSupportingDocument,
  ScopedToken,
  SupportingDocumentType,
  TaskRevisionPreview,
  TranscriptReviewResult,
  TranscriptSegment,
} from "@pipeline/contracts.js";
import type { Thread } from "@/data/ward";

type IntegrationHealth = { status: "ok" };

export type IntegrationReadiness = {
  status: "ready" | "degraded";
  liveCortiReady: boolean;
  services: Record<
    string,
    {
      reachable: boolean;
      detail?: unknown;
      error?: unknown;
    }
  >;
};

export type WardCompanionOverview = {
  schemaVersion: "1";
  patientId: string;
  observedAt: string;
  threads: Thread[];
  changeImpacts: ChangeImpact[];
};

export type ChangeImpact = {
  impactId: string;
  revisionId: string;
  dependencyId: string;
  patientId: string;
  sourceItemId: string;
  sourceRef: string;
  artifactKind: "task" | "handover";
  artifactId: string;
  artifactVersion: number;
  status: "review_required";
  summary: string;
  detectedAt: string;
  changedAt: string;
  changedBy: string;
  reason: "new_result" | "medication_update" | "clinical_note_revision" | "other";
};

export type CandidateGenerationResult = {
  candidates: FollowThroughCandidate[];
  rejectedEvidenceCount: number;
  rejectedAudioQualityCount: number;
  creditsConsumed: number;
};

export type CandidateInvestigationResult = {
  candidateId: string;
  handoff: unknown;
};

export type ClinicalDocument = {
  schemaVersion: "1";
  documentId: string;
  patientId: string;
  category: "medical" | "discharge";
  title: string;
  content: string;
  source: "clinician" | "agent" | "scribe";
  status: "draft" | "filed";
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  filedAt: string | null;
  filedBy: string | null;
  correlationId: string;
  codingReview: ClinicalCodingReview | null;
};

export type CodingReviewInput = {
  outcome: "accepted" | "rejected" | "no-suggestions" | "unavailable";
  approvalId: string;
  system: CodingSystem;
  selectedCode: {
    suggestionKind: "supported" | "candidate";
    code: string;
    display: string;
    evidenceStatus: "validated" | "unavailable";
    evidences: Array<{ text: string; start: number; end: number }>;
  } | null;
};

export type ClinicalCodingReview = CodingReviewInput & {
  reviewedAt: string;
  reviewedBy: string;
};

export type ClinicalDocumentVersion = ClinicalDocument & {
  changeReason: string;
};

export type EhrPatientRecord = {
  schemaVersion: "1";
  patientId: string;
  profile: unknown;
  documents: ClinicalDocument[];
  observedAt: string;
};

export class FollowThroughApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly correlationId?: string,
  ) {
    super(message);
  }
}

function browserOrigin(): string {
  return window.location.origin;
}

function integrationUrl(path: string): URL {
  const configured = import.meta.env["VITE_INTEGRATION_API_URL"]?.trim();
  return configured
    ? new URL(path, configured)
    : new URL(`/follow-through-api${path}`, browserOrigin());
}

async function responseJson<T>(response: Response, acceptedStatuses: number[] = []): Promise<T> {
  const value = (await response.json().catch(() => null)) as unknown;
  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    const error =
      typeof value === "object" && value !== null && "error" in value
        ? (value as { error?: Record<string, unknown> }).error
        : undefined;
    throw new FollowThroughApiError(
      typeof error?.["message"] === "string"
        ? error["message"]
        : "Follow-Through service request failed.",
      typeof error?.["code"] === "string" ? error["code"] : "REQUEST_FAILED",
      error?.["retryable"] === true,
      typeof error?.["correlationId"] === "string"
        ? error["correlationId"]
        : (response.headers.get("x-correlation-id") ?? undefined),
    );
  }
  return value as T;
}

function jsonHeaders(correlationId: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-correlation-id": correlationId,
  };
}

function attributedJsonHeaders(correlationId: string, actorId: string): Record<string, string> {
  return {
    ...jsonHeaders(correlationId),
    "x-actor-id": actorId,
  };
}

export async function getIntegrationHealth(): Promise<IntegrationHealth> {
  return responseJson<IntegrationHealth>(await fetch(integrationUrl("/healthz")));
}

export async function getIntegrationReadiness(): Promise<IntegrationReadiness> {
  return responseJson<IntegrationReadiness>(
    await fetch(integrationUrl("/readyz")),
    // The integration API deliberately returns 503 when an optional downstream
    // service is degraded. Its body still tells us whether live Corti capture is ready.
    [503],
  );
}

export async function createAmbientSession(
  encounterIdentifier: string,
  correlationId: string,
): Promise<AmbientSession> {
  return responseJson<AmbientSession>(
    await fetch(integrationUrl("/api/corti/ambient/session"), {
      method: "POST",
      headers: jsonHeaders(correlationId),
      body: JSON.stringify({ encounterIdentifier }),
    }),
  );
}

export async function refreshAmbientToken(correlationId: string): Promise<ScopedToken> {
  return responseJson<ScopedToken>(
    await fetch(integrationUrl("/api/corti/ambient/token"), {
      method: "POST",
      headers: jsonHeaders(correlationId),
      body: "{}",
    }),
  );
}

export async function getDictationToken(correlationId: string): Promise<ScopedToken> {
  return responseJson<ScopedToken>(
    await fetch(integrationUrl("/api/corti/dictation/token"), {
      method: "POST",
      headers: jsonHeaders(correlationId),
      body: "{}",
    }),
  );
}

export async function buildDictationRevisionPreview(input: {
  taskId: string;
  expectedVersion: number;
  idempotencyKey: string;
  transcript: string;
  recipientTeams: Array<{ id: string; label: string; aliases: string[] }>;
  correlationId: string;
}): Promise<TaskRevisionPreview> {
  return responseJson<TaskRevisionPreview>(
    await fetch(integrationUrl("/api/corti/dictation/revision-preview"), {
      method: "POST",
      headers: jsonHeaders(input.correlationId),
      body: JSON.stringify({
        taskId: input.taskId,
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        transcript: input.transcript,
        recipientTeams: input.recipientTeams,
      }),
    }),
  );
}

export async function generateCandidates(input: {
  patientId: string;
  interactionId: string;
  correlationId: string;
  segments: TranscriptSegment[];
}): Promise<CandidateGenerationResult> {
  return responseJson<CandidateGenerationResult>(
    await fetch(integrationUrl("/api/corti/candidates/generate"), {
      method: "POST",
      headers: jsonHeaders(input.correlationId),
      body: JSON.stringify({
        patientId: input.patientId,
        interactionId: input.interactionId,
        segments: input.segments,
      }),
    }),
  );
}

export async function reviewTranscript(input: {
  interactionId: string;
  correlationId: string;
  segments: TranscriptSegment[];
  contextTerms: string[];
  protectedTerms: string[];
}): Promise<TranscriptReviewResult> {
  return responseJson<TranscriptReviewResult>(
    await fetch(integrationUrl("/api/corti/transcripts/review"), {
      method: "POST",
      headers: jsonHeaders(input.correlationId),
      body: JSON.stringify({
        interactionId: input.interactionId,
        segments: input.segments,
        contextTerms: input.contextTerms,
        protectedTerms: input.protectedTerms,
      }),
    }),
  );
}

export async function investigateCandidate(
  candidate: FollowThroughCandidate,
): Promise<CandidateInvestigationResult> {
  return responseJson<CandidateInvestigationResult>(
    await fetch(integrationUrl("/api/candidates/investigate"), {
      method: "POST",
      headers: jsonHeaders(candidate.correlationId),
      body: JSON.stringify(candidate),
    }),
  );
}

export type WardTaskCommand = NonNullable<Thread["backend"]>["availableCommands"][number];

/**
 * Demo actor identities seeded by the agentic backend's Karen fixture.
 * Clinician commands (approve/correct/dismiss/reopen) are attributed to the
 * clinician; accept/decline/complete must come from an eligible team member.
 */
export const demoActors = {
  clinician: "clinician-1",
  teamMember: "nurse-a",
} as const;

export async function executeTaskCommand(input: {
  taskId: string;
  command: WardTaskCommand;
  actorId: string;
  correlationId: string;
  body: Record<string, unknown>;
}): Promise<unknown> {
  return responseJson<unknown>(
    await fetch(integrationUrl(`/api/tasks/${encodeURIComponent(input.taskId)}/${input.command}`), {
      method: "POST",
      headers: {
        ...jsonHeaders(input.correlationId),
        "x-actor-id": input.actorId,
      },
      body: JSON.stringify(input.body),
    }),
  );
}

export type HandoverStatement = { statement: string; sourceRefs: string[] };
export type HandoverSection = {
  sectionId: string;
  heading: string;
  statements: HandoverStatement[];
};
export type GroundedHandover = {
  handoverId: string;
  patientId: string;
  status: "requested" | "draft" | "rendered" | "failed";
  sourceSnapshotHash: string;
  rendered: {
    title: string;
    sections: HandoverSection[];
    creditsConsumed: number;
  } | null;
};

/**
 * Ask the handover Corti agent for a fresh, evidence-linked patient handover.
 * The integration API refuses stale drafts, so a success is current by
 * construction. Requires the dev proxy to hold the integration bearer.
 */
export async function requestPatientHandover(input: {
  patientId: string;
  actorId: string;
  correlationId: string;
  focus?: string;
}): Promise<GroundedHandover> {
  const focus = input.focus?.trim();
  return responseJson<GroundedHandover>(
    await fetch(integrationUrl(`/api/patients/${encodeURIComponent(input.patientId)}/handovers`), {
      method: "POST",
      headers: {
        ...jsonHeaders(input.correlationId),
        "x-actor-id": input.actorId,
      },
      body: JSON.stringify({
        idempotencyKey: `handover-${crypto.randomUUID()}`,
        reason: "on_demand",
        focus: focus !== undefined && focus.length > 0 ? focus : null,
      }),
    }),
  );
}

export async function getWardCompanionOverview(
  patientId: string,
  correlationId: string,
): Promise<WardCompanionOverview> {
  return responseJson<WardCompanionOverview>(
    await fetch(integrationUrl(`/api/patients/${encodeURIComponent(patientId)}/companion`), {
      headers: { "x-correlation-id": correlationId },
    }),
  );
}

export async function simulateSyntheticSourceRevision(input: {
  patientId: string;
  actorId: string;
  correlationId: string;
  idempotencyKey: string;
}): Promise<unknown> {
  return responseJson<unknown>(
    await fetch(
      integrationUrl(`/api/demo/patients/${encodeURIComponent(input.patientId)}/source-revisions`),
      {
        method: "POST",
        headers: attributedJsonHeaders(input.correlationId, input.actorId),
        body: JSON.stringify({ idempotencyKey: input.idempotencyKey }),
      },
    ),
  );
}

export async function generateSupportingDocument(input: {
  approvalId: string;
  approvedClinicalText: string;
  documentType: SupportingDocumentType;
  correlationId: string;
}): Promise<GeneratedSupportingDocument> {
  return responseJson<GeneratedSupportingDocument>(
    await fetch(integrationUrl("/api/corti/documents/generate"), {
      method: "POST",
      headers: jsonHeaders(input.correlationId),
      body: JSON.stringify({
        approvalId: input.approvalId,
        approvedClinicalText: input.approvedClinicalText,
        documentType: input.documentType,
      }),
    }),
  );
}

export async function predictMedicalCodes(input: {
  approvalId: string;
  approvedClinicalText: string;
  system?: CodingSystem;
  correlationId: string;
}): Promise<CodingResult> {
  return responseJson<CodingResult>(
    await fetch(integrationUrl("/api/corti/coding/predict"), {
      method: "POST",
      headers: jsonHeaders(input.correlationId),
      body: JSON.stringify({
        approvalId: input.approvalId,
        approvedClinicalText: input.approvedClinicalText,
        ...(input.system === undefined ? {} : { system: input.system }),
      }),
    }),
  );
}

export async function getEhrPatientRecord(
  patientId: string,
  correlationId: string,
): Promise<EhrPatientRecord> {
  return responseJson<EhrPatientRecord>(
    await fetch(integrationUrl(`/api/ehr/patients/${encodeURIComponent(patientId)}`), {
      headers: { "x-correlation-id": correlationId },
    }),
  );
}

export async function createEhrDocument(input: {
  patientId: string;
  actorId: string;
  correlationId: string;
  idempotencyKey: string;
  category: ClinicalDocument["category"];
  title: string;
  content: string;
  source: ClinicalDocument["source"];
  codingReview: CodingReviewInput | null;
}): Promise<ClinicalDocument> {
  return responseJson<ClinicalDocument>(
    await fetch(
      integrationUrl(`/api/ehr/patients/${encodeURIComponent(input.patientId)}/documents`),
      {
        method: "POST",
        headers: attributedJsonHeaders(input.correlationId, input.actorId),
        body: JSON.stringify({
          idempotencyKey: input.idempotencyKey,
          category: input.category,
          title: input.title,
          content: input.content,
          source: input.source,
          codingReview: input.codingReview,
        }),
      },
    ),
  );
}

export async function reviseEhrDocument(input: {
  documentId: string;
  actorId: string;
  correlationId: string;
  expectedVersion: number;
  idempotencyKey: string;
  reason: string;
  changes: { title?: string; content?: string; codingReview?: CodingReviewInput | null };
}): Promise<ClinicalDocument> {
  return responseJson<ClinicalDocument>(
    await fetch(integrationUrl(`/api/ehr/documents/${encodeURIComponent(input.documentId)}`), {
      method: "PATCH",
      headers: attributedJsonHeaders(input.correlationId, input.actorId),
      body: JSON.stringify({
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        changes: input.changes,
      }),
    }),
  );
}

export async function fileEhrDocument(input: {
  documentId: string;
  actorId: string;
  correlationId: string;
  expectedVersion: number;
  idempotencyKey: string;
  reason: string;
}): Promise<ClinicalDocument> {
  return responseJson<ClinicalDocument>(
    await fetch(integrationUrl(`/api/ehr/documents/${encodeURIComponent(input.documentId)}/file`), {
      method: "POST",
      headers: attributedJsonHeaders(input.correlationId, input.actorId),
      body: JSON.stringify({
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
      }),
    }),
  );
}

export async function getEhrDocumentHistory(
  documentId: string,
  correlationId: string,
): Promise<{ versions: ClinicalDocumentVersion[] }> {
  return responseJson<{ versions: ClinicalDocumentVersion[] }>(
    await fetch(integrationUrl(`/api/ehr/documents/${encodeURIComponent(documentId)}/history`), {
      headers: { "x-correlation-id": correlationId },
    }),
  );
}
