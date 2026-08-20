import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { DomainError } from "../domain/errors.js";
import { calculatePriority } from "../domain/priority.js";
import { requireTransition } from "../domain/state-machine.js";
import type {
  Actor,
  ClinicalUrgency,
  PriorityBreakdown,
  Task,
  TaskOrigin,
  Thread,
} from "../domain/types.js";
import type { Clock } from "../infra/clock.js";
import type { SqliteStore } from "../infra/store.js";

const EVIDENCE_REFERENCE =
  /^(encounter|record|dictation):[A-Za-z0-9._-]+$/;
const ACCEPTANCE_WINDOW_MS: Record<ClinicalUrgency, number> = {
  high: 5 * 60_000,
  medium: 30 * 60_000,
  routine: 4 * 60 * 60_000,
};
const APPROVAL_LIFETIME_MS = 10 * 60_000;

export type ApprovalChannel = "app_one_tap" | "dictation_confirmation";

export interface CreateDraftInput {
  patientId: string;
  interactionId: string;
  contextId: string | null;
  threadId?: string;
  origin: TaskOrigin;
  summary: string;
  taskType: string;
  evidenceRefs: string[];
  targetTeamId: string;
  requiredCapabilities: string[];
  clinicalUrgency: ClinicalUrgency;
  dueInMs: number;
  idempotencyKey: string;
  actor: Actor;
}

export interface CorrectDraftPatch {
  summary?: string;
  targetTeamId?: string;
  requiredCapabilities?: string[];
  clinicalUrgency?: ClinicalUrgency;
  dueInMs?: number;
}

export interface ApprovalProof {
  approvalId: string;
  proof: string;
  expiresAt: string;
}

