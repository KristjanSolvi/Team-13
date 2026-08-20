import { randomUUID } from "node:crypto";

import { DomainError } from "../domain/errors.js";
import type { SqliteStore } from "../infra/store.js";

export interface AgentSendInput {
  text: string;
  contextId?: string;
  data?: Record<string, unknown>;
}

export interface AgentResult {
  contextId: string;
  taskId: string | null;
  state: string;
  credits?: number;
}

export interface AgentGateway {
  send(input: AgentSendInput): Promise<AgentResult>;
  waitForCompletion(result: AgentResult): Promise<AgentResult>;
}

export interface InvestigateSignalInput {
  patientId: string;
  interactionId: string;
  signalText: string;
  evidenceRefs: string[];
  idempotencyKey: string;
}

export interface PublishApprovedInput {
  patientId: string;
  interactionId: string;
  taskId: string;
  expectedVersion: number;
  approvalProof: string;
  idempotencyKey: string;
}

type PublicationPreflight =
  | { kind: "publish" }
  | { kind: "recover"; contextId: string };

export class AgentRunner {
  constructor(
    private readonly gateway: AgentGateway,
    private readonly store: SqliteStore,
    private readonly mcpToken: string,
  ) {}

  private requireCompletedInContext(
    result: AgentResult,
    contextId: string,
  ): AgentResult {
    if (result.contextId !== contextId) {
      throw new DomainError(
        "AGENT_CONTEXT_MISMATCH",
        "Corti returned a different interaction context",
        true,
        502,
      );
    }
    if (result.state !== "completed") {
      throw new DomainError(
        "AGENT_TASK_INCOMPLETE",
        "Corti did not complete the requested work",
        true,
        502,
      );
    }
    return result;
  }

  private async ensureContext(
    patientId: string,
    interactionId: string,
  ): Promise<string> {
    return this.store.transaction(() => {
      const existing = this.store.contextForInteraction(interactionId);
      if (existing) {
        if (this.store.patientForContext(existing) !== patientId) {
          throw new DomainError(
            "PATIENT_SCOPE_DENIED",
            "Patient scope is unavailable",
            false,
            403,
          );
        }
        return existing;
      }

      const contextId = randomUUID();
      if (this.store.patientForContext(contextId) !== null) {
        throw new DomainError(
          "AGENT_CONTEXT_INITIALIZATION_FAILED",
          "Corti context identifier collided with an existing context",
          true,
          502,
        );
      }
      this.store.putContextMapping(
        contextId,
        interactionId,
        patientId,
        new Date().toISOString(),
      );
      return contextId;
    });
  }

  private verificationScope(input: PublishApprovedInput): string {
    return `publish-verified:${input.taskId}:${input.expectedVersion + 1}`;
  }

  private parseVerifiedPublication(
    value: Record<string, unknown>,
    contextId: string,
  ): AgentResult {
    const taskId = value.taskId;
    const credits = value.credits;
    if (
      value.contextId !== contextId ||
      value.state !== "completed" ||
      (taskId !== null && typeof taskId !== "string") ||
      (credits !== undefined && typeof credits !== "number")
    ) {
      throw new DomainError(
        "TASK_PUBLICATION_UNCONFIRMED",
        "Stored publication verification is invalid",
        true,
        502,
      );
    }
    return {
      contextId,
      taskId,
      state: "completed",
      ...(typeof credits === "number" ? { credits } : {}),
    };
  }

  private verifyPublication(
    input: PublishApprovedInput,
    contextId: string,
    candidate: AgentResult,
  ): AgentResult {
    return this.store.transaction(() => {
      const verificationScope = this.verificationScope(input);
      const replay = this.store.getProcessedCommand(
        verificationScope,
        input.idempotencyKey,
      );
      if (replay) return this.parseVerifiedPublication(replay, contextId);

      const committed = this.store.requireTask(input.taskId);
      const publication = this.store.getProcessedCommand(
        `publish:${input.taskId}`,
        input.idempotencyKey,
      );
      if (
        committed.state !== "offered_to_team" ||
        committed.version !== input.expectedVersion + 1 ||
        publication?.taskId !== input.taskId
      ) {
        throw new DomainError(
          "TASK_PUBLICATION_UNCONFIRMED",
          "Task publication was not committed",
          true,
          502,
        );
      }
      this.store.appendTaskEvent(
        committed,
        input.interactionId,
        contextId,
        { type: "agent", id: "corti" },
        "task.publish_verified",
        {},
      );
      this.store.saveProcessedCommand(
        verificationScope,
        input.idempotencyKey,
        candidate,
        committed.updatedAt,
      );
      return candidate;
    });
  }

