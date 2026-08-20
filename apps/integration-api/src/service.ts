import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import type {
  FollowThroughCandidate,
  HandoverRequest,
  MeetingSegmentClose,
  MeetingSegmentOpen,
  MeetingTranscriptAppend,
  PipelineProxyPath,
  TaskCommand,
  WardMeetingComplete,
  WardMeetingStart,
} from "./contracts.js";
import { IntegrationError } from "./errors.js";
import type {
  AgenticGateway,
  DownstreamGateway,
  MockEhrGateway,
  PipelineGateway,
  ProfileGateway,
  RequestMeta,
  UpstreamJsonResult,
} from "./gateways.js";
import { projectWardCompanionOverview } from "./ward-companion.js";

interface ServiceStatus {
  reachable: boolean;
  detail?: unknown;
  error?: string;
}

export interface EhrDependencies {
  profile: ProfileGateway;
  mockEhr: MockEhrGateway;
}

const sourceSnapshotHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const ambientSessionSchema = z
  .object({
    interactionId: z.string().min(1).max(200),
    accessToken: z.string().min(1),
    expiresIn: z.number().int().positive(),
    tenantName: z.string().min(1),
    environment: z.string().min(1),
    primaryLanguage: z.string().min(1),
    outputLanguage: z.string().min(1),
  })
  .strict();
const wardMeetingSchema = z
  .object({
    meetingId: z.string().uuid(),
    wardId: z.string().min(1).max(200),
    interactionId: z.string().min(1).max(200),
    status: z.enum(["recording", "completed", "failed"]),
    startedBy: z.string().min(1).max(200),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    version: z.number().int().positive(),
  })
  .strict();
const patientMeetingSegmentSchema = z
  .object({
    segmentId: z.string().uuid(),
    meetingId: z.string().uuid(),
    patientId: z.string().min(1).max(200),
    status: z.enum([
      "recording",
      "closed",
      "reconciling",
      "reconciled",
      "failed",
    ]),
    openedBy: z.string().min(1).max(200),
    openedAt: z.string().datetime(),
    closedAt: z.string().datetime().nullable(),
    version: z.number().int().positive(),
  })
  .strict();
const meetingResultSchema = z
  .object({ meeting: wardMeetingSchema, replayed: z.boolean() })
  .strict();
const patientMeetingResultSchema = meetingResultSchema
  .extend({ segment: patientMeetingSegmentSchema })
  .strict();
const transcriptEvidenceSchema = z
  .object({
    evidenceId: z.string().uuid(),
    meetingId: z.string().uuid(),
    patientSegmentId: z.string().uuid().nullable(),
    interactionId: z.string().min(1).max(200),
    segmentKey: z.string().min(1).max(200),
    text: z.string().min(1).max(4_000),
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().nonnegative(),
    speakerId: z.number().int().optional(),
    isFinal: z.boolean(),
    audioQuality: z.enum(["clear", "uncertain"]),
    eligible: z.boolean(),
    sourceRef: z.string().nullable(),
    recordedAt: z.string().datetime(),
  })
  .strict();
const meetingTranscriptResultSchema = z
  .object({
    evidence: z.array(transcriptEvidenceSchema).max(500),
    ignoredInterimCount: z.number().int().nonnegative(),
    replayed: z.boolean(),
  })
  .strict();
const meetingReconciliationSummarySchema = z
  .object({
    reconciliationId: z.string().uuid(),
    meetingId: z.string().uuid(),
    patientSegmentId: z.string().uuid(),
    patientId: z.string().min(1).max(200),
    status: z.enum(["requested", "saved", "failed"]),
    newDraftTaskIds: z.array(z.string().uuid()).max(50),
    carryForwardTaskRefs: z.array(z.string().min(1).max(240)).max(50),
    version: z.number().int().positive(),
  })
  .strip();
const meetingDraftTaskSummarySchema = z
  .object({
    taskId: z.string().uuid(),
    summary: z.string().min(1).max(240),
    state: z.enum([
      "draft",
      "offered_to_team",
      "assigned_to_member",
      "accepted",
      "completed",
      "verified",
      "escalated",
      "dismissed",
    ]),
    version: z.number().int().positive(),
  })
  .strip();
const meetingCarryForwardSummarySchema = z
  .object({
    warningId: z.string().uuid(),
    taskRef: z.string().min(1).max(240),
    reason: z.enum(["unresolved", "not_discussed", "overdue"]),
  })
  .strip();
