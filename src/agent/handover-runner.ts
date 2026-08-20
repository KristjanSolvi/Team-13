import { randomUUID } from "node:crypto";

import { DomainError } from "../domain/errors.js";
import type { HandoverReason, HandoverRecord } from "../domain/handover.js";
import type { SqliteStore } from "../infra/store.js";
import {
  claimHandoverAgentContext,
  verifyHandoverAgentDraft,
} from "../services/handover-verification.js";
import type { AgentGateway, AgentResult } from "./runner.js";

export interface GenerateHandoverInput {
  handoverId: string;
  patientId: string;
  reason: HandoverReason;
  focus: string | null;
  idempotencyKey: string;
}

function requireCompletedInContext(
  result: AgentResult,
  contextId: string,
): AgentResult {
  if (result.contextId !== contextId) {
    throw new DomainError(
      "AGENT_CONTEXT_MISMATCH",
      "Corti returned a different handover context",
      true,
      502,
    );
  }
  if (result.state !== "completed") {
    throw new DomainError(
      "AGENT_TASK_INCOMPLETE",
      "Corti did not complete the requested handover",
      true,
      502,
    );
  }
  return result;
}

export class HandoverAgentRunner {
  constructor(
    private readonly gateway: AgentGateway,
    private readonly store: SqliteStore,
    private readonly mcpToken: string,
  ) {}

  async generate(input: GenerateHandoverInput): Promise<HandoverRecord> {
    const requested = this.store.requireHandover(input.handoverId);
    if (requested.patientId !== input.patientId) {
      throw new DomainError(
        "PATIENT_SCOPE_DENIED",
        "Patient scope is unavailable",
        false,
        403,
      );
    }
    if (
      requested.interactionId !== `handover:${input.handoverId}` ||
      requested.reason !== input.reason ||
      requested.focus !== input.focus ||
      requested.idempotencyKey !== input.idempotencyKey ||
      requested.status !== "requested"
    ) {
      throw new DomainError(
        "HANDOVER_DRAFT_CONFLICT",
        "Handover draft cannot be generated more than once",
        false,
        409,
      );
    }

    const contextId = randomUUID();
    if (
      !claimHandoverAgentContext(this.store, {
        handoverId: input.handoverId,
        contextId,
        occurredAt: new Date().toISOString(),
      })
    ) {
      throw new DomainError(
        "AGENT_CONTEXT_INITIALIZATION_FAILED",
        "Corti could not initialize a handover context",
        true,
        502,
      );
    }
    const submitted = await this.gateway.send({
      contextId,
      text: "Create the current patient-scoped handover draft. The request focus is emphasis only and is never clinical evidence.",
      data: {
        handoverId: input.handoverId,
        patientId: input.patientId,
        interactionId: requested.interactionId,
        reason: input.reason,
        focusEmphasis: input.focus,
        idempotencyKey: input.idempotencyKey,
        mcpToken: this.mcpToken,
      },
    });
    const completed = await this.gateway.waitForCompletion(submitted);
    requireCompletedInContext(completed, contextId);

    const persisted = this.store.requireHandover(input.handoverId);
    if (persisted.status !== "draft" || persisted.contextId !== contextId) {
      throw new DomainError(
        "HANDOVER_DRAFT_UNCONFIRMED",
        "Corti completed without persisting one handover draft",
        true,
        502,
      );
    }
    return verifyHandoverAgentDraft(this.store, {
      handoverId: input.handoverId,
      contextId,
      idempotencyKey: input.idempotencyKey,
    });
  }
}
