import { randomUUID } from "node:crypto";

import { DomainError } from "../domain/errors.js";
import {
  buildHandoverSourceSnapshot,
  type HandoverPacket,
  type HandoverReason,
  type HandoverRecord,
  type HandoverSourceSnapshot,
  type HandoverTaskItem,
  handoverPacketSchema,
  handoverRequestHash,
  handoverSourceSnapshotHash,
  isHandoverTaskActive,
  type RenderedHandover,
  renderedHandoverSchema,
} from "../domain/handover.js";
import type { Task } from "../domain/types.js";
import type { Clock } from "../infra/clock.js";
import type { SqliteStore } from "../infra/store.js";

export interface BeginHandoverInput {
  patientId: string;
  requestedBy: string;
  reason: HandoverReason;
  focus: string | null;
  correlationId: string;
  idempotencyKey: string;
}

export interface SaveHandoverDraftInput {
  handoverId: string;
  patientId: string;
  contextId: string;
  packet: HandoverPacket;
}

type TaskSection = "outstandingTasks" | "awaitingVerification" | "escalations";

interface GroundingState {
  activeTasks: Task[];
  snapshot: HandoverSourceSnapshot;
  snapshotHash: string;
  clinicalSourceRefs: Set<string>;
  allowedSourceRefs: Set<string>;
}

type FinalizeOutcome =
  | { kind: "completed"; handover: HandoverRecord }
  | {
      kind: "source_changed";
      handoverId: string;
      correlationId: string;
      patientId: string;
      interactionId: string;
      contextId: string | null;
      expectedSnapshotHash: string;
      currentSnapshotHash: string;
      status: "draft";
      version: number;
    };

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function taskSectionEntries(
  packet: HandoverPacket,
): Array<{ item: HandoverTaskItem; section: TaskSection }> {
  return [
    ...packet.outstandingTasks.map((item) => ({
      item,
      section: "outstandingTasks" as const,
    })),
    ...packet.awaitingVerification.map((item) => ({
      item,
      section: "awaitingVerification" as const,
    })),
    ...packet.escalations.map((item) => ({
      item,
      section: "escalations" as const,
    })),
  ];
}

function expectedSection(task: Task): TaskSection {
  if (task.state === "completed") return "awaitingVerification";
  if (task.state === "escalated") return "escalations";
  return "outstandingTasks";
}

function safeActivityPayload(
  eventType: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const allowedByType: Record<string, string[]> = {
    "handover.requested": [
      "handoverId",
      "reason",
      "focusProvided",
      "status",
      "version",
    ],
    "handover.sources_retrieved": [
      "handoverId",
      "sourceSnapshotHash",
      "recordItemCount",
      "threadCount",
      "taskCount",
      "status",
      "version",
    ],
    "handover.draft_saved": [
      "handoverId",
      "sourceSnapshotHash",
      "status",
      "version",
    ],
    "handover.render_requested": ["handoverId", "status", "version"],
    "handover.source_changed": [
      "handoverId",
      "expectedSnapshotHash",
      "currentSnapshotHash",
      "status",
      "version",
    ],
    "handover.rendered": [
      "handoverId",
      "sourceSnapshotHash",
      "version",
      "creditsConsumed",
      "sectionCount",
    ],
    "handover.failed": ["handoverId", "code", "retryable", "status", "version"],
  };
  const safe: Record<string, unknown> = {};
  for (const key of allowedByType[eventType] ?? []) {
    if (key in payload) safe[key] = payload[key];
  }
  return safe;
}

export class HandoverService {
  constructor(
    private readonly store: SqliteStore,
    private readonly clock: Clock,
  ) {}