const meetingReconciliationResultSchema = z
  .object({
    replayed: z.boolean(),
    reconciliation: meetingReconciliationSummarySchema,
    newDraftTasks: z.array(meetingDraftTaskSummarySchema).max(50),
    carryForwards: z.array(meetingCarryForwardSummarySchema).max(50),
  })
  .strict();
const meetingReadSchema = z
  .object({
    meeting: wardMeetingSchema,
    segments: z
      .array(
        z
          .object({
            segment: patientMeetingSegmentSchema,
            evidenceCount: z.number().int().nonnegative(),
            eligibleEvidenceCount: z.number().int().nonnegative(),
            reconciliation: meetingReconciliationSummarySchema.nullable(),
            newDraftTasks: z.array(meetingDraftTaskSummarySchema).max(50),
            carryForwards: z
              .array(meetingCarryForwardSummarySchema)
              .max(50),
          })
          .strict(),
      )
      .max(500),
    unscopedTranscriptCount: z.number().int().nonnegative(),
  })
  .strict();
const handoverIdSchema = z.string().uuid();
const trimmedString = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim(), "Expected trimmed text");
const groundedStatementSchema = z
  .object({
    statement: trimmedString(1_000),
    sourceRefs: z.array(z.string().min(1).max(240)).min(1).max(20),
  })
  .strict();
const handoverTaskItemSchema = z
  .object({
    taskId: z.string().uuid(),
    threadId: z.string().uuid(),
    summary: z.string().min(1).max(240),
    state: z.enum([
      "draft",
      "offered_to_team",
      "assigned_to_member",
      "accepted",
      "completed",
      "escalated",
    ]),
    targetTeamId: z.string().min(1).max(160),
    assignedMemberId: z.string().min(1).max(160).nullable(),
    clinicalUrgency: z.enum(["high", "medium", "routine"]),
    acceptBy: z.string().datetime(),
    dueBy: z.string().datetime(),
    version: z.number().int().positive(),
    sourceRefs: z.array(z.string().min(1).max(240)).min(1).max(20),
  })
  .strict();
const handoverPacketSchema = z
  .object({
    situation: z.array(groundedStatementSchema).max(20),
    background: z.array(groundedStatementSchema).max(20),
    currentConcerns: z.array(groundedStatementSchema).max(20),
    outstandingTasks: z.array(handoverTaskItemSchema).max(50),
    awaitingVerification: z.array(handoverTaskItemSchema).max(50),
    escalations: z.array(handoverTaskItemSchema).max(50),
    unknowns: z.array(trimmedString(500)).max(20),
  })
  .strict();
const renderedStatementSchema = z
  .object({
    statement: trimmedString(1_000),
    sourceRefs: z.array(z.string().min(1).max(240)).max(20),
  })
  .strict();
const renderedSectionIdSchema = z.enum([
  "situation",
  "background",
  "current-concerns",
  "outstanding-tasks",
  "awaiting-verification",
  "escalations",
  "unknowns",
]);
const renderedHandoverSchema = z
  .object({
    title: trimmedString(160),
    sections: z
      .array(
        z
          .object({
            sectionId: renderedSectionIdSchema,
            heading: trimmedString(160),
            statements: z.array(renderedStatementSchema).max(50),
          })
          .strict()
          .superRefine((section, context) => {
            for (const [index, statement] of section.statements.entries()) {
              if (
                section.sectionId === "unknowns" &&
                statement.sourceRefs.length !== 0
              ) {
                context.addIssue({
                  code: "custom",
                  message: "Unknown statements must not cite evidence",
                  path: ["statements", index, "sourceRefs"],
                });
              }
              if (
                section.sectionId !== "unknowns" &&
                statement.sourceRefs.length === 0
              ) {
                context.addIssue({
                  code: "custom",
                  message: "Rendered statements require evidence",
                  path: ["statements", index, "sourceRefs"],
                });
              }
            }
          }),
      )
      .max(10),
    creditsConsumed: z.number().nonnegative(),
  })
  .strict();
const handoverActivityActorSchema = z
  .object({
    type: z.enum(["agent", "clinician", "team_member", "router", "system"]),
    id: z.string().min(1).max(160),
  })
  .strict();
