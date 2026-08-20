import { DomainError } from "../domain/errors.js";
import type { MeetingReconciliation } from "../domain/meeting.js";
import type { SqliteStore } from "../infra/store.js";

const VERIFICATION_SCOPE = "meeting-agent-verified";

interface ClaimMeetingAgentContextInput {
  reconciliationId: string;
  contextId: string;
  occurredAt: string;
}

interface VerifyMeetingAgentInput {
  reconciliationId: string;
  contextId: string;
  idempotencyKey: string;
}

interface MeetingAgentMarker {
  reconciliationId: string;
  contextId: string;
  version: number;
}

export function meetingAgentVerificationScope(
  reconciliationId: string,
): string {
  return `${VERIFICATION_SCOPE}:${reconciliationId}`;
}

export function claimMeetingAgentContext(
  store: SqliteStore,
  input: ClaimMeetingAgentContextInput,
): boolean {
  return store.transaction(() => {
    const reconciliation = store.requireMeetingReconciliation(
      input.reconciliationId,
    );
    if (reconciliation.status !== "requested") {
      throw new DomainError(
        "MEETING_CONTEXT_INITIALIZATION_CONFLICT",
        "Only a requested meeting reconciliation can initialize context",
        false,
        409,
      );
    }
    if (
      !store.claimFreshContext(
        input.contextId,
        reconciliation.interactionId,
        reconciliation.patientId,
        input.occurredAt,
      )
    ) {
      return false;
    }
    store.appendEvent({
      eventType: "meeting.context_initialized",
      occurredAt: input.occurredAt,
      correlationId: `meeting-agent:${reconciliation.reconciliationId}`,
      patientId: reconciliation.patientId,
      interactionId: reconciliation.interactionId,
      contextId: input.contextId,
      actor: { type: "agent", id: "corti-meeting" },
      payload: {
        meetingId: reconciliation.meetingId,
        segmentId: reconciliation.patientSegmentId,
        reconciliationId: reconciliation.reconciliationId,
        contextId: input.contextId,
        status: reconciliation.status,
        version: reconciliation.version,
      },
    });
    return true;
  });
}

export function verifyMeetingAgentReconciliation(
  store: SqliteStore,
  input: VerifyMeetingAgentInput,
): MeetingReconciliation {
  return store.transaction(() => {
    const reconciliation = store.requireMeetingReconciliation(
      input.reconciliationId,
    );
    if (
      reconciliation.status !== "saved" ||
      reconciliation.contextId !== input.contextId ||
      reconciliation.idempotencyKey !== input.idempotencyKey
    ) {
      throw new DomainError(
        "MEETING_RECONCILIATION_UNCONFIRMED",
        "Completed Corti work does not match a saved reconciliation",
        true,
        502,
      );
    }
    const expected = markerFor(reconciliation, input.contextId);
    const scope = meetingAgentVerificationScope(input.reconciliationId);
    const existing = store.getProcessedCommand(scope, input.idempotencyKey);
    if (existing) {
      if (markerMatches(existing, expected)) return reconciliation;
      throw new DomainError(
        "MEETING_AGENT_VERIFICATION_CONFLICT",
        "Stored meeting verification does not match the reconciliation",
        false,
        409,
      );
    }
    store.saveProcessedCommand(
      scope,
      input.idempotencyKey,
      expected,
      reconciliation.updatedAt,
    );
    return reconciliation;
  });
}

export function isMeetingAgentReconciliationVerified(
  store: SqliteStore,
  reconciliation: MeetingReconciliation,
): boolean {
  if (reconciliation.status !== "saved" || reconciliation.contextId === null) {
    return false;
  }
  const marker = store.getProcessedCommand(
    meetingAgentVerificationScope(reconciliation.reconciliationId),
    reconciliation.idempotencyKey,
  );
  return (
    marker !== null &&
    markerMatches(marker, markerFor(reconciliation, reconciliation.contextId))
  );
}

function markerFor(
  reconciliation: MeetingReconciliation,
  contextId: string,
): MeetingAgentMarker {
  return {
    reconciliationId: reconciliation.reconciliationId,
    contextId,
    version: reconciliation.version,
  };
}

function markerMatches(
  value: Record<string, unknown>,
  expected: MeetingAgentMarker,
): boolean {
  return (
    Object.keys(value).toSorted().join(",") ===
      "contextId,reconciliationId,version" &&
    value.reconciliationId === expected.reconciliationId &&
    value.contextId === expected.contextId &&
    value.version === expected.version
  );
}