  beginRequest(input: BeginHandoverInput): {
    handover: HandoverRecord;
    replayed: boolean;
  } {
    if (!this.store.getPatient(input.patientId)) {
      throw new DomainError(
        "PATIENT_NOT_FOUND",
        "Patient not found",
        false,
        404,
      );
    }

    const requestHash = handoverRequestHash(input);
    const existing = this.store.getHandoverByRequest(
      input.requestedBy,
      input.idempotencyKey,
    );
    if (existing) {
      return this.resolveBeginReplay(existing, requestHash);
    }

    const handoverId = randomUUID();
    const now = this.clock.now().toISOString();
    const handover: HandoverRecord = {
      handoverId,
      patientId: input.patientId,
      interactionId: `handover:${handoverId}`,
      contextId: null,
      requestedBy: input.requestedBy,
      reason: input.reason,
      focus: input.focus,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      status: "requested",
      version: 1,
      packet: null,
      rendered: null,
      sourceSnapshot: null,
      sourceSnapshotHash: null,
      createdAt: now,
      updatedAt: now,
      generatedAt: null,
    };

    try {
      this.store.transaction(() => {
        this.store.putHandover(handover);
        this.store.appendEvent({
          eventType: "handover.requested",
          occurredAt: now,
          correlationId: input.correlationId,
          patientId: input.patientId,
          interactionId: handover.interactionId,
          contextId: null,
          actor: { type: "clinician", id: input.requestedBy },
          payload: {
            handoverId,
            reason: input.reason,
            focusProvided: input.focus !== null,
            status: handover.status,
            version: handover.version,
          },
        });
      });
    } catch (error) {
      const winner = this.store.getHandoverByRequest(
        input.requestedBy,
        input.idempotencyKey,
      );
      if (winner) {
        return this.resolveBeginReplay(winner, requestHash);
      }
      throw error;
    }

    return { handover, replayed: false };
  }

  private resolveBeginReplay(
    handover: HandoverRecord,
    requestHash: string,
  ): { handover: HandoverRecord; replayed: boolean } {
    if (handover.requestHash !== requestHash) {
      throw new DomainError(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used for a different handover request",
        false,
        409,
      );
    }
    if (handover.status === "requested") {
      throw new DomainError(
        "HANDOVER_IN_PROGRESS",
        "Handover generation is already in progress",
        true,
        409,
      );
    }
    if (handover.status === "failed") {
      throw new DomainError(
        "HANDOVER_RETRY_REQUIRES_NEW_KEY",
        "A failed handover requires a new idempotency key",
        false,
        409,
      );
    }
    return { handover, replayed: true };
  }

  saveDraft(input: SaveHandoverDraftInput): HandoverRecord {
    const packet = handoverPacketSchema.parse(input.packet);
    return this.store.transaction(() => {
      const handover = this.store.requireHandover(input.handoverId);
      if (handover.patientId !== input.patientId) {
        throw new DomainError(
          "PATIENT_SCOPE_DENIED",
          "Patient scope is unavailable",
          false,
          403,
        );
      }
      if (
        handover.status === "draft" &&
        handover.contextId !== input.contextId
      ) {
        throw this.draftConflict();
      }
      this.requireContextScope(handover, input.contextId);
      const grounding = this.currentGrounding(input.patientId);

      if (handover.status === "draft") {
        if (
          handover.packet !== null &&
          handover.sourceSnapshot !== null &&
          handover.sourceSnapshotHash === grounding.snapshotHash &&
          sameJson(handover.packet, packet) &&
          sameJson(handover.sourceSnapshot, grounding.snapshot)
        ) {
          return handover;
        }
        throw this.draftConflict();
      }
      if (handover.status !== "requested") {
        throw this.draftConflict();
      }

      this.validatePacket(packet, grounding);
      const updatedAt = this.clock.now().toISOString();
      const draft: HandoverRecord = {
        ...handover,
        contextId: input.contextId,
        status: "draft",
        version: handover.version + 1,
        packet,
        rendered: null,
        sourceSnapshot: grounding.snapshot,
        sourceSnapshotHash: grounding.snapshotHash,
        updatedAt,
        generatedAt: null,
      };
      const saved = this.store.updateHandover(draft, handover.version);
      const eventBase = {
        occurredAt: updatedAt,
        correlationId: handover.correlationId,
        patientId: handover.patientId,
        interactionId: handover.interactionId,
        contextId: input.contextId,
        actor: { type: "agent", id: "corti" } as const,
      };
      this.store.appendEvent({
        ...eventBase,
        eventType: "handover.sources_retrieved",
        payload: {
          handoverId: saved.handoverId,
          sourceSnapshotHash: grounding.snapshotHash,
          recordItemCount: grounding.snapshot.recordItems.length,
          threadCount: grounding.snapshot.threads.length,
          taskCount: grounding.snapshot.tasks.length,
          status: saved.status,
          version: saved.version,
        },
      });
      this.store.appendEvent({
        ...eventBase,
        eventType: "handover.draft_saved",
        payload: {
          handoverId: saved.handoverId,
          sourceSnapshotHash: grounding.snapshotHash,
          status: saved.status,
          version: saved.version,
        },
      });
      return saved;
    });
  }