const handoverActivityBase = {
  occurredAt: z.string().datetime(),
  actor: handoverActivityActorSchema,
};
const handoverActivitySchema = z.discriminatedUnion("eventType", [
  z
    .object({
      ...handoverActivityBase,
      eventType: z.literal("handover.requested"),
      payload: z
        .object({
          handoverId: handoverIdSchema,
          reason: z.enum(["assignment", "on_demand"]),
          focusProvided: z.boolean(),
          status: z.literal("requested"),
          version: z.number().int().positive(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...handoverActivityBase,
      eventType: z.literal("handover.context_initialized"),
      payload: z
        .object({
          handoverId: handoverIdSchema,
          contextId: z.string().min(1).max(160),
          status: z.literal("requested"),
          version: z.number().int().positive(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...handoverActivityBase,
      eventType: z.literal("handover.sources_retrieved"),
      payload: z
        .object({
          handoverId: handoverIdSchema,
          sourceSnapshotHash: sourceSnapshotHashSchema,
          recordItemCount: z.number().int().nonnegative(),
          threadCount: z.number().int().nonnegative(),
          taskCount: z.number().int().nonnegative(),
          status: z.literal("draft"),
          version: z.number().int().positive(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...handoverActivityBase,
      eventType: z.literal("handover.draft_saved"),
      payload: z
        .object({
          handoverId: handoverIdSchema,
          sourceSnapshotHash: sourceSnapshotHashSchema,
          status: z.literal("draft"),
          version: z.number().int().positive(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...handoverActivityBase,
      eventType: z.literal("handover.render_requested"),
      payload: z
        .object({
          handoverId: handoverIdSchema,
          status: z.literal("draft"),
          version: z.number().int().positive(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...handoverActivityBase,
      eventType: z.literal("handover.source_changed"),
      payload: z
        .object({
          handoverId: handoverIdSchema,
          expectedSnapshotHash: sourceSnapshotHashSchema,
          currentSnapshotHash: sourceSnapshotHashSchema,
          status: z.literal("draft"),
          version: z.number().int().positive(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...handoverActivityBase,
      eventType: z.literal("handover.rendered"),
      payload: z
        .object({
          handoverId: handoverIdSchema,
          sourceSnapshotHash: sourceSnapshotHashSchema,
          version: z.number().int().positive(),
          creditsConsumed: z.number().nonnegative(),
          sectionCount: z.number().int().nonnegative(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...handoverActivityBase,
      eventType: z.literal("handover.failed"),
      payload: z
        .object({
          handoverId: handoverIdSchema,
          code: z.string().min(1).max(160),
          retryable: z.boolean(),
          status: z.literal("failed"),
          version: z.number().int().positive(),
        })
        .strict(),
    })
    .strict(),
]);
const publicHandoverSchema = z
  .object({
    handoverId: handoverIdSchema,
    patientId: z.string().min(1).max(160),
    status: z.literal("draft"),
    renderingStatus: z.enum(["pending", "rendered"]),
    reason: z.enum(["assignment", "on_demand"]),
    requestedBy: z.string().min(1).max(120),
    generatedAt: z.string().datetime().nullable(),
    version: z.number().int().positive(),
    sourceSnapshotHash: sourceSnapshotHashSchema,
    packet: handoverPacketSchema,
    rendered: renderedHandoverSchema.nullable(),
    activity: z.array(handoverActivitySchema),
  })
  .strict();
const handoverEnvelopeSchema = z
  .object({
    replayed: z.boolean(),
    lifecycleStatus: z.enum(["draft", "rendered"]),
    handover: publicHandoverSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const isRendered = value.lifecycleStatus === "rendered";
    if (
      (value.handover.renderingStatus === "rendered") !== isRendered ||
      (value.handover.rendered !== null) !== isRendered ||
      (value.handover.generatedAt !== null) !== isRendered
    ) {
      context.addIssue({
        code: "custom",
        message: "Handover lifecycle and public projection do not match",
      });
    }
  });

type HandoverEnvelope = z.infer<typeof handoverEnvelopeSchema>;

const publishedTaskSchema = z
  .object({
    taskId: z.string().min(1).max(160),
    patientId: z.string().min(1).max(160),
    summary: z.string().min(5).max(1_000),
    taskType: z.string().min(1).max(160),
    targetTeamId: z
      .string()
      .min(2)
      .max(80)
      .regex(/^[a-z][a-z0-9-]+$/),
    dueBy: z.iso.datetime({ offset: true }),
    state: z.enum([
      "offered_to_team",
      "assigned_to_member",
      "accepted",
      "completed",
      "verified",
      "escalated",
    ]),
    version: z.number().int().positive(),
  })
  .strip();

const publishedTaskEnvelopeSchema = z
  .object({ task: publishedTaskSchema })
  .passthrough();

const referralSnapshotReferenceSchema = z
  .object({
    referralId: z.string().min(1).max(160),
    patientId: z.string().min(1).max(160),
  })
  .strip();

export class IntegrationService {
  constructor(
    private readonly agentic: AgenticGateway,
    private readonly pipeline: PipelineGateway,
    private readonly now: () => Date = () => new Date(),
    private readonly ehr?: EhrDependencies,
    private readonly downstream?: DownstreamGateway,
  ) {}

  async readiness() {
    const [agentic, pipeline] = await Promise.all([
      safeStatus(() => this.agentic.health()),
      safeStatus(() => this.pipeline.health()),
    ]);
    const ready = agentic.reachable && pipeline.reachable;
    const liveCortiReady =
      ready &&
      typeof pipeline.detail === "object" &&
      pipeline.detail !== null &&
      (pipeline.detail as { cortiConfigured?: unknown }).cortiConfigured === true;
    const base = {
      status: ready ? ("ready" as const) : ("degraded" as const),
      liveCortiReady,
      services: { agentic, pipeline },
    };
    if (this.ehr === undefined && this.downstream === undefined) return base;

    const [profile, mockEhr, downstream] = await Promise.all([
      this.ehr === undefined
        ? Promise.resolve(undefined)
        : safeStatus(() => this.ehr?.profile.health() as Promise<unknown>),
      this.ehr === undefined
        ? Promise.resolve(undefined)
        : safeStatus(() => this.ehr?.mockEhr.health() as Promise<unknown>),
      this.downstream === undefined
        ? Promise.resolve(undefined)
        : safeStatus(() => this.downstream?.health() as Promise<unknown>),
    ]);
    const dependenciesReady = [profile, mockEhr, downstream]
      .filter((status): status is ServiceStatus => status !== undefined)
      .every((status) => status.reachable);
    return {
      ...base,
      status: ready && dependenciesReady ? ("ready" as const) : ("degraded" as const),
      services: {
        agentic,
        pipeline,
        ...(profile === undefined ? {} : { profile }),
        ...(mockEhr === undefined ? {} : { mockEhr }),
        ...(downstream === undefined ? {} : { downstream }),
      },
    };
  }

  async investigateCandidate(
    candidate: FollowThroughCandidate,
    correlationId: string,
  ): Promise<{ candidateId: string; handoff: unknown }> {
    if (
      candidate.evidence.some(
        (evidence) => evidence.interactionId !== candidate.interactionId,
      )
    ) {
      throw new IntegrationError(
        "CANDIDATE_SCOPE_MISMATCH",
        "Candidate evidence must belong to the same interaction",
      );
    }
    const stableId = createHash("sha256")
      .update(candidate.patientId)
      .update("\0")
      .update(candidate.interactionId)
      .update("\0")
      .update(candidate.candidateId)
      .digest("hex")
      .slice(0, 24);
    const evidenceRefs = candidate.evidence.map(
      (_evidence, index) => `encounter:candidate-${stableId}.${index + 1}`,
    );
    const sourceEvidence = candidate.evidence.map((evidence, index) => ({
      evidenceRef: evidenceRefs[index] as string,
      sourceQuote: evidence.sourceQuote,
      startSeconds: evidence.startSeconds,
      endSeconds: evidence.endSeconds,
      ...(evidence.speakerId === undefined
        ? {}
        : { speakerId: evidence.speakerId }),
    }));
    const handoff = await this.agentic.submitSignal(
      {
        patientId: candidate.patientId,
        interactionId: candidate.interactionId,
        signalText: candidate.summary,
        evidenceRefs,
        sourceEvidence,
        idempotencyKey: `candidate-${stableId}`,
      },
      {
        actorId: "pipeline:candidate-handoff",
        correlationId,
      },
    );
    return { candidateId: candidate.candidateId, handoff };
  }

  async patientOverview(patientId: string, correlationId: string) {
    const meta = { correlationId };
    const [threads, tasks] = await Promise.all([
      this.agentic.listThreads(patientId, meta),
      this.agentic.listTasks(patientId, meta),
    ]);
    return {
      patientId,
      threads,
      tasks,
      observedAt: this.now().toISOString(),
    };
  }

  async wardCompanionOverview(patientId: string, correlationId: string) {
    return projectWardCompanionOverview(
      await this.patientOverview(patientId, correlationId),
    );
  }

  async ehrPatientRecord(patientId: string, correlationId: string) {
    const ehr = this.requireEhr();
    const meta = { correlationId };
    const [profile, documents] = await Promise.all([
      ehr.profile.getProfile(patientId, meta),
      ehr.mockEhr.listDocuments(patientId, meta),
    ]);
    return {
      schemaVersion: "1" as const,
      patientId,
      profile,
      documents,
      observedAt: this.now().toISOString(),
    };
  }

  async updateEhrProfile(
    patientId: string,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ) {
    return {
      patientId,
      profile: await this.requireEhr().profile.updateProfile(
        patientId,
        body,
        meta,
      ),
    };
  }

  createEhrDocument(
    patientId: string,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.requireEhr().mockEhr.createDocument(patientId, body, meta);
  }

  reviseEhrDocument(
    documentId: string,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.requireEhr().mockEhr.reviseDocument(documentId, body, meta);
  }

  fileEhrDocument(
    documentId: string,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.requireEhr().mockEhr.fileDocument(documentId, body, meta);
  }

  async ehrDocumentHistory(documentId: string, correlationId: string) {
    return {
      versions: await this.requireEhr().mockEhr.documentHistory(documentId, {
        correlationId,
      }),
    };
  }

  createReferralSnapshot(
    patientId: string,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.requireEhr().profile.createReferralSnapshot(
      patientId,
      body,
      meta,
    );
  }

  async listReferralSnapshots(patientId: string, correlationId: string) {
    return {
      referrals: await this.requireEhr().profile.listReferralSnapshots(
        patientId,
        { correlationId },
      ),
    };
  }

  getReferralSnapshot(referralId: string, correlationId: string) {
    return this.requireEhr().profile.getReferralSnapshot(referralId, {
      correlationId,
    });
  }

  async executeTaskCommand(
    taskId: string,
    command: TaskCommand,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown> {
    const referralSnapshotId =
      command === "approve" && typeof body.referralSnapshotId === "string"
        ? body.referralSnapshotId
        : null;
    const agenticBody = { ...body };
    delete agenticBody.referralSnapshotId;
    const result = await this.agentic.taskCommand(
      taskId,
      command,
      agenticBody,
      meta,
    );
    if (command !== "approve" || this.downstream === undefined) return result;

    const parsed = publishedTaskEnvelopeSchema.safeParse(result);
    if (!parsed.success || parsed.data.task.taskId !== taskId) {
      throw invalidPublishedTask();
    }
    const task = parsed.data.task;
    const kind = task.taskType.toLowerCase().includes("referral")
      ? ("referral" as const)
      : ("team-task" as const);
    if (referralSnapshotId !== null) {
      if (kind !== "referral") {
        throw new IntegrationError(
          "REFERRAL_SNAPSHOT_NOT_APPLICABLE",
          "A referral snapshot can only be attached to a referral task",
        );
      }
      const snapshot = referralSnapshotReferenceSchema.safeParse(
        await this.requireEhr().profile.getReferralSnapshot(
          referralSnapshotId,
          meta,
        ),
      );
      if (
        !snapshot.success ||
        snapshot.data.referralId !== referralSnapshotId ||
        snapshot.data.patientId !== task.patientId
      ) {
        throw new IntegrationError(
          "REFERRAL_SNAPSHOT_MISMATCH",
          "The referral snapshot does not belong to this patient",
          409,
        );
      }
    }
    const delivery = await this.downstream.createDelivery(
      {
        idempotencyKey: `delivery:${task.taskId}`,
        sourceTaskId: task.taskId,
        patientId: task.patientId,
        targetSystem: task.targetTeamId,
        kind,
        summary: task.summary,
        instructions: null,
        dueAt: task.dueBy,
        referralSnapshotId,
      },
      {
        correlationId: meta.correlationId,
        actorId: "system:integration-delivery",
      },
    );
    return { ...(result as Record<string, unknown>), delivery };
  }

  async listTaskDeliveries(taskId: string, correlationId: string) {
    return {
      deliveries: await this.requireDownstream().listTaskDeliveries(taskId, {
        correlationId,
      }),
    };
  }

  simulateDownstreamStatus(
    deliveryId: string,
    body: Record<string, unknown>,
    correlationId: string,
  ): Promise<unknown> {
    return this.requireDownstream().simulateStatus(deliveryId, body, {
      correlationId,
      actorId: "downstream:demo-provider",
    });
  }

  createDemoSession(
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.agentic.createDemoSession(body, meta);
  }

  getDemoSession(sessionId: string, correlationId: string): Promise<unknown> {
    return this.agentic.getDemoSession(sessionId, { correlationId });
  }

  joinDemoSession(
    joinCode: string,
    body: Record<string, unknown>,
    correlationId: string,
  ): Promise<unknown> {
    return this.agentic.joinDemoSession(joinCode, body, { correlationId });
  }

  assignDemoTask(
    sessionId: string,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.agentic.assignDemoTask(sessionId, body, meta);
  }

  demoParticipantView(
    participantToken: string,
    correlationId: string,
  ): Promise<unknown> {
    return this.agentic.demoParticipantView(participantToken, {
      correlationId,
    });
  }

  eventStream(
    lastEventId: string | undefined,
    correlationId: string,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    return this.agentic.eventStream(
      lastEventId,
      { correlationId },
      signal,
    );
  }

  pipelineRequest(
    path: PipelineProxyPath,
    body: unknown,
    correlationId: string,
  ): Promise<UpstreamJsonResult> {
    return this.pipeline.request(path, body, { correlationId });
  }

  async startWardMeeting(
    input: WardMeetingStart,
    meta: Required<Pick<RequestMeta, "actorId" | "correlationId">>,
  ): Promise<{ status: 200 | 201; body: unknown }> {
    const startMeeting = this.agentic.startWardMeeting;
    if (startMeeting === undefined) throw meetingNotConfigured();
    const ambientResult = await this.pipeline.request(
      "/api/corti/ambient/session",
      {
        encounterIdentifier:
          input.encounterIdentifier ??
          `ward-meeting:${createHash("sha256")
            .update(input.idempotencyKey)
            .digest("hex")
            .slice(0, 32)}`,
      },
      meta,
    );
    const ambientSession = parseUpstreamMeeting(
      ambientSessionSchema,
      ambientResult.body,
    );
    const result = parseUpstreamMeeting(
      meetingResultSchema,
      await startMeeting.call(
        this.agentic,
        {
          wardId: input.wardId,
          interactionId: ambientSession.interactionId,
          idempotencyKey: input.idempotencyKey,
        },
        meta,
      ),
    );
    if (
      result.meeting.wardId !== input.wardId ||
      result.meeting.startedBy !== meta.actorId ||
      (!result.replayed &&
        result.meeting.interactionId !== ambientSession.interactionId)
    ) {
      throw invalidUpstreamMeeting();
    }
    const replaySafeAmbientSession = result.replayed
      ? { ...ambientSession, interactionId: result.meeting.interactionId }
      : ambientSession;
    return {
      status: result.replayed ? 200 : 201,
      body: { ...result, ambientSession: replaySafeAmbientSession },
    };
  }

  async openMeetingSegment(
    meetingId: string,
    input: MeetingSegmentOpen,
    meta: Required<Pick<RequestMeta, "actorId" | "correlationId">>,
  ): Promise<{ status: 200 | 201; body: unknown }> {
    const open = this.agentic.openMeetingSegment;
    if (open === undefined) throw meetingNotConfigured();
    const result = parseUpstreamMeeting(
      patientMeetingResultSchema,
      await open.call(this.agentic, meetingId, input, meta),
    );
    if (
      result.meeting.meetingId !== meetingId ||
      result.segment.meetingId !== meetingId ||
      result.segment.patientId !== input.patientId ||
      result.segment.openedBy !== meta.actorId
    ) {
      throw invalidUpstreamMeeting();
    }
    return { status: result.replayed ? 200 : 201, body: result };
  }

  async appendMeetingTranscript(
    meetingId: string,
    input: MeetingTranscriptAppend,
    meta: Required<Pick<RequestMeta, "actorId" | "correlationId">>,
  ): Promise<{ status: 200 | 201; body: unknown }> {
    const append = this.agentic.appendMeetingTranscript;
    if (append === undefined) throw meetingNotConfigured();
    const result = parseUpstreamMeeting(
      meetingTranscriptResultSchema,
      await append.call(this.agentic, meetingId, input, meta),
    );
    if (
      result.evidence.some(
        (evidence) =>
          evidence.meetingId !== meetingId ||
          evidence.patientSegmentId !== input.patientSegmentId,
      )
    ) {
      throw invalidUpstreamMeeting();
    }
    return { status: result.replayed ? 200 : 201, body: result };
  }

  async closeAndReconcileMeetingSegment(
    meetingId: string,
    segmentId: string,
    input: MeetingSegmentClose,
    meta: Required<Pick<RequestMeta, "actorId" | "correlationId">>,
  ): Promise<{ status: 200 | 201; body: unknown }> {
    const close = this.agentic.closeMeetingSegment;
    const reconcile = this.agentic.reconcileMeetingSegment;
    if (close === undefined || reconcile === undefined) {
      throw meetingNotConfigured();
    }
    const closed = parseUpstreamMeeting(
      patientMeetingResultSchema,
      await close.call(this.agentic, meetingId, segmentId, input, meta),
    );
    if (
      closed.meeting.meetingId !== meetingId ||
      closed.segment.meetingId !== meetingId ||
      closed.segment.segmentId !== segmentId ||
      closed.segment.status !== "closed"
    ) {
      throw invalidUpstreamMeeting();
    }
    const reconciliationKey = `meeting-close:${createHash("sha256")
      .update(meetingId)
      .update("\0")
      .update(segmentId)
      .update("\0")
      .update(input.idempotencyKey)
      .digest("hex")
      .slice(0, 32)}`;
    const reconciled = parseUpstreamMeeting(
      meetingReconciliationResultSchema,
      await reconcile.call(
        this.agentic,
        meetingId,
        segmentId,
        {
          expectedSegmentVersion: closed.segment.version,
          idempotencyKey: reconciliationKey,
        },
        meta,
      ),
    );
    if (
      reconciled.reconciliation.meetingId !== meetingId ||
      reconciled.reconciliation.patientSegmentId !== segmentId ||
      reconciled.reconciliation.status !== "saved"
    ) {
      throw invalidUpstreamMeeting();
    }
    return {
      status: closed.replayed && reconciled.replayed ? 200 : 201,
      body: {
        ...closed,
        reconciliation: reconciled.reconciliation,
        newDraftTasks: reconciled.newDraftTasks,
        carryForwards: reconciled.carryForwards,
      },
    };
  }

  async completeWardMeeting(
    meetingId: string,
    input: WardMeetingComplete,
    meta: Required<Pick<RequestMeta, "actorId" | "correlationId">>,
  ): Promise<unknown> {
    const complete = this.agentic.completeWardMeeting;
    if (complete === undefined) throw meetingNotConfigured();
    const result = parseUpstreamMeeting(
      meetingResultSchema,
      await complete.call(this.agentic, meetingId, input, meta),
    );
    if (
      result.meeting.meetingId !== meetingId ||
      result.meeting.status !== "completed"
    ) {
      throw invalidUpstreamMeeting();
    }
    return result;
  }

  async getWardMeeting(
    meetingId: string,
    meta: Required<Pick<RequestMeta, "actorId" | "correlationId">>,
  ): Promise<unknown> {
    const get = this.agentic.getWardMeeting;
    if (get === undefined) throw meetingNotConfigured();
    const result = parseUpstreamMeeting(
      meetingReadSchema,
      await get.call(this.agentic, meetingId, meta),
    );
    if (result.meeting.meetingId !== meetingId) {
      throw invalidUpstreamMeeting();
    }
    return result;
  }

  async requestHandover(
    patientId: string,
    input: HandoverRequest,
    meta: Required<Pick<RequestMeta, "actorId" | "correlationId">>,
  ): Promise<{ status: 200 | 201; body: unknown }> {
    const createDraft = this.agentic.createHandoverDraft;
    const finalize = this.agentic.finalizeHandover;
    const render = this.pipeline.renderHandover;
    if (createDraft === undefined || finalize === undefined || render === undefined) {
      throw new IntegrationError(
        "HANDOVER_NOT_CONFIGURED",
        "Patient handovers are not configured",
        503,
        true,
      );
    }
    const draftEnvelope = parseHandoverEnvelope(
      await createDraft.call(this.agentic, patientId, input, meta),
    );
    if (
      draftEnvelope.handover.patientId !== patientId ||
      draftEnvelope.handover.reason !== input.reason ||
      draftEnvelope.handover.requestedBy !== meta.actorId
    ) {
      throw invalidUpstreamHandover();
    }
    if (draftEnvelope.lifecycleStatus === "rendered") {
      return { status: 200, body: draftEnvelope.handover };
    }

    const draft = draftEnvelope.handover;
    const rendered = parseRenderedHandover(
      await render.call(
        this.pipeline,
        {
          handoverId: draft.handoverId,
          patientId: draft.patientId,
          sourceSnapshotHash: draft.sourceSnapshotHash,
          packet: draft.packet,
        },
        meta,
      ),
      draft.packet,
    );
    const finalEnvelope = parseHandoverEnvelope(
      await finalize.call(
        this.agentic,
        draft.handoverId,
        {
          expectedVersion: draft.version,
          sourceSnapshotHash: draft.sourceSnapshotHash,
          rendered,
        },
        meta,
      ),
    );
    if (
      finalEnvelope.lifecycleStatus !== "rendered" ||
      finalEnvelope.handover.handoverId !== draft.handoverId ||
      finalEnvelope.handover.patientId !== draft.patientId ||
      finalEnvelope.handover.reason !== draft.reason ||
      finalEnvelope.handover.requestedBy !== draft.requestedBy ||
      finalEnvelope.handover.sourceSnapshotHash !== draft.sourceSnapshotHash ||
      finalEnvelope.handover.version !== draft.version + 1 ||
      !sameJson(finalEnvelope.handover.packet, draft.packet) ||
      !sameJson(finalEnvelope.handover.rendered, rendered)
    ) {
      throw invalidUpstreamHandover();
    }
    return {
      status: draftEnvelope.replayed || finalEnvelope.replayed ? 200 : 201,
      body: finalEnvelope.handover,
    };
  }

  private requireEhr(): EhrDependencies {
    if (this.ehr === undefined) {
      throw new IntegrationError(
        "EHR_NOT_CONFIGURED",
        "The synthetic EHR services are not configured",
        503,
        true,
      );
    }
    return this.ehr;
  }

  private requireDownstream(): DownstreamGateway {
    if (this.downstream === undefined) {
      throw new IntegrationError(
        "DOWNSTREAM_NOT_CONFIGURED",
        "Downstream task delivery is not configured",
        503,
        true,
      );
    }
    return this.downstream;
  }
}

function parseHandoverEnvelope(value: unknown): HandoverEnvelope {
  const result = handoverEnvelopeSchema.safeParse(value);
  if (!result.success) {
    throw invalidUpstreamHandover();
  }
  return result.data;
}

function parseRenderedHandover(
  value: unknown,
  packet: z.infer<typeof handoverPacketSchema>,
): z.infer<typeof renderedHandoverSchema> {
  const result = renderedHandoverSchema.safeParse(value);
  if (!result.success) {
    throw invalidRenderedHandover();
  }
  const allowedSourceRefs = new Set([
    ...packet.situation,
    ...packet.background,
    ...packet.currentConcerns,
    ...packet.outstandingTasks,
    ...packet.awaitingVerification,
    ...packet.escalations,
  ].flatMap((item) => item.sourceRefs));
  for (const section of result.data.sections) {
    for (const statement of section.statements) {
      if (statement.sourceRefs.some((sourceRef) => !allowedSourceRefs.has(sourceRef))) {
        throw invalidRenderedHandover();
      }
    }
  }
  return result.data;
}

function sameJson(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}

function invalidUpstreamHandover(): IntegrationError {
  return new IntegrationError(
    "UPSTREAM_INVALID_RESPONSE",
    "An upstream service returned an invalid response",
    502,
    true,
  );
}

function meetingNotConfigured(): IntegrationError {
  return new IntegrationError(
    "WARD_MEETING_NOT_CONFIGURED",
    "Ward meeting reconciliation is not configured",
    503,
    true,
  );
}

function invalidUpstreamMeeting(): IntegrationError {
  return new IntegrationError(
    "UPSTREAM_INVALID_RESPONSE",
    "A ward meeting service returned an invalid response",
    502,
    true,
  );
}

function parseUpstreamMeeting<T>(
  schema: z.ZodType<T>,
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success) throw invalidUpstreamMeeting();
  return result.data;
}

function invalidRenderedHandover(): IntegrationError {
  return new IntegrationError(
    "HANDOVER_RENDER_FAILED",
    "The handover renderer returned an invalid response",
    502,
    true,
  );
}

function invalidPublishedTask(): IntegrationError {
  return new IntegrationError(
    "UPSTREAM_INVALID_RESPONSE",
    "Agentic task publication did not return an authoritative task",
    502,
    true,
  );
}

async function safeStatus(operation: () => Promise<unknown>): Promise<ServiceStatus> {
  try {
    return { reachable: true, detail: await operation() };
  } catch {
    return { reachable: false, error: "Service unavailable" };
  }
}
