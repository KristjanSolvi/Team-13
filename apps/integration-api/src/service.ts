import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import type {
  FollowThroughCandidate,
  HandoverRequest,
  PipelineProxyPath,
  TaskCommand,
} from "./contracts.js";
import { IntegrationError } from "./errors.js";
import type {
  AgenticGateway,
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

export class IntegrationService {
  constructor(
    private readonly agentic: AgenticGateway,
    private readonly pipeline: PipelineGateway,
    private readonly now: () => Date = () => new Date(),
    private readonly ehr?: EhrDependencies,
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
    if (this.ehr === undefined) return base;

    const [profile, mockEhr] = await Promise.all([
      safeStatus(() => this.ehr?.profile.health() as Promise<unknown>),
      safeStatus(() => this.ehr?.mockEhr.health() as Promise<unknown>),
    ]);
    return {
      ...base,
      status:
        ready && profile.reachable && mockEhr.reachable
          ? ("ready" as const)
          : ("degraded" as const),
      services: { agentic, pipeline, profile, mockEhr },
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

  executeTaskCommand(
    taskId: string,
    command: TaskCommand,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.agentic.taskCommand(taskId, command, body, meta);
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

function invalidRenderedHandover(): IntegrationError {
  return new IntegrationError(
    "HANDOVER_RENDER_FAILED",
    "The handover renderer returned an invalid response",
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