function draftHash(task: Task): string {
  const canonical = JSON.stringify({
    taskId: task.taskId,
    patientId: task.patientId,
    version: task.version,
    summary: task.summary,
    taskType: task.taskType,
    evidenceRefs: task.evidenceRefs,
    targetTeamId: task.targetTeamId,
    requiredCapabilities: task.requiredCapabilities,
    clinicalUrgency: task.clinicalUrgency,
    acceptBy: task.acceptBy,
    dueBy: task.dueBy,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function requireDuration(milliseconds: number): void {
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    throw new DomainError(
      "INVALID_DEADLINE",
      "dueInMs must be a positive safe integer",
    );
  }
}

function futureIso(now: Date, milliseconds: number): string {
  requireDuration(milliseconds);
  const result = new Date(now.getTime() + milliseconds);
  if (!Number.isFinite(result.getTime())) {
    throw new DomainError(
      "INVALID_DEADLINE",
      "dueInMs produces an invalid deadline",
    );
  }
  return result.toISOString();
}

function initialBreakdown(activeTargetAt: string): PriorityBreakdown {
  return {
    base: 0,
    deadlinePressure: 0,
    overdue: 0,
    failedOffers: 0,
    total: 0,
    activeTargetAt,
  };
}

function approvalMaterial(input: {
  approvalId: string;
  draftHash: string;
  patientId: string;
  clinicianId: string;
  approvedAt: string;
  approvalChannel: string;
  expiresAt: string;
}): string {
  return [
    input.approvalId,
    input.draftHash,
    input.patientId,
    input.clinicianId,
    input.approvedAt,
    input.approvalChannel,
    input.expiresAt,
  ].join(".");
}

export class LedgerService {
  constructor(
    private readonly store: SqliteStore,
    private readonly clock: Clock,
    private readonly approvalSecret: string,
  ) {}

  createDraft(input: CreateDraftInput): Task {
    const createdAt = this.clock.now().toISOString();
    return this.store.runTaskCommand(
      "create-draft",
      input.idempotencyKey,
      createdAt,
      () => this.createDraftOnce(input, createdAt),
    );
  }

  private createDraftOnce(input: CreateDraftInput, createdAt: string): Task {
    if (!this.store.getPatient(input.patientId)) {
      throw new DomainError(
        "PATIENT_NOT_FOUND",
        "Patient not found",
        false,
        404,
      );
    }
    if (
      !input.evidenceRefs.every((reference) =>
        EVIDENCE_REFERENCE.test(reference),
      )
    ) {
      throw new DomainError(
        "INVALID_EVIDENCE",
        "Evidence references must use an approved source namespace",
      );
    }
    if (
      input.origin === "agent_suggested" &&
      !this.store.hasRecordEvidence(input.patientId, input.evidenceRefs)
    ) {
      throw new DomainError(
        "EVIDENCE_NOT_FOUND",
        "Agent evidence is not present in the scoped record",
        false,
        409,
      );
    }
    if (!this.store.teamCan(input.targetTeamId, input.requiredCapabilities)) {
      throw new DomainError(
        "TEAM_NOT_ELIGIBLE",
        "Team lacks required capability",
      );
    }
    const duplicate = this.store.findOpenDuplicate(
      input.patientId,
      input.taskType,
      input.targetTeamId,
    );
    if (duplicate) {
      throw new DomainError(
        "LIKELY_DUPLICATE",
        `Open task ${duplicate.taskId} already covers this work`,
        false,
        409,
      );
    }

    const existingThread = input.threadId
      ? this.store.requireThread(input.threadId)
      : null;
    this.requireThreadScope(existingThread, input);

    const now = new Date(createdAt);
    const acceptanceWindowMs = ACCEPTANCE_WINDOW_MS[input.clinicalUrgency];
    requireDuration(input.dueInMs);
    if (input.dueInMs < acceptanceWindowMs) {
      throw new DomainError(
        "INVALID_DEADLINE",
        "dueInMs cannot be earlier than the team acceptance window",
      );
    }
    const acceptBy = futureIso(now, acceptanceWindowMs);
    const dueBy = futureIso(now, input.dueInMs);
    const taskId = randomUUID();
    const threadId = existingThread?.threadId ?? randomUUID();
    const provisional: Task = {
      taskId,
      threadId,
      patientId: input.patientId,
      origin: input.origin,
      summary: input.summary,
      taskType: input.taskType,
      evidenceRefs: [...input.evidenceRefs],
      targetTeamId: input.targetTeamId,
      requiredCapabilities: [...input.requiredCapabilities],
      clinicalUrgency: input.clinicalUrgency,
      operationalPriorityScore: 0,
      priorityBreakdown: initialBreakdown(acceptBy),
      acceptBy,
      dueBy,
      state: "draft",
      assignedMemberId: null,
      failedOffers: 0,
      version: 1,
      createdAt,
      updatedAt: createdAt,
    };
    const priorityBreakdown = calculatePriority(provisional, now);
    const task: Task = {
      ...provisional,
      operationalPriorityScore: priorityBreakdown.total,
      priorityBreakdown,
    };

    if (!existingThread) {
      this.store.putThread({
        threadId,
        patientId: input.patientId,
        interactionId: input.interactionId,
        contextId: input.contextId,
        summary: input.summary,
        evidenceRefs: [...input.evidenceRefs],
        state: "awaiting_review",
        version: 1,
        createdAt,
        updatedAt: createdAt,
      });
    } else if (existingThread.state !== "awaiting_review") {
      this.store.setThreadState(
        existingThread.threadId,
        existingThread.version,
        "awaiting_review",
        createdAt,
      );
    }
    this.store.putTask(task);
    this.store.appendTaskEvent(
      task,
      input.interactionId,
      input.contextId,
      input.actor,
      "task.draft_created",
      {},
    );
    this.store.appendTaskEvent(
      task,
      input.interactionId,
      input.contextId,
      input.actor,
      "task.approval_requested",
      { draftHash: draftHash(task) },
    );
    if (!existingThread) {
      this.store.appendEvent({
        eventType: "thread.state_changed",
        occurredAt: createdAt,
        correlationId: threadId,
        patientId: input.patientId,
        interactionId: input.interactionId,
        contextId: input.contextId,
        actor: { type: "system", id: "ledger" },
        payload: { threadId, state: "awaiting_review", version: 1 },
      });
    }
    return task;
  }

  private requireThreadScope(
    thread: Thread | null,
    input: CreateDraftInput,
  ): void {
    if (!thread) return;
    if (
      thread.patientId !== input.patientId ||
      thread.interactionId !== input.interactionId ||
      thread.contextId !== input.contextId
    ) {
      throw new DomainError(
        "THREAD_SCOPE_MISMATCH",
        "Existing thread does not match patient context",
        false,
        403,
      );
    }
    if (thread.state === "escalated") {
      throw new DomainError(
        "THREAD_ESCALATED",
        "Resolve the escalated thread before adding another task",
        false,
        409,
      );
    }
  }

  createKarenDraft(contextId: string, idempotencyKey: string): Task {
    return this.createDraft({
      patientId: "synthetic-karen",
      interactionId: "interaction-karen-1",
      contextId,
      origin: "agent_suggested",
      summary: "Check blood pressure within 48 hours",
      taskType: "blood-pressure-check",
      evidenceRefs: ["encounter:sentence-42"],
      targetTeamId: "district-nursing",
      requiredCapabilities: ["blood-pressure"],
      clinicalUrgency: "medium",
      dueInMs: 48 * 60 * 60_000,
      idempotencyKey,
      actor: { type: "agent", id: "corti" },
    });
  }

  correctDraft(
    taskId: string,
    expectedVersion: number,
    patch: CorrectDraftPatch,
    actor: Actor,
  ): Task {
    return this.store.updateTask(
      taskId,
      expectedVersion,
      (current) => {
        if (current.state !== "draft") {
          throw new DomainError(
            "NOT_A_DRAFT",
            "Only drafts can be corrected",
            false,
            409,
          );
        }
        const requiredCapabilities =
          patch.requiredCapabilities ?? current.requiredCapabilities;
        const targetTeamId = patch.targetTeamId ?? current.targetTeamId;
        if (!this.store.teamCan(targetTeamId, requiredCapabilities)) {
          throw new DomainError(
            "TEAM_NOT_ELIGIBLE",
            "Team lacks required capability",
          );
        }
        const now = this.clock.now();
        const clinicalUrgency =
          patch.clinicalUrgency ?? current.clinicalUrgency;
        const acceptBy =
          patch.clinicalUrgency === undefined
            ? current.acceptBy
            : futureIso(now, ACCEPTANCE_WINDOW_MS[clinicalUrgency]);
        const dueBy =
          patch.dueInMs === undefined
            ? current.dueBy
            : futureIso(now, patch.dueInMs);
        if (Date.parse(dueBy) < Date.parse(acceptBy)) {
          throw new DomainError(
            "INVALID_DEADLINE",
            "dueBy cannot be earlier than acceptBy",
          );
        }
        const candidate: Task = {
          ...current,
          summary: patch.summary ?? current.summary,
          targetTeamId,
          requiredCapabilities: [...requiredCapabilities],
          clinicalUrgency,
          acceptBy,
          dueBy,
          version: current.version + 1,
          updatedAt: now.toISOString(),
        };
        const priorityBreakdown = calculatePriority(candidate, now);
        return {
          ...candidate,
          priorityBreakdown,
          operationalPriorityScore: priorityBreakdown.total,
        };
      },
      actor,
      "task.draft_corrected",
      { correctedFields: Object.keys(patch).toSorted() },
    );
  }

  approveDraft(
    taskId: string,
    expectedVersion: number,
    clinicianId: string,
    approvalChannel: ApprovalChannel = "app_one_tap",
    idempotencyKey = `approval:${taskId}:${expectedVersion}:${clinicianId}`,
  ): ApprovalProof {
    if (
      approvalChannel !== "app_one_tap" &&
      approvalChannel !== "dictation_confirmation"
    ) {
      throw new DomainError(
        "APPROVAL_MISMATCH",
        "Approval channel is not supported",
        false,
        409,
      );
    }
    const commandScope = `approve:${taskId}:${clinicianId}`;
    return this.store.transaction(() => {
      const replay = this.store.getProcessedCommand(
        commandScope,
        idempotencyKey,
      );
      if (replay) {
        return {
          approvalId: String(replay.approvalId),
          proof: String(replay.proof),
          expiresAt: String(replay.expiresAt),
        };
      }
      const task = this.store.requireTask(taskId);
      if (task.state !== "draft" || task.version !== expectedVersion) {
        throw new DomainError(
          "VERSION_CONFLICT",
          "Draft changed before approval",
          false,
          409,
        );
      }
      const approvalId = randomUUID();
      const hash = draftHash(task);
      const approvedAt = this.clock.now().toISOString();
      const expiresAt = futureIso(new Date(approvedAt), APPROVAL_LIFETIME_MS);
      const signature = createHmac("sha256", this.approvalSecret)
        .update(
          approvalMaterial({
            approvalId,
            draftHash: hash,
            patientId: task.patientId,
            clinicianId,
            approvedAt,
            approvalChannel,
            expiresAt,
          }),
        )
        .digest("hex");
      const proof = `${approvalId}.${signature}`;
      this.store.saveApproval({
        approvalId,
        taskId,
        patientId: task.patientId,
        clinicianId,
        draftVersion: expectedVersion,
        draftHash: hash,
        approvedAt,
        approvalChannel,
        expiresAt,
        consumedAt: null,
      });
      const thread = this.store.requireThread(task.threadId);
      this.store.appendTaskEvent(
        task,
        thread.interactionId,
        thread.contextId,
        { type: "clinician", id: clinicianId },
        "task.approved",
        { approvalId, approvedAt, approvalChannel, expiresAt },
      );
      this.store.saveProcessedCommand(
        commandScope,
        idempotencyKey,
        { approvalId, proof, expiresAt },
        approvedAt,
      );
      return { approvalId, proof, expiresAt };
    });
  }

  publishDraft(
    taskId: string,
    proof: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Task {
    const commandScope = `publish:${taskId}`;
    return this.store.transaction(() => {
      const replay = this.store.getProcessedCommand(
        commandScope,
        idempotencyKey,
      );
      if (replay) {
        return this.store.requireTask(String(replay.taskId));
      }
      const task = this.store.requireTask(taskId);
      if (task.version !== expectedVersion) {
        throw new DomainError(
          "VERSION_CONFLICT",
          "Draft version changed",
          false,
          409,
        );
      }
      requireTransition(task.state, "offered_to_team");

      const proofParts = proof.split(".");
      const approvalId = proofParts[0];
      const signature = proofParts[1];
      const approval =
        proofParts.length === 2 && approvalId
          ? this.store.getApproval(approvalId)
          : null;
      const now = this.clock.now();
      if (
        !approval ||
        !signature ||
        approval.taskId !== taskId ||
        approval.patientId !== task.patientId ||
        approval.consumedAt !== null ||
        approval.draftVersion !== task.version ||
        approval.draftHash !== draftHash(task) ||
        Date.parse(approval.expiresAt) <= now.getTime()
      ) {
        throw new DomainError(
          "APPROVAL_MISMATCH",
          "Approval does not match the current draft",
          false,
          409,
        );
      }
      const expectedSignature = createHmac("sha256", this.approvalSecret)
        .update(approvalMaterial(approval))
        .digest("hex");
      if (!safeEqual(signature, expectedSignature)) {
        throw new DomainError(
          "APPROVAL_MISMATCH",
          "Approval proof is invalid",
          false,
          409,
        );
      }

      const updated: Task = {
        ...task,
        state: "offered_to_team",
        version: task.version + 1,
        updatedAt: now.toISOString(),
      };
      this.store.replaceTask(task, updated);
      this.store.consumeApproval(approval.approvalId, updated.updatedAt);
      this.store.saveProcessedCommand(
        commandScope,
        idempotencyKey,
        { taskId },
        updated.updatedAt,
      );
      const thread = this.store.requireThread(task.threadId);
      this.store.setThreadState(
        thread.threadId,
        thread.version,
        "tracking",
        updated.updatedAt,
      );
      this.store.appendTaskEvent(
        updated,
        thread.interactionId,
        thread.contextId,
        { type: "agent", id: "corti" },
        "task.published_to_team",
        { approvalId: approval.approvalId },
      );
      return updated;
    });
  }

  acceptTask(
    taskId: string,
    expectedVersion: number,
    memberId: string,
    idempotencyKey: string,
  ): Task {
    const commandScope = `accept:${taskId}:${memberId}`;
    return this.store.transaction(() => {
      const replay = this.store.getProcessedCommand(
        commandScope,
        idempotencyKey,
      );
      if (replay) {
        return this.store.requireTask(String(replay.taskId));
      }
      return this.store.updateTask(
        taskId,
        expectedVersion,
        (task) => {
          requireTransition(task.state, "accepted");
          const member = this.store.requireEligibleMember(memberId, task);
          return {
            ...task,
            state: "accepted",
            assignedMemberId: member.memberId,
            version: task.version + 1,
            updatedAt: this.clock.now().toISOString(),
          };
        },
        { type: "team_member", id: memberId },
        "task.member_accepted",
        { memberId, idempotencyKey },
      );
    });
  }

  completeTask(
    taskId: string,
    expectedVersion: number,
    memberId: string,
    outcomeRef: string,
  ): Task {
    return this.store.updateTask(
      taskId,
      expectedVersion,
      (task) => {
        requireTransition(task.state, "completed");
        if (task.assignedMemberId !== memberId) {
          throw new DomainError(
            "NOT_TASK_OWNER",
            "Only the owner can complete this task",
            false,
            403,
          );
        }
        return {
          ...task,
          state: "completed",
          version: task.version + 1,
          updatedAt: this.clock.now().toISOString(),
        };
      },
      { type: "team_member", id: memberId },
      "task.completed",
      { outcomeRef },
    );
  }

  verifyTask(
    taskId: string,
    expectedVersion: number,
    outcomeRef: string,
    verifierId = "downstream:readback",
  ): Task {
    return this.store.transaction(() => {
      const updated = this.store.updateTask(
        taskId,
        expectedVersion,
        (task) => {
          requireTransition(task.state, "verified");
          return {
            ...task,
            state: "verified",
            version: task.version + 1,
            updatedAt: this.clock.now().toISOString(),
          };
        },
        { type: "system", id: verifierId },
        "task.completion_verified",
        { outcomeRef },
      );
      const thread = this.store.requireThread(updated.threadId);
      this.store.setThreadState(
        thread.threadId,
        thread.version,
        "verified",
        updated.updatedAt,
      );
      return updated;
    });
  }

  dismissDraft(
    taskId: string,
    expectedVersion: number,
    clinicianId: string,
    reason: string,
  ): Task {
    return this.store.transaction(() => {
      const updated = this.store.updateTask(
        taskId,
        expectedVersion,
        (task) => {
          requireTransition(task.state, "dismissed");
          return {
            ...task,
            state: "dismissed",
            version: task.version + 1,
            updatedAt: this.clock.now().toISOString(),
          };
        },
        { type: "clinician", id: clinicianId },
        "task.draft_dismissed",
        { reason },
      );
      const thread = this.store.requireThread(updated.threadId);
      this.store.setThreadState(
        thread.threadId,
        thread.version,
        "dismissed",
        updated.updatedAt,
      );
      return updated;
    });
  }

  reopenToTeam(
    taskId: string,
    expectedVersion: number,
    clinicianId: string,
    dueInMs: number,
  ): Task {
    return this.store.transaction(() => {
      const now = this.clock.now();
      const updated = this.store.updateTask(
        taskId,
        expectedVersion,
        (task) => {
          requireTransition(task.state, "offered_to_team");
          const acceptanceWindowMs =
            ACCEPTANCE_WINDOW_MS[task.clinicalUrgency];
          requireDuration(dueInMs);
          if (dueInMs < acceptanceWindowMs) {
            throw new DomainError(
              "INVALID_DEADLINE",
              "dueInMs cannot be earlier than the team acceptance window",
            );
          }
          const candidate: Task = {
            ...task,
            state: "offered_to_team",
            assignedMemberId: null,
            acceptBy: futureIso(now, acceptanceWindowMs),
            dueBy: futureIso(now, dueInMs),
            version: task.version + 1,
            updatedAt: now.toISOString(),
          };
          const priorityBreakdown = calculatePriority(candidate, now);
          return {
            ...candidate,
            priorityBreakdown,
            operationalPriorityScore: priorityBreakdown.total,
          };
        },
        { type: "clinician", id: clinicianId },
        "task.reopened_to_team",
        { dueInMs },
      );
      const thread = this.store.requireThread(updated.threadId);
      this.store.setThreadState(
        thread.threadId,
        thread.version,
        "tracking",
        updated.updatedAt,
      );
      return updated;
    });
  }

  getTask(taskId: string): Task {
    return this.store.requireTask(taskId);
  }
}