  finalize(
    handoverId: string,
    expectedVersion: number,
    expectedSnapshotHash: string,
    rendered: RenderedHandover,
  ): HandoverRecord {
    const parsedRendered = renderedHandoverSchema.parse(rendered);
    const outcome: FinalizeOutcome = this.store.transaction(() => {
      const handover = this.store.requireHandover(handoverId);
      if (handover.status === "rendered") {
        if (
          expectedVersion === handover.version - 1 &&
          expectedSnapshotHash === handover.sourceSnapshotHash &&
          handover.rendered !== null &&
          sameJson(handover.rendered, parsedRendered)
        ) {
          return { kind: "completed", handover };
        }
        throw this.finalizeConflict();
      }
      if (
        handover.status !== "draft" ||
        handover.packet === null ||
        handover.sourceSnapshot === null ||
        handover.sourceSnapshotHash === null ||
        expectedVersion !== handover.version ||
        expectedSnapshotHash !== handover.sourceSnapshotHash
      ) {
        throw this.finalizeConflict();
      }

      const grounding = this.currentGrounding(handover.patientId);
      if (grounding.snapshotHash !== handover.sourceSnapshotHash) {
        return {
          kind: "source_changed",
          handoverId,
          correlationId: handover.correlationId,
          patientId: handover.patientId,
          interactionId: handover.interactionId,
          contextId: handover.contextId,
          expectedSnapshotHash: handover.sourceSnapshotHash,
          currentSnapshotHash: grounding.snapshotHash,
          status: handover.status,
          version: handover.version,
        };
      }

      this.validateRenderedUnknowns(handover.packet, parsedRendered);
      const packetSourceRefs = this.packetSourceRefs(handover.packet);
      for (const section of parsedRendered.sections) {
        for (const statement of section.statements) {
          if (
            statement.sourceRefs.some(
              (sourceRef) => !packetSourceRefs.has(sourceRef),
            )
          ) {
            throw new DomainError(
              "HANDOVER_EVIDENCE_NOT_FOUND",
              "Rendered handover introduced evidence outside the saved packet",
              false,
              409,
            );
          }
        }
      }

      const generatedAt = this.clock.now().toISOString();
      const finalized: HandoverRecord = {
        ...handover,
        status: "rendered",
        version: handover.version + 1,
        rendered: parsedRendered,
        updatedAt: generatedAt,
        generatedAt,
      };
      const saved = this.store.updateHandover(finalized, handover.version);
      this.store.appendEvent({
        eventType: "handover.rendered",
        occurredAt: generatedAt,
        correlationId: handover.correlationId,
        patientId: handover.patientId,
        interactionId: handover.interactionId,
        contextId: handover.contextId,
        actor: { type: "system", id: "pipeline:text-generation" },
        payload: {
          handoverId,
          sourceSnapshotHash: handover.sourceSnapshotHash,
          version: saved.version,
          creditsConsumed: parsedRendered.creditsConsumed,
          sectionCount: parsedRendered.sections.length,
        },
      });
      return { kind: "completed", handover: saved };
    });
    if (outcome.kind === "completed") return outcome.handover;

    const occurredAt = this.clock.now().toISOString();
    this.store.transaction(() => {
      this.store.appendEvent({
        eventType: "handover.source_changed",
        occurredAt,
        correlationId: outcome.correlationId,
        patientId: outcome.patientId,
        interactionId: outcome.interactionId,
        contextId: outcome.contextId,
        actor: { type: "agent", id: "corti" },
        payload: {
          handoverId: outcome.handoverId,
          expectedSnapshotHash: outcome.expectedSnapshotHash,
          currentSnapshotHash: outcome.currentSnapshotHash,
          status: outcome.status,
          version: outcome.version,
        },
      });
    });
    throw new DomainError(
      "HANDOVER_SOURCE_CHANGED",
      "Handover sources changed after the draft was saved",
      true,
      409,
    );
  }

  markRenderRequested(handoverId: string): HandoverRecord {
    const handover = this.store.requireHandover(handoverId);
    if (handover.status === "rendered") return handover;
    if (handover.status !== "draft") {
      throw new DomainError(
        "HANDOVER_RENDER_REQUEST_CONFLICT",
        "Only a draft handover can request rendering",
        false,
        409,
      );
    }
    this.store.appendEvent({
      eventType: "handover.render_requested",
      occurredAt: this.clock.now().toISOString(),
      correlationId: handover.correlationId,
      patientId: handover.patientId,
      interactionId: handover.interactionId,
      contextId: handover.contextId,
      actor: { type: "agent", id: "corti" },
      payload: {
        handoverId,
        status: handover.status,
        version: handover.version,
      },
    });
    return handover;
  }

