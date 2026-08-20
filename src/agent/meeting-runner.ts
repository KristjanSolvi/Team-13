import { randomUUID } from "node:crypto";

import { DomainError } from "../domain/errors.js";
import type { MeetingReconciliation } from "../domain/meeting.js";
import type { SqliteStore } from "../infra/store.js";
import {
  claimMeetingAgentContext,
  verifyMeetingAgentReconciliation,
} from "../services/meeting-verification.js";
import type { AgentGateway, AgentResult } from "./runner.js";

export interface GenerateMeetingReconciliationInput {
  reconciliationId: string;
  patientId: string;
  idempotencyKey: string;
}

function requireCompletedInContext(
  result: AgentResult,
  contextId: string,
): void {
  if (result.contextId !== contextId) {
    throw new DomainError(
      "AGENT_CONTEXT_MISMATCH",
      "Corti returned a different meeting context",
      true,
      502,
    );
  }
  if (result.state !== "completed") {
    throw new DomainError(
      "AGENT_TASK_INCOMPLETE",
      "Corti did not complete meeting reconciliation",
      true,
      502,
    );
  }
}

export class MeetingAgentRunner {
  constructor(
    private readonly gateway: AgentGateway,
    private readonly store: SqliteStore,
    private readonly mcpToken: string,
  ) {}

  async generate(
    input: GenerateMeetingReconciliationInput,
  ): Promise<MeetingReconciliation> {
    const requested = this.store.requireMeetingReconciliation(
      input.reconciliationId,
    );
    if (requested.patientId !== input.patientId) {
      throw new DomainError(
        "PATIENT_SCOPE_DENIED",
        "Patient scope is unavailable",
        false,
        403,
      );
    }
    if (
      requested.idempotencyKey !== input.idempotencyKey ||
      requested.status !== "requested"
    ) {
      throw new DomainError(
        "MEETING_RECONCILIATION_CONFLICT",
        "Meeting reconciliation cannot be generated more than once",
        false,
        409,
      );
    }

    const contextId = randomUUID();
    if (
      !claimMeetingAgentContext(this.store, {
        reconciliationId: input.reconciliationId,
        contextId,
        occurredAt: new Date().toISOString(),
      })
    ) {
      throw new DomainError(
        "AGENT_CONTEXT_INITIALIZATION_FAILED",
        "Corti could not initialize a fresh meeting context",
        true,
        502,
      );
    }

    const submitted = await this.gateway.send({
      contextId,
      text: "Reconcile the explicitly selected patient meeting segment. Save grounded draft tasks and carry-forward warnings exactly once.",
      data: {
        reconciliationId: requested.reconciliationId,
        patientId: requested.patientId,
        expectedVersion: requested.version,
        sourceSnapshotHash: requested.sourceSnapshotHash,
        saveIdempotencyKey: `${input.idempotencyKey}:save`,
        mcpToken: this.mcpToken,
      },
    });
    const completed = await this.gateway.waitForCompletion(submitted);
    requireCompletedInContext(completed, contextId);

    const persisted = this.store.requireMeetingReconciliation(
      input.reconciliationId,
    );
    if (persisted.status !== "saved" || persisted.contextId !== contextId) {
      throw new DomainError(
        "MEETING_RECONCILIATION_UNCONFIRMED",
        "Corti completed without saving one meeting reconciliation",
        true,
        502,
      );
    }
    return verifyMeetingAgentReconciliation(this.store, {
      reconciliationId: input.reconciliationId,
      contextId,
      idempotencyKey: input.idempotencyKey,
    });
  }
}
