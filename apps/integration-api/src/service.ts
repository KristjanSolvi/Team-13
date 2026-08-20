import { createHash } from "node:crypto";

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
const groundedStatementSchema = z
  .object({
    statement: z.string().trim().min(1).max(1_000),
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
    unknowns: z.array(z.string().trim().min(1).max(500)).max(20),
  })
  .strict();
const renderedStatementSchema = z
  .object({
    statement: z.string().trim().min(1).max(1_000),
    sourceRefs: z.array(z.string().min(1).max(240)).max(20),
  })
  .strict();
const renderedHandoverSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    sections: z
      .array(
        z
          .object({
            sectionId: z.string().trim().min(1).max(80),
            heading: z.string().trim().min(1).max(160),
            statements: z.array(renderedStatementSchema).max(50),
          })
          .strict(),
      )
      .max(10),
    creditsConsumed: z.number().nonnegative(),
  })
  .strict();
const publicHandoverSchema = z
  .object({
    handoverId: z.string().uuid(),
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
    activity: z.array(z.record(z.string(), z.unknown())),
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
      (value.handover.rendered !== null) !== isRendered
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
    if (draftEnvelope.handover.patientId !== patientId) {
      throw invalidUpstreamHandover();
    }
    if (draftEnvelope.lifecycleStatus === "rendered") {
      return { status: 200, body: draftEnvelope.handover };
    }

    const draft = draftEnvelope.handover;
    const rendered = await render.call(
      this.pipeline,
      {
        handoverId: draft.handoverId,
        patientId: draft.patientId,
        sourceSnapshotHash: draft.sourceSnapshotHash,
        packet: draft.packet,
      },
      meta,
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
      finalEnvelope.handover.sourceSnapshotHash !== draft.sourceSnapshotHash
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

function invalidUpstreamHandover(): IntegrationError {
  return new IntegrationError(
    "UPSTREAM_INVALID_RESPONSE",
    "An upstream service returned an invalid response",
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