  markFailed(handoverId: string, code: string, retryable: boolean): void {
    const handover = this.store.requireHandover(handoverId);
    if (handover.status === "failed") return;
    if (handover.status !== "requested") {
      throw new DomainError(
        "HANDOVER_FAILURE_CONFLICT",
        "A saved handover result cannot be marked failed",
        false,
        409,
      );
    }
    const updatedAt = this.clock.now().toISOString();
    const failed: HandoverRecord = {
      ...handover,
      status: "failed",
      version: handover.version + 1,
      updatedAt,
    };
    this.store.transaction(() => {
      const saved = this.store.updateHandover(failed, handover.version);
      this.store.appendEvent({
        eventType: "handover.failed",
        occurredAt: updatedAt,
        correlationId: handover.correlationId,
        patientId: handover.patientId,
        interactionId: handover.interactionId,
        contextId: handover.contextId,
        actor: { type: "agent", id: "corti" },
        payload: {
          handoverId,
          code,
          retryable,
          status: saved.status,
          version: saved.version,
        },
      });
    });
  }

  response(handover: HandoverRecord): Record<string, unknown> {
    if (
      (handover.status !== "draft" && handover.status !== "rendered") ||
      handover.packet === null ||
      handover.sourceSnapshot === null ||
      handover.sourceSnapshotHash === null
    ) {
      throw new DomainError(
        "HANDOVER_RESPONSE_UNAVAILABLE",
        "Handover response is not available",
        false,
        409,
      );
    }
    const activity = this.store
      .listEvents(0)
      .filter(
        (event) =>
          event.eventType.startsWith("handover.") &&
          event.payload.handoverId === handover.handoverId,
      )
      .map((event) => ({
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        actor: event.actor,
        payload: safeActivityPayload(event.eventType, event.payload),
      }));
    return {
      handoverId: handover.handoverId,
      patientId: handover.patientId,
      status: "draft",
      renderingStatus: handover.status === "rendered" ? "rendered" : "pending",
      reason: handover.reason,
      requestedBy: handover.requestedBy,
      generatedAt: handover.generatedAt,
      version: handover.version,
      sourceSnapshotHash: handover.sourceSnapshotHash,
      packet: handover.packet,
      rendered: handover.rendered,
      activity,
    };
  }

  private requireContextScope(
    handover: HandoverRecord,
    contextId: string,
  ): void {
    if (this.store.patientForContext(contextId) !== handover.patientId) {
      throw new DomainError(
        "PATIENT_SCOPE_DENIED",
        "Patient scope is unavailable",
        false,
        403,
      );
    }
    if (
      this.store.contextForInteraction(handover.interactionId) !== contextId
    ) {
      throw new DomainError(
        "CONTEXT_INTERACTION_MISMATCH",
        "Interaction scope is unavailable",
        false,
        403,
      );
    }
  }

  private currentGrounding(patientId: string): GroundingState {
    const recordItems = this.store.listRecordItems(patientId);
    const threads = this.store.listOpenThreads(patientId);
    const activeTasks = this.store
      .listPatientTasks(patientId)
      .filter(isHandoverTaskActive);
    const snapshot = buildHandoverSourceSnapshot(
      recordItems,
      threads,
      activeTasks,
    );
    const clinicalSourceRefs = new Set(
      recordItems.map(({ sourceRef }) => sourceRef),
    );
    const allowedSourceRefs = new Set(clinicalSourceRefs);
    for (const thread of threads) {
      allowedSourceRefs.add(`thread:${thread.threadId}@${thread.version}`);
    }
    for (const task of activeTasks) {
      allowedSourceRefs.add(`task:${task.taskId}@${task.version}`);
    }
    return {
      activeTasks,
      snapshot,
      snapshotHash: handoverSourceSnapshotHash(snapshot),
      clinicalSourceRefs,
      allowedSourceRefs,
    };
  }

