import { DomainError } from "../domain/errors.js";
import type { HandoverRecord } from "../domain/handover.js";
import type { SqliteStore } from "../infra/store.js";

const HANDOVER_AGENT_VERIFICATION_SCOPE = "handover-agent-verified";

interface VerifyHandoverAgentDraftInput {
  handoverId: string;
  contextId: string;
  idempotencyKey: string;
}

interface HandoverAgentVerificationMarker {
  handoverId: string;
  contextId: string;
  version: number;
}

export function handoverAgentVerificationScope(handoverId: string): string {
  return `${HANDOVER_AGENT_VERIFICATION_SCOPE}:${handoverId}`;
}

export function verifyHandoverAgentDraft(
  store: SqliteStore,
  input: VerifyHandoverAgentDraftInput,
): HandoverRecord {
  return store.transaction(() => {
    const handover = store.requireHandover(input.handoverId);
    if (
      handover.status !== "draft" ||
      handover.contextId !== input.contextId ||
      handover.idempotencyKey !== input.idempotencyKey
    ) {
      throw new DomainError(
        "HANDOVER_DRAFT_UNCONFIRMED",
        "The completed Corti task does not match the saved handover draft",
        true,
        502,
      );
    }
    const expected = markerFor(handover, input.contextId);
    const scope = handoverAgentVerificationScope(handover.handoverId);
    const existing = store.getProcessedCommand(scope, input.idempotencyKey);
    if (existing) {
      if (markerMatches(existing, expected)) return handover;
      throw new DomainError(
        "HANDOVER_AGENT_VERIFICATION_CONFLICT",
        "Stored handover agent verification does not match the draft",
        false,
        409,
      );
    }
    store.saveProcessedCommand(
      scope,
      input.idempotencyKey,
      expected,
      handover.updatedAt,
    );
    return handover;
  });
}

export function isHandoverAgentDraftVerified(
  store: SqliteStore,
  handover: HandoverRecord,
): boolean {
  if (handover.status !== "draft" || handover.contextId === null) return false;
  const marker = store.getProcessedCommand(
    handoverAgentVerificationScope(handover.handoverId),
    handover.idempotencyKey,
  );
  return (
    marker !== null &&
    markerMatches(marker, markerFor(handover, handover.contextId))
  );
}

function markerFor(
  handover: HandoverRecord,
  contextId: string,
): HandoverAgentVerificationMarker {
  return {
    handoverId: handover.handoverId,
    contextId,
    version: handover.version,
  };
}

function markerMatches(
  value: Record<string, unknown>,
  expected: HandoverAgentVerificationMarker,
): boolean {
  return (
    Object.keys(value).toSorted().join(",") ===
      "contextId,handoverId,version" &&
    value.handoverId === expected.handoverId &&
    value.contextId === expected.contextId &&
    value.version === expected.version
  );
}
