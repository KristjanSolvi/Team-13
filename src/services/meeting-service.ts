import { createHash, randomUUID } from "node:crypto";

import { DomainError } from "../domain/errors.js";
import { isHandoverTaskActive } from "../domain/handover.js";
import type {
  CarryForwardWarning,
  MeetingReconciliation,
  MeetingSourceSnapshot,
  MeetingTranscriptEvidence,
  PatientMeetingSegment,
  WardMeeting,
} from "../domain/meeting.js";
import { meetingSourceSnapshotSchema } from "../domain/meeting.js";
import type { Actor, ClinicalUrgency, Task } from "../domain/types.js";
import type { Clock } from "../infra/clock.js";
import type { SqliteStore } from "../infra/store.js";
import type { LedgerService } from "./ledger-service.js";

interface CommandMeta {
  idempotencyKey: string;
  actor: Actor;
  correlationId: string;
}

export interface StartMeetingInput extends CommandMeta {
  wardId: string;
  interactionId: string;
}

export interface OpenPatientSegmentInput extends CommandMeta {
  meetingId: string;
  patientId: string;
  expectedMeetingVersion: number;
}

export interface MeetingTranscriptInput {
  segmentKey: string;
  text: string;
  startSeconds: number;
  endSeconds: number;
  speakerId?: number;
  isFinal: boolean;
  audioQuality: "clear" | "uncertain";
}

export interface AppendMeetingTranscriptInput extends CommandMeta {
  meetingId: string;
  patientSegmentId: string | null;
  segments: MeetingTranscriptInput[];
}

export interface ClosePatientSegmentInput extends CommandMeta {
  meetingId: string;
  segmentId: string;
  expectedMeetingVersion: number;
  expectedSegmentVersion: number;
}

export interface CompleteMeetingInput extends CommandMeta {
  meetingId: string;
  expectedMeetingVersion: number;
}

export interface BeginMeetingReconciliationInput extends CommandMeta {
  meetingId: string;
  segmentId: string;
  expectedSegmentVersion: number;
}

export interface MeetingDraftProposal {
  summary: string;
  sourceQuote: string;
  taskType: string;
  evidenceRefs: string[];
  targetTeamId: string;
  requiredCapabilities: string[];
  clinicalUrgency: ClinicalUrgency;
  dueInMs: number;
}

export interface MeetingCarryForwardInput {
  taskRef: string;
  reason: CarryForwardWarning["reason"];
  sourceRefs: string[];
}

export interface SaveMeetingReconciliationInput extends CommandMeta {
  reconciliationId: string;
  patientId: string;
  contextId: string;
  expectedVersion: number;
  sourceSnapshotHash: string;
  proposals: MeetingDraftProposal[];
  carryForwards: MeetingCarryForwardInput[];
}

export interface MeetingResult {
  meeting: WardMeeting;
  replayed: boolean;
}

export interface PatientSegmentResult extends MeetingResult {
  segment: PatientMeetingSegment;
}

export interface TranscriptResult {
  evidence: MeetingTranscriptEvidence[];
  ignoredInterimCount: number;
  replayed: boolean;
}

export interface MeetingReconciliationRequest {
  reconciliation: MeetingReconciliation;
  segment: PatientMeetingSegment;
  sourceSnapshot: MeetingSourceSnapshot;
  replayed: boolean;
}

export interface MeetingReconciliationResult {
  reconciliation: MeetingReconciliation;
  segment: PatientMeetingSegment;
  newDraftTasks: Task[];
  carryForwards: CarryForwardWarning[];
  replayed: boolean;
}

export interface MeetingSegmentContext {
  meetingId: string;
  segment: PatientMeetingSegment;
  evidence: MeetingTranscriptEvidence[];
  sourceSnapshotHash: string;
  reconciliationVersion: number;
}

export interface PreviousPatientMeetingContext {
  previous: {
    segment: PatientMeetingSegment;
    evidence: MeetingTranscriptEvidence[];
    reconciliation: MeetingReconciliation | null;
  } | null;
}

function commandHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function requiredReplayText(
  replay: Record<string, unknown>,
  key: string,
): string {
  const value = replay[key];
  if (typeof value !== "string") {
    throw new DomainError(
      "MEETING_REPLAY_UNAVAILABLE",
      "Meeting command replay is unavailable",
      false,
      409,
    );
  }
  return value;
}

function requiredReplayNumber(
  replay: Record<string, unknown>,
  key: string,
): number {
  const value = replay[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new DomainError(
      "MEETING_REPLAY_UNAVAILABLE",
      "Meeting command replay is unavailable",
      false,
      409,
    );
  }
  return value as number;
}

function verifyReplayHash(
  replay: Record<string, unknown>,
  requestHash: string,
): void {
  if (replay.requestHash !== requestHash) {
    throw new DomainError(
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key was already used for a different meeting command",
      false,
      409,
    );
  }
}

