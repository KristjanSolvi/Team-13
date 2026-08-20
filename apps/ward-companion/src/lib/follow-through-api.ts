import type {
  AmbientSession,
  FollowThroughCandidate,
  ScopedToken,
  TaskRevisionPreview,
  TranscriptSegment,
} from "@pipeline/contracts.js";
import type { Thread } from "@/data/ward";

type IntegrationHealth = { status: "ok" };

export type WardCompanionOverview = {
  schemaVersion: "1";
  patientId: string;
  observedAt: string;
  threads: Thread[];
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

async function responseJson<T>(response: Response): Promise<T> {
  const value = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
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

export async function getIntegrationHealth(): Promise<IntegrationHealth> {
  return responseJson<IntegrationHealth>(await fetch(integrationUrl("/healthz")));
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
