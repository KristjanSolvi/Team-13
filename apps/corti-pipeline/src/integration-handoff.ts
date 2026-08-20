import type {
  FollowThroughCandidate,
  IntegrationCandidateRequestV1,
  TaskCorrectionCommandV1,
  TaskRevisionDraft,
} from "./contracts.js";

/**
 * Builds the browser/server handoff to the integration API. The integration
 * service owns translation into the Agentic signal contract and all Agentic
 * authentication.
 */
export function buildIntegrationCandidateRequest(
  candidate: FollowThroughCandidate,
): IntegrationCandidateRequestV1 {
  if (candidate.evidence.length === 0) {
    throw new Error("A candidate needs at least one evidence item.");
  }
  if (candidate.evidence.some((evidence) => evidence.audioQuality !== "clear")) {
    throw new Error("Uncertain audio evidence cannot be investigated.");
  }
  if (
    candidate.evidence.some(
      (evidence) => evidence.interactionId !== candidate.interactionId,
    )
  ) {
    throw new Error("Candidate evidence must belong to its interaction.");
  }

  return {
    schemaVersion: "1",
    correlationId: candidate.correlationId,
    body: candidate,
  };
}

/** Builds the exact body accepted by POST /api/tasks/:taskId/correct. */
export function buildTaskCorrectionCommand(
  draft: TaskRevisionDraft,
): TaskCorrectionCommandV1 {
  if (Object.keys(draft.patch).length === 0) {
    throw new Error("A confirmed correction needs at least one changed field.");
  }
  return {
    expectedVersion: draft.expectedVersion,
    ...draft.patch,
    idempotencyKey: draft.idempotencyKey,
  };
}
