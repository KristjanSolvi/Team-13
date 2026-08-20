import { createHash } from "node:crypto";

import type {
  FollowThroughCandidate,
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

async function safeStatus(operation: () => Promise<unknown>): Promise<ServiceStatus> {
  try {
    return { reachable: true, detail: await operation() };
  } catch {
    return { reachable: false, error: "Service unavailable" };
  }
}