  private validatePacket(
    packet: HandoverPacket,
    grounding: GroundingState,
  ): void {
    for (const statement of [
      ...packet.situation,
      ...packet.background,
      ...packet.currentConcerns,
    ]) {
      if (
        statement.sourceRefs.some(
          (sourceRef) => !grounding.clinicalSourceRefs.has(sourceRef),
        )
      ) {
        throw new DomainError(
          "HANDOVER_EVIDENCE_NOT_FOUND",
          "Clinical narrative evidence is unavailable in the patient record",
          false,
          409,
        );
      }
    }

    const entries = taskSectionEntries(packet);
    const packetTaskIds = entries.map(({ item }) => item.taskId);
    const uniquePacketTaskIds = new Set(packetTaskIds);
    const activeTasksById = new Map(
      grounding.activeTasks.map((task) => [task.taskId, task]),
    );
    if (
      uniquePacketTaskIds.size !== packetTaskIds.length ||
      uniquePacketTaskIds.size !== activeTasksById.size ||
      [...uniquePacketTaskIds].some((taskId) => !activeTasksById.has(taskId))
    ) {
      throw new DomainError(
        "HANDOVER_TASK_SET_MISMATCH",
        "Handover must include every active task exactly once",
        false,
        409,
      );
    }

    for (const { item, section } of entries) {
      const task = activeTasksById.get(item.taskId);
      if (!task) {
        throw new DomainError(
          "HANDOVER_TASK_SET_MISMATCH",
          "Handover contains an unknown or terminal task",
          false,
          409,
        );
      }
      if (
        item.threadId !== task.threadId ||
        item.summary !== task.summary ||
        item.state !== task.state ||
        item.targetTeamId !== task.targetTeamId ||
        item.assignedMemberId !== task.assignedMemberId ||
        item.clinicalUrgency !== task.clinicalUrgency ||
        item.acceptBy !== task.acceptBy ||
        item.dueBy !== task.dueBy ||
        item.version !== task.version
      ) {
        throw new DomainError(
          "HANDOVER_TASK_MISMATCH",
          "Handover task fields do not match the authoritative task",
          false,
          409,
        );
      }
      if (section !== expectedSection(task)) {
        throw new DomainError(
          "HANDOVER_SECTION_MISMATCH",
          "Handover task is in the wrong lifecycle section",
          false,
          409,
        );
      }
      const exactTaskRef = `task:${task.taskId}@${task.version}`;
      if (
        !item.sourceRefs.includes(exactTaskRef) ||
        item.sourceRefs.some(
          (sourceRef) => !grounding.allowedSourceRefs.has(sourceRef),
        )
      ) {
        throw new DomainError(
          "HANDOVER_EVIDENCE_NOT_FOUND",
          "Handover task evidence is unavailable or stale",
          false,
          409,
        );
      }
    }
  }

  private validateRenderedUnknowns(
    packet: HandoverPacket,
    rendered: RenderedHandover,
  ): void {
    const unknownSections = rendered.sections.filter(
      ({ sectionId }) => sectionId === "unknowns",
    );
    if (packet.unknowns.length === 0) {
      if (unknownSections.length === 0) return;
      throw this.invalidRenderedUnknowns();
    }

    const renderedUnknowns = unknownSections[0]?.statements.map(
      ({ statement }) => statement,
    );
    if (
      unknownSections.length !== 1 ||
      renderedUnknowns === undefined ||
      !sameJson(renderedUnknowns, packet.unknowns)
    ) {
      throw this.invalidRenderedUnknowns();
    }
  }

  private invalidRenderedUnknowns(): DomainError {
    return new DomainError(
      "HANDOVER_EVIDENCE_NOT_FOUND",
      "Rendered handover must preserve every packet unknown exactly once",
      false,
      409,
    );
  }

  private packetSourceRefs(packet: HandoverPacket): Set<string> {
    const sourceRefs = new Set<string>();
    for (const statement of [
      ...packet.situation,
      ...packet.background,
      ...packet.currentConcerns,
    ]) {
      for (const sourceRef of statement.sourceRefs) sourceRefs.add(sourceRef);
    }
    for (const { item } of taskSectionEntries(packet)) {
      for (const sourceRef of item.sourceRefs) sourceRefs.add(sourceRef);
    }
    return sourceRefs;
  }

  private draftConflict(): DomainError {
    return new DomainError(
      "HANDOVER_DRAFT_CONFLICT",
      "Handover draft has already been saved with different inputs",
      false,
      409,
    );
  }

  private finalizeConflict(): DomainError {
    return new DomainError(
      "HANDOVER_FINALIZE_CONFLICT",
      "Handover finalization does not match the saved draft",
      false,
      409,
    );
  }
}
