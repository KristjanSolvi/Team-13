import { createHash } from "node:crypto";

import type {
  FollowThroughCandidate,
  PipelineProxyPath,
  TaskCommand,
} from "./contracts.js";
import { IntegrationError } from "./errors.js";
import type {
  AgenticGateway,
  PipelineGateway,
  RequestMeta,
  UpstreamJsonResult,
} from "./gateways.js";

interface ServiceStatus {
  reachable: boolean;
  detail?: unknown;
  error?: string;
}

export class IntegrationService {
  constructor(
    private readonly agentic: AgenticGateway,
    private readonly pipeline: PipelineGateway,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async readiness(): Promise<{
    status: "ready" | "degraded";
    liveCortiReady: boolean;
    services: { agentic: ServiceStatus; pipeline: ServiceStatus };
  }> {
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
    return {
      status: ready ? "ready" : "degraded",
      liveCortiReady,
      services: { agentic, pipeline },
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
    const handoff = await this.agentic.submitSignal(
      {
        patientId: candidate.patientId,
        interactionId: candidate.interactionId,
        signalText: candidate.summary,
        evidenceRefs: candidate.evidence.map(
          (_evidence, index) => `encounter:candidate-${stableId}.${index + 1}`,
        ),
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
}

async function safeStatus(operation: () => Promise<unknown>): Promise<ServiceStatus> {
  try {
    return { reachable: true, detail: await operation() };
  } catch {
    return { reachable: false, error: "Service unavailable" };
  }
}