function evidenceReference(
  meetingId: string,
  segmentId: string,
  segmentKey: string,
): string {
  const suffix = createHash("sha256")
    .update(meetingId)
    .update("\0")
    .update(segmentId)
    .update("\0")
    .update(segmentKey)
    .digest("hex")
    .slice(0, 24);
  return `encounter:meeting-${meetingId}.${segmentId}.${suffix}`;
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function contentHash(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function sourceSnapshotHash(snapshot: MeetingSourceSnapshot): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex")}`;
}

function parseTaskReference(reference: string): {
  taskId: string;
  version: number;
} {
  const match = /^task:([0-9a-f-]{36})@([1-9][0-9]*)$/.exec(reference);
  if (!match) {
    throw new DomainError(
      "MEETING_TASK_REFERENCE_INVALID",
      "Carry-forward task reference is invalid",
      false,
      400,
    );
  }
  return { taskId: match[1] as string, version: Number(match[2]) };
}

export class MeetingService {
  constructor(
    private readonly store: SqliteStore,
    private readonly clock: Clock,
    private readonly ledger: LedgerService,
  ) {}

  startMeeting(input: StartMeetingInput): MeetingResult {
    const scope = `meeting:start:${input.actor.id}`;
    const requestHash = commandHash({
      wardId: input.wardId,
      interactionId: input.interactionId,
      actor: input.actor,
    });
    return this.store.transaction(() => {
      const replay = this.store.getProcessedCommand(
        scope,
        input.idempotencyKey,
      );
      if (replay) {
        verifyReplayHash(replay, requestHash);
        return {
          meeting: this.store.requireMeeting(
            requiredReplayText(replay, "meetingId"),
          ),
          replayed: true,
        };
      }
      const occurredAt = this.clock.now().toISOString();
      const meeting: WardMeeting = {
        meetingId: randomUUID(),
        wardId: input.wardId,
        interactionId: input.interactionId,
        status: "recording",
        startedBy: input.actor.id,
        startedAt: occurredAt,
        completedAt: null,
        version: 1,
      };
      this.store.putMeeting(meeting);
      this.store.appendEvent({
        eventType: "meeting.started",
        occurredAt,
        correlationId: input.correlationId,
        patientId: "unscoped",
        interactionId: meeting.interactionId,
        contextId: null,
        actor: input.actor,
        payload: {
          meetingId: meeting.meetingId,
          wardId: meeting.wardId,
          status: meeting.status,
          version: meeting.version,
        },
      });
      this.store.saveProcessedCommand(
        scope,
        input.idempotencyKey,
        { meetingId: meeting.meetingId, requestHash },
        occurredAt,
      );
      return { meeting, replayed: false };
    });
  }

  openPatientSegment(input: OpenPatientSegmentInput): PatientSegmentResult {
    const scope = `meeting:open-segment:${input.meetingId}`;
    const requestHash = commandHash({
      meetingId: input.meetingId,
      patientId: input.patientId,
      expectedMeetingVersion: input.expectedMeetingVersion,
      actor: input.actor,
    });
    return this.store.transaction(() => {
      const replay = this.store.getProcessedCommand(
        scope,
        input.idempotencyKey,
      );
      if (replay) {
        verifyReplayHash(replay, requestHash);
        return {
          meeting: this.store.requireMeeting(input.meetingId),
          segment: this.store.requirePatientMeetingSegment(
            requiredReplayText(replay, "segmentId"),
          ),
          replayed: true,
        };
      }
      const meeting = this.requireRecordingMeeting(
        input.meetingId,
        input.expectedMeetingVersion,
      );
      if (!this.store.getPatient(input.patientId)) {
        throw new DomainError(
          "PATIENT_NOT_FOUND",
          "Patient not found",
          false,
          404,
        );
      }
      if (
        this.store
          .listMeetingPatientSegments(input.meetingId)
          .some((segment) => segment.status === "recording")
      ) {
        throw new DomainError(
          "PATIENT_SEGMENT_ALREADY_OPEN",
          "A patient segment is already recording",
          false,
          409,
        );
      }
      const occurredAt = this.clock.now().toISOString();
      const segment: PatientMeetingSegment = {
        segmentId: randomUUID(),
        meetingId: meeting.meetingId,
        patientId: input.patientId,
        status: "recording",
        openedBy: input.actor.id,
        openedAt: occurredAt,
        closedAt: null,
        version: 1,
      };
      this.store.putPatientMeetingSegment(segment);
      const nextMeeting = this.store.updateMeeting(
        { ...meeting, version: meeting.version + 1 },
        meeting.version,
      );
      this.store.appendEvent({
        eventType: "meeting.patient_segment_opened",
        occurredAt,
        correlationId: input.correlationId,
        patientId: input.patientId,
        interactionId: meeting.interactionId,
        contextId: null,
        actor: input.actor,
        payload: {
          meetingId: meeting.meetingId,
          segmentId: segment.segmentId,
          patientId: segment.patientId,
          status: segment.status,
          version: segment.version,
        },
      });
      this.store.saveProcessedCommand(
        scope,
        input.idempotencyKey,
        { segmentId: segment.segmentId, requestHash },
        occurredAt,
      );
      return { meeting: nextMeeting, segment, replayed: false };
    });
  }

  appendTranscript(input: AppendMeetingTranscriptInput): TranscriptResult {
    const scope = `meeting:transcript:${input.meetingId}`;
    const requestHash = commandHash({
      meetingId: input.meetingId,
      patientSegmentId: input.patientSegmentId,
      segments: input.segments,
      actor: input.actor,
    });
    return this.store.transaction(() => {
      const replay = this.store.getProcessedCommand(
        scope,
        input.idempotencyKey,
      );
      if (replay) {
        verifyReplayHash(replay, requestHash);
        const ids = replay.evidenceIds;
        if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
          throw new DomainError(
            "MEETING_REPLAY_UNAVAILABLE",
            "Meeting transcript replay is unavailable",
            false,
            409,
          );
        }
        return {
          evidence: ids.map((id) => {
            const evidence = this.store.getMeetingTranscriptEvidence(id);
            if (!evidence) {
              throw new DomainError(
                "MEETING_REPLAY_UNAVAILABLE",
                "Meeting transcript replay is unavailable",
                false,
                409,
              );
            }
            return evidence;
          }),
          ignoredInterimCount: requiredReplayNumber(
            replay,
            "ignoredInterimCount",
          ),
          replayed: true,
        };
      }
      const meeting = this.requireRecordingMeeting(input.meetingId);
      const patientSegment =
        input.patientSegmentId === null
          ? null
          : this.store.requirePatientMeetingSegment(input.patientSegmentId);
      if (
        patientSegment !== null &&
        (patientSegment.meetingId !== meeting.meetingId ||
          patientSegment.status !== "recording")
      ) {
        throw new DomainError(
          "PATIENT_SEGMENT_CLOSED",
          "Patient segment is not recording",
          false,
          409,
        );
      }
      const occurredAt = this.clock.now().toISOString();
      const finalSegments = input.segments.filter((segment) => segment.isFinal);
      const evidence = finalSegments.map((segment) => {
        const eligible =
          patientSegment !== null && segment.audioQuality === "clear";
        const stored: MeetingTranscriptEvidence = {
          evidenceId: randomUUID(),
          meetingId: meeting.meetingId,
          patientSegmentId: patientSegment?.segmentId ?? null,
          interactionId: meeting.interactionId,
          segmentKey: segment.segmentKey,
          text: segment.text,
          startSeconds: segment.startSeconds,
          endSeconds: segment.endSeconds,
          ...(segment.speakerId === undefined
            ? {}
            : { speakerId: segment.speakerId }),
          isFinal: true,
          audioQuality: segment.audioQuality,
          eligible,
          sourceRef: eligible
            ? evidenceReference(
                meeting.meetingId,
                patientSegment.segmentId,
                segment.segmentKey,
              )
            : null,
          recordedAt: occurredAt,
        };
        this.store.putMeetingTranscript(stored);
        return stored;
      });
      const ignoredInterimCount = input.segments.length - finalSegments.length;
      this.store.appendEvent({
        eventType: "meeting.transcript_finalized",
        occurredAt,
        correlationId: input.correlationId,
        patientId: patientSegment?.patientId ?? "unscoped",
        interactionId: meeting.interactionId,
        contextId: null,
        actor: input.actor,
        payload: {
          meetingId: meeting.meetingId,
          segmentId: patientSegment?.segmentId ?? null,
          finalCount: evidence.length,
          eligibleCount: evidence.filter((item) => item.eligible).length,
          ignoredInterimCount,
        },
      });
      this.store.saveProcessedCommand(
        scope,
        input.idempotencyKey,
        {
          evidenceIds: evidence.map(({ evidenceId }) => evidenceId),
          ignoredInterimCount,
          requestHash,
        },
        occurredAt,
      );
      return { evidence, ignoredInterimCount, replayed: false };
    });
  }

  closePatientSegment(input: ClosePatientSegmentInput): PatientSegmentResult {
    const scope = `meeting:close-segment:${input.meetingId}`;
    const requestHash = commandHash({
      meetingId: input.meetingId,
      segmentId: input.segmentId,
      expectedMeetingVersion: input.expectedMeetingVersion,
      expectedSegmentVersion: input.expectedSegmentVersion,
      actor: input.actor,
    });
    return this.store.transaction(() => {
      const replay = this.store.getProcessedCommand(
        scope,
        input.idempotencyKey,
      );
      if (replay) {
        verifyReplayHash(replay, requestHash);
        return {
          meeting: this.store.requireMeeting(input.meetingId),
          segment: this.store.requirePatientMeetingSegment(input.segmentId),
          replayed: true,
        };
      }
      const meeting = this.requireRecordingMeeting(
        input.meetingId,
        input.expectedMeetingVersion,
      );
      const segment = this.store.requirePatientMeetingSegment(input.segmentId);
      if (
        segment.meetingId !== meeting.meetingId ||
        segment.status !== "recording" ||
        segment.version !== input.expectedSegmentVersion
      ) {
        throw new DomainError(
          "VERSION_CONFLICT",
          "Patient segment changed before close",
          false,
          409,
        );
      }
      const occurredAt = this.clock.now().toISOString();
      const closed = this.store.updatePatientMeetingSegment(
        {
          ...segment,
          status: "closed",
          closedAt: occurredAt,
          version: segment.version + 1,
        },
        segment.version,
      );
      const nextMeeting = this.store.updateMeeting(
        { ...meeting, version: meeting.version + 1 },
        meeting.version,
      );
      const evidence = this.store
        .listPatientMeetingEvidence(segment.segmentId)
        .filter(
          (item): item is MeetingTranscriptEvidence & { sourceRef: string } =>
            item.eligible && item.sourceRef !== null,
        );
      for (const item of evidence) {
        this.store.putRecordItem({
          itemId: item.evidenceId,
          patientId: segment.patientId,
          itemType: "meeting-evidence",
          text: item.text,
          sourceRef: item.sourceRef,
          recordedAt: item.recordedAt,
        });
      }
      this.store.appendEvent({
        eventType: "meeting.patient_segment_closed",
        occurredAt,
        correlationId: input.correlationId,
        patientId: segment.patientId,
        interactionId: meeting.interactionId,
        contextId: null,
        actor: input.actor,
        payload: {
          meetingId: meeting.meetingId,
          segmentId: closed.segmentId,
          patientId: closed.patientId,
          status: closed.status,
          evidenceCount: evidence.length,
          version: closed.version,
        },
      });
      this.store.saveProcessedCommand(
        scope,
        input.idempotencyKey,
        { segmentId: segment.segmentId, requestHash },
        occurredAt,
      );
      return { meeting: nextMeeting, segment: closed, replayed: false };
    });
  }

  beginReconciliation(
    input: BeginMeetingReconciliationInput,
  ): MeetingReconciliationRequest {
    return this.store.transaction(() => {
      const existing = this.store.getMeetingReconciliationForSegment(
        input.segmentId,
      );
      if (existing) {
        if (existing.idempotencyKey !== input.idempotencyKey) {
          throw new DomainError(
            "MEETING_RECONCILIATION_EXISTS",
            "Patient segment already has a reconciliation",
            false,
            409,
          );
        }
        return {
          reconciliation: existing,
          segment: this.store.requirePatientMeetingSegment(input.segmentId),
          sourceSnapshot: existing.sourceSnapshot,
          replayed: true,
        };
      }
      const meeting = this.store.requireMeeting(input.meetingId);
      const segment = this.store.requirePatientMeetingSegment(input.segmentId);
      if (
        segment.meetingId !== meeting.meetingId ||
        segment.status !== "closed" ||
        segment.version !== input.expectedSegmentVersion
      ) {
        throw new DomainError(
          "VERSION_CONFLICT",
          "Patient segment changed before reconciliation",
          false,
          409,
        );
      }
      const snapshot = this.buildSourceSnapshot(segment);
      const hash = sourceSnapshotHash(snapshot);
      const occurredAt = this.clock.now().toISOString();
      const reconciliationId = randomUUID();
      const reconciliation: MeetingReconciliation = {
        reconciliationId,
        meetingId: meeting.meetingId,
        patientSegmentId: segment.segmentId,
        patientId: segment.patientId,
        interactionId: `meeting-reconciliation:${reconciliationId}`,
        contextId: null,
        idempotencyKey: input.idempotencyKey,
        sourceSnapshot: snapshot,
        sourceSnapshotHash: hash,
        status: "requested",
        newDraftTaskIds: [],
        carryForwardTaskRefs: [],
        createdAt: occurredAt,
        updatedAt: occurredAt,
        version: 1,
      };
      this.store.putMeetingReconciliation(reconciliation);
      const reconciling = this.store.updatePatientMeetingSegment(
        {
          ...segment,
          status: "reconciling",
          version: segment.version + 1,
        },
        segment.version,
      );
      this.store.appendEvent({
        eventType: "meeting.reconciliation_requested",
        occurredAt,
        correlationId: input.correlationId,
        patientId: segment.patientId,
        interactionId: reconciliation.interactionId,
        contextId: null,
        actor: input.actor,
        payload: {
          meetingId: meeting.meetingId,
          segmentId: segment.segmentId,
          reconciliationId,
          status: reconciliation.status,
          version: reconciliation.version,
        },
      });
      this.store.appendEvent({
        eventType: "meeting.sources_retrieved",
        occurredAt,
        correlationId: input.correlationId,
        patientId: segment.patientId,
        interactionId: reconciliation.interactionId,
        contextId: null,
        actor: input.actor,
        payload: {
          meetingId: meeting.meetingId,
          segmentId: segment.segmentId,
          reconciliationId,
          currentEvidenceCount: snapshot.currentEvidence.length,
          previousEvidenceCount: snapshot.previousEvidence.length,
          taskCount: snapshot.tasks.length,
          hasHandover: snapshot.handover !== null,
        },
      });
      return {
        reconciliation,
        segment: reconciling,
        sourceSnapshot: snapshot,
        replayed: false,
      };
    });
  }

  saveReconciliation(
    input: SaveMeetingReconciliationInput,
  ): MeetingReconciliationResult {
    const scope = `meeting:save-reconciliation:${input.reconciliationId}`;
    const requestHash = commandHash({
      reconciliationId: input.reconciliationId,
      patientId: input.patientId,
      contextId: input.contextId,
      expectedVersion: input.expectedVersion,
      sourceSnapshotHash: input.sourceSnapshotHash,
      proposals: input.proposals,
      carryForwards: input.carryForwards,
      actor: input.actor,
    });
    return this.store.transaction(() => {
      const replay = this.store.getProcessedCommand(
        scope,
        input.idempotencyKey,
      );
      if (replay) {
        verifyReplayHash(replay, requestHash);
        const reconciliation = this.store.requireMeetingReconciliation(
          input.reconciliationId,
        );
        return {
          reconciliation,
          segment: this.store.requirePatientMeetingSegment(
            reconciliation.patientSegmentId,
          ),
          newDraftTasks: reconciliation.newDraftTaskIds.map((taskId) =>
            this.store.requireTask(taskId),
          ),
          carryForwards: this.store.listMeetingCarryForwards(
            reconciliation.reconciliationId,
          ),
          replayed: true,
        };
      }
      const reconciliation = this.store.requireMeetingReconciliation(
        input.reconciliationId,
      );
      if (
        reconciliation.patientId !== input.patientId ||
        reconciliation.status !== "requested" ||
        reconciliation.version !== input.expectedVersion
      ) {
        throw new DomainError(
          "VERSION_CONFLICT",
          "Meeting reconciliation changed before save",
          false,
          409,
        );
      }
      if (
        this.store.patientForContext(input.contextId) !== input.patientId ||
        this.store.contextForInteraction(reconciliation.interactionId) !==
          input.contextId
      ) {
        throw new DomainError(
          "PATIENT_SCOPE_DENIED",
          "Meeting reconciliation context is not patient scoped",
          false,
          403,
        );
      }
      if (reconciliation.sourceSnapshotHash !== input.sourceSnapshotHash) {
        throw new DomainError(
          "MEETING_SOURCE_CHANGED",
          "Meeting sources changed before reconciliation save",
          true,
          409,
        );
      }
      const segment = this.store.requirePatientMeetingSegment(
        reconciliation.patientSegmentId,
      );
      const currentSnapshot = this.buildSourceSnapshot(segment);
      if (sourceSnapshotHash(currentSnapshot) !== input.sourceSnapshotHash) {
        throw new DomainError(
          "MEETING_SOURCE_CHANGED",
          "Meeting sources changed before reconciliation save",
          true,
          409,
        );
      }
      const evidence = this.reconciliationEvidence(segment);
      this.validateProposals(input.proposals, evidence);
      const activeTasks = this.store
        .listPatientTasks(input.patientId)
        .filter(isHandoverTaskActive);
      this.validateCarryForwards(input.carryForwards, activeTasks);

      const occurredAt = this.clock.now().toISOString();
      const newDraftTasks = input.proposals.map((proposal, index) =>
        this.ledger.createDraft({
          patientId: input.patientId,
          interactionId: reconciliation.interactionId,
          contextId: input.contextId,
          origin: "agent_suggested",
          summary: proposal.summary,
          taskType: proposal.taskType,
          evidenceRefs: proposal.evidenceRefs,
          targetTeamId: proposal.targetTeamId,
          requiredCapabilities: proposal.requiredCapabilities,
          clinicalUrgency: proposal.clinicalUrgency,
          dueInMs: proposal.dueInMs,
          idempotencyKey: `${input.idempotencyKey}:proposal:${index + 1}`,
          actor: input.actor,
        }),
      );
      const carryForwards = input.carryForwards.map((carryForward) => {
        const warning: CarryForwardWarning = {
          warningId: randomUUID(),
          reconciliationId: reconciliation.reconciliationId,
          patientId: input.patientId,
          taskRef: carryForward.taskRef,
          reason: carryForward.reason,
          sourceRefs: [...carryForward.sourceRefs],
          createdAt: occurredAt,
        };
        this.store.putMeetingCarryForward(warning);
        return warning;
      });
      const saved = this.store.updateMeetingReconciliation(
        {
          ...reconciliation,
          contextId: input.contextId,
          status: "saved",
          newDraftTaskIds: newDraftTasks.map(({ taskId }) => taskId),
          carryForwardTaskRefs: carryForwards.map(({ taskRef }) => taskRef),
          updatedAt: occurredAt,
          version: reconciliation.version + 1,
        },
        reconciliation.version,
      );
      const reconciled = this.store.updatePatientMeetingSegment(
        {
          ...segment,
          status: "reconciled",
          version: segment.version + 1,
        },
        segment.version,
      );
      this.store.appendEvent({
        eventType: "meeting.reconciliation_saved",
        occurredAt,
        correlationId: input.correlationId,
        patientId: input.patientId,
        interactionId: reconciliation.interactionId,
        contextId: input.contextId,
        actor: input.actor,
        payload: {
          meetingId: reconciliation.meetingId,
          segmentId: reconciliation.patientSegmentId,
          reconciliationId: reconciliation.reconciliationId,
          draftCount: newDraftTasks.length,
          carryForwardCount: carryForwards.length,
          status: saved.status,
          version: saved.version,
        },
      });
      for (const task of newDraftTasks) {
        this.store.appendEvent({
          eventType: "meeting.draft_task_created",
          occurredAt,
          correlationId: input.correlationId,
          patientId: input.patientId,
          interactionId: reconciliation.interactionId,
          contextId: input.contextId,
          actor: input.actor,
          payload: {
            meetingId: reconciliation.meetingId,
            reconciliationId: reconciliation.reconciliationId,
            taskId: task.taskId,
            state: task.state,
            version: task.version,
          },
        });
      }
      for (const warning of carryForwards) {
        this.store.appendEvent({
          eventType: "meeting.carry_forward_recorded",
          occurredAt,
          correlationId: input.correlationId,
          patientId: input.patientId,
          interactionId: reconciliation.interactionId,
          contextId: input.contextId,
          actor: input.actor,
          payload: {
            meetingId: reconciliation.meetingId,
            reconciliationId: reconciliation.reconciliationId,
            warningId: warning.warningId,
            taskRef: warning.taskRef,
            reason: warning.reason,
          },
        });
      }
      this.store.saveProcessedCommand(
        scope,
        input.idempotencyKey,
        { reconciliationId: saved.reconciliationId, requestHash },
        occurredAt,
      );
      return {
        reconciliation: saved,
        segment: reconciled,
        newDraftTasks,
        carryForwards,
        replayed: false,
      };
    });
  }

  getMeetingSegment(
    contextId: string,
    reconciliationId: string,
    patientId: string,
  ): MeetingSegmentContext {
    const reconciliation = this.requireReconciliationScope(
      contextId,
      reconciliationId,
      patientId,
    );
    const segment = this.store.requirePatientMeetingSegment(
      reconciliation.patientSegmentId,
    );
    return {
      meetingId: reconciliation.meetingId,
      segment,
      evidence: this.store
        .listPatientMeetingEvidence(segment.segmentId)
        .filter((item) => item.eligible),
      sourceSnapshotHash: reconciliation.sourceSnapshotHash,
      reconciliationVersion: reconciliation.version,
    };
  }

  getPreviousPatientMeetingContext(
    contextId: string,
    reconciliationId: string,
    patientId: string,
  ): PreviousPatientMeetingContext {
    const reconciliation = this.requireReconciliationScope(
      contextId,
      reconciliationId,
      patientId,
    );
    const previous = this.store.getPreviousPatientMeeting(
      patientId,
      reconciliation.meetingId,
    );
    return {
      previous: previous
        ? {
            segment: previous,
            evidence: this.store
              .listPatientMeetingEvidence(previous.segmentId)
              .filter((item) => item.eligible),
            reconciliation: this.store.getMeetingReconciliationForSegment(
              previous.segmentId,
            ),
          }
        : null,
    };
  }

  getLatestPatientHandover(
    contextId: string,
    reconciliationId: string,
    patientId: string,
  ) {
    this.requireReconciliationScope(contextId, reconciliationId, patientId);
    const handover = this.store
      .listPatientHandovers(patientId)
      .filter((candidate) => candidate.status === "rendered")
      .at(-1);
    return {
      handover: handover
        ? {
            handoverId: handover.handoverId,
            version: handover.version,
            packet: handover.packet,
            rendered: handover.rendered,
            sourceSnapshotHash: handover.sourceSnapshotHash,
          }
        : null,
    };
  }

  getMeetingResponse(meetingId: string) {
    const meeting = this.store.requireMeeting(meetingId);
    return {
      meeting,
      segments: this.store
        .listMeetingPatientSegments(meetingId)
        .map((segment) => {
          const reconciliation = this.store.getMeetingReconciliationForSegment(
            segment.segmentId,
          );
          return {
            segment,
            evidenceCount: this.store.listPatientMeetingEvidence(
              segment.segmentId,
            ).length,
            eligibleEvidenceCount: this.store
              .listPatientMeetingEvidence(segment.segmentId)
              .filter((item) => item.eligible).length,
            reconciliation,
            newDraftTasks:
              reconciliation?.newDraftTaskIds.map((taskId) =>
                this.store.requireTask(taskId),
              ) ?? [],
            carryForwards: reconciliation
              ? this.store.listMeetingCarryForwards(
                  reconciliation.reconciliationId,
                )
              : [],
          };
        }),
      unscopedTranscriptCount: this.store
        .listMeetingTranscript(meetingId)
        .filter((item) => item.patientSegmentId === null).length,
    };
  }

  completeMeeting(input: CompleteMeetingInput): MeetingResult {
    const scope = `meeting:complete:${input.meetingId}`;
    const requestHash = commandHash({
      meetingId: input.meetingId,
      expectedMeetingVersion: input.expectedMeetingVersion,
      actor: input.actor,
    });
    return this.store.transaction(() => {
      const replay = this.store.getProcessedCommand(
        scope,
        input.idempotencyKey,
      );
      if (replay) {
        verifyReplayHash(replay, requestHash);
        return {
          meeting: this.store.requireMeeting(input.meetingId),
          replayed: true,
        };
      }
      const meeting = this.requireRecordingMeeting(
        input.meetingId,
        input.expectedMeetingVersion,
      );
      if (
        this.store
          .listMeetingPatientSegments(input.meetingId)
          .some((segment) => segment.status === "recording")
      ) {
        throw new DomainError(
          "MEETING_IN_PROGRESS",
          "Meeting has an open patient segment",
          false,
          409,
        );
      }
      const occurredAt = this.clock.now().toISOString();
      const completed = this.store.updateMeeting(
        {
          ...meeting,
          status: "completed",
          completedAt: occurredAt,
          version: meeting.version + 1,
        },
        meeting.version,
      );
      this.store.appendEvent({
        eventType: "meeting.completed",
        occurredAt,
        correlationId: input.correlationId,
        patientId: "unscoped",
        interactionId: meeting.interactionId,
        contextId: null,
        actor: input.actor,
        payload: {
          meetingId: completed.meetingId,
          status: completed.status,
          version: completed.version,
        },
      });
      this.store.saveProcessedCommand(
        scope,
        input.idempotencyKey,
        { meetingId: meeting.meetingId, requestHash },
        occurredAt,
      );
      return { meeting: completed, replayed: false };
    });
  }

  private requireRecordingMeeting(
    meetingId: string,
    expectedVersion?: number,
  ): WardMeeting {
    const meeting = this.store.requireMeeting(meetingId);
    if (meeting.status !== "recording") {
      throw new DomainError(
        "MEETING_NOT_RECORDING",
        "Meeting is not recording",
        false,
        409,
      );
    }
    if (expectedVersion !== undefined && meeting.version !== expectedVersion) {
      throw new DomainError(
        "VERSION_CONFLICT",
        "Meeting changed before the command",
        false,
        409,
      );
    }
    return meeting;
  }

  private requireReconciliationScope(
    contextId: string,
    reconciliationId: string,
    patientId: string,
  ): MeetingReconciliation {
    const reconciliation =
      this.store.requireMeetingReconciliation(reconciliationId);
    if (
      reconciliation.patientId !== patientId ||
      this.store.patientForContext(contextId) !== patientId ||
      this.store.contextForInteraction(reconciliation.interactionId) !==
        contextId
    ) {
      throw new DomainError(
        "PATIENT_SCOPE_DENIED",
        "Meeting reconciliation scope is unavailable",
        false,
        403,
      );
    }
    return reconciliation;
  }

  private buildSourceSnapshot(
    segment: PatientMeetingSegment,
  ): MeetingSourceSnapshot {
    const currentEvidence = this.store
      .listPatientMeetingEvidence(segment.segmentId)
      .filter(
        (item): item is MeetingTranscriptEvidence & { sourceRef: string } =>
          item.eligible && item.sourceRef !== null,
      )
      .map((item) => ({
        sourceRef: item.sourceRef,
        contentHash: contentHash(item.text),
      }))
      .sort((left, right) => codeUnitCompare(left.sourceRef, right.sourceRef));
    const previousSegment = this.store.getPreviousPatientMeeting(
      segment.patientId,
      segment.meetingId,
    );
    const previousEvidence = previousSegment
      ? this.store
          .listPatientMeetingEvidence(previousSegment.segmentId)
          .filter(
            (item): item is MeetingTranscriptEvidence & { sourceRef: string } =>
              item.eligible && item.sourceRef !== null,
          )
          .map((item) => ({
            sourceRef: item.sourceRef,
            contentHash: contentHash(item.text),
          }))
          .sort((left, right) =>
            codeUnitCompare(left.sourceRef, right.sourceRef),
          )
      : [];
    const latestHandover = this.store
      .listPatientHandovers(segment.patientId)
      .filter(
        (handover) =>
          handover.status === "rendered" &&
          handover.sourceSnapshotHash !== null,
      )
      .at(-1);
    const tasks = this.store
      .listPatientTasks(segment.patientId)
      .filter(isHandoverTaskActive)
      .map(({ taskId, version }) => ({ taskId, version }))
      .sort((left, right) => codeUnitCompare(left.taskId, right.taskId));
    return meetingSourceSnapshotSchema.parse({
      currentEvidence,
      previousEvidence,
      handover: latestHandover
        ? {
            handoverId: latestHandover.handoverId,
            version: latestHandover.version,
            sourceSnapshotHash: latestHandover.sourceSnapshotHash,
          }
        : null,
      tasks,
    });
  }

  private reconciliationEvidence(
    segment: PatientMeetingSegment,
  ): Map<string, MeetingTranscriptEvidence> {
    const previous = this.store.getPreviousPatientMeeting(
      segment.patientId,
      segment.meetingId,
    );
    const eligible = [
      ...this.store.listPatientMeetingEvidence(segment.segmentId),
      ...(previous
        ? this.store.listPatientMeetingEvidence(previous.segmentId)
        : []),
    ].filter(
      (item): item is MeetingTranscriptEvidence & { sourceRef: string } =>
        item.eligible && item.sourceRef !== null,
    );
    return new Map(eligible.map((item) => [item.sourceRef, item]));
  }

  private validateProposals(
    proposals: MeetingDraftProposal[],
    evidence: Map<string, MeetingTranscriptEvidence>,
  ): void {
    if (proposals.length > 50) {
      throw new DomainError(
        "MEETING_PROPOSAL_LIMIT",
        "Meeting reconciliation contains too many draft proposals",
      );
    }
    for (const proposal of proposals) {
      if (
        proposal.summary.trim().length === 0 ||
        proposal.sourceQuote.trim().length === 0 ||
        proposal.evidenceRefs.length === 0 ||
        new Set(proposal.evidenceRefs).size !== proposal.evidenceRefs.length
      ) {
        throw new DomainError(
          "MEETING_EVIDENCE_NOT_FOUND",
          "Meeting proposal requires unique grounded evidence",
          false,
          409,
        );
      }
      const resolved = proposal.evidenceRefs.map((reference) => {
        const item = evidence.get(reference);
        if (!item) {
          throw new DomainError(
            "MEETING_EVIDENCE_NOT_FOUND",
            "Meeting proposal evidence is unavailable",
            false,
            409,
          );
        }
        return item;
      });
      if (!resolved.some((item) => item.text.includes(proposal.sourceQuote))) {
        throw new DomainError(
          "MEETING_EVIDENCE_NOT_FOUND",
          "Meeting proposal quote is not present in its evidence",
          false,
          409,
        );
      }
    }
  }

  private validateCarryForwards(
    carryForwards: MeetingCarryForwardInput[],
    activeTasks: Task[],
  ): void {
    if (
      carryForwards.length > 50 ||
      new Set(carryForwards.map(({ taskRef }) => taskRef)).size !==
        carryForwards.length
    ) {
      throw new DomainError(
        "MEETING_TASK_REFERENCE_INVALID",
        "Carry-forward task references must be unique",
      );
    }
    const tasks = new Map(activeTasks.map((task) => [task.taskId, task]));
    for (const carryForward of carryForwards) {
      const reference = parseTaskReference(carryForward.taskRef);
      const task = tasks.get(reference.taskId);
      if (!task || task.version !== reference.version) {
        throw new DomainError(
          "MEETING_SOURCE_CHANGED",
          "Carry-forward task is unavailable or stale",
          true,
          409,
        );
      }
      if (
        new Set(carryForward.sourceRefs).size !==
          carryForward.sourceRefs.length ||
        !carryForward.sourceRefs.every((sourceRef) =>
          task.evidenceRefs.includes(sourceRef),
        )
      ) {
        throw new DomainError(
          "MEETING_EVIDENCE_NOT_FOUND",
          "Carry-forward evidence must come from the current task",
          false,
          409,
        );
      }
    }
  }
}