  async investigate(input: InvestigateSignalInput): Promise<AgentResult> {
    if (
      input.evidenceRefs.length === 0 ||
      !this.store.hasRecordEvidence(input.patientId, input.evidenceRefs)
    ) {
      throw new DomainError(
        "EVIDENCE_NOT_FOUND",
        "Source evidence is unavailable",
        false,
        409,
      );
    }
    const contextId = await this.ensureContext(
      input.patientId,
      input.interactionId,
    );
    this.store.appendContextEvent(contextId, "agent.investigation_started", {
      evidenceRefs: input.evidenceRefs,
    });
    const submitted = await this.gateway.send({
      contextId,
      text: `Investigate this patient-scoped follow-through cue. Treat it as a cue, not evidence: ${input.signalText}`,
      data: {
        patientId: input.patientId,
        interactionId: input.interactionId,
        evidenceRefs: input.evidenceRefs,
        idempotencyKey: input.idempotencyKey,
        mcpToken: this.mcpToken,
      },
    });
    const completed = await this.gateway.waitForCompletion(submitted);
    return this.requireCompletedInContext(completed, contextId);
  }

  async publishApproved(input: PublishApprovedInput): Promise<AgentResult> {
    const preflight: PublicationPreflight = this.store.transaction(() => {
      const task = this.store.requireTask(input.taskId);
      const thread = this.store.requireThread(task.threadId);
      if (
        task.patientId !== input.patientId ||
        thread.interactionId !== input.interactionId
      ) {
        throw new DomainError(
          "PATIENT_SCOPE_DENIED",
          "Patient scope is unavailable",
          false,
          403,
        );
      }
      const contextId = this.store.contextForInteraction(input.interactionId);
      if (
        contextId !== null &&
        this.store.patientForContext(contextId) === input.patientId &&
        this.store.getProcessedCommand(
          this.verificationScope(input),
          input.idempotencyKey,
        ) !== null
      ) {
        return { kind: "recover", contextId };
      }
      if (task.state === "draft" && task.version === input.expectedVersion) {
        return { kind: "publish" };
      }
      const publication = this.store.getProcessedCommand(
        `publish:${input.taskId}`,
        input.idempotencyKey,
      );
      if (
        task.state === "offered_to_team" &&
        task.version === input.expectedVersion + 1 &&
        publication?.taskId === input.taskId &&
        contextId !== null &&
        this.store.patientForContext(contextId) === input.patientId
      ) {
        return { kind: "recover", contextId };
      }
      throw new DomainError(
        "VERSION_CONFLICT",
        "Draft changed before publication",
        false,
        409,
      );
    });
    if (preflight.kind === "recover") {
      return this.verifyPublication(input, preflight.contextId, {
        contextId: preflight.contextId,
        taskId: null,
        state: "completed",
      });
    }
    const contextId = await this.ensureContext(
      input.patientId,
      input.interactionId,
    );
    this.store.appendContextEvent(contextId, "agent.publication_started", {
      taskId: input.taskId,
      expectedVersion: input.expectedVersion,
    });
    const submitted = await this.gateway.send({
      contextId,
      text: "Publish the exact clinician-approved team task with publish_team_task, then verify it with get_task.",
      data: {
        patientId: input.patientId,
        interactionId: input.interactionId,
        taskId: input.taskId,
        expectedVersion: input.expectedVersion,
        approvalProof: input.approvalProof,
        idempotencyKey: input.idempotencyKey,
        mcpToken: this.mcpToken,
      },
    });
    const completed = await this.gateway.waitForCompletion(submitted);
    const result = this.requireCompletedInContext(completed, contextId);
    return this.verifyPublication(input, contextId, result);
  }
}
