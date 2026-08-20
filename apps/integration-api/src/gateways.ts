import { IntegrationError } from "./errors.js";
import type {
  HandoverRequest,
  MeetingSegmentClose,
  MeetingSegmentOpen,
  MeetingTranscriptAppend,
  PipelineProxyPath,
  TaskCommand,
  WardMeetingComplete,
} from "./contracts.js";

export interface RequestMeta {
  correlationId: string;
  actorId?: string;
}

export interface AgenticSignalInput {
  patientId: string;
  interactionId: string;
  signalText: string;
  evidenceRefs: string[];
  sourceEvidence?: AgenticSourceEvidence[];
  idempotencyKey: string;
}

export interface AgenticSourceEvidence {
  evidenceRef: string;
  sourceQuote: string;
  startSeconds?: number;
  endSeconds?: number;
  speakerId?: number;
}

export interface AgenticSourceRevisionInput {
  sourceItemId: string;
  expectedSourceRef: string;
  newText: string;
  reason:
    | "new_result"
    | "medication_update"
    | "clinical_note_revision"
    | "other";
  idempotencyKey: string;
}

export interface AgenticGateway {
  health(): Promise<unknown>;
  submitSignal(input: AgenticSignalInput, meta: RequestMeta): Promise<unknown>;
  listThreads(patientId: string, meta: RequestMeta): Promise<unknown[]>;
  listTasks(patientId: string, meta: RequestMeta): Promise<unknown[]>;
  listChangeImpacts?(
    patientId: string,
    meta: RequestMeta,
  ): Promise<unknown[]>;
  recordSourceRevision?(
    patientId: string,
    input: AgenticSourceRevisionInput,
    meta: RequestMeta,
  ): Promise<unknown>;
  taskCommand(
    taskId: string,
    command: TaskCommand,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown>;
  verifyExternal(
    taskId: string,
    body: {
      expectedVersion: number;
      outcomeRef: string;
      deliveryId: string;
      idempotencyKey: string;
    },
    meta: RequestMeta,
  ): Promise<unknown>;
  createDemoSession(
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown>;
  getDemoSession(sessionId: string, meta: RequestMeta): Promise<unknown>;
  joinDemoSession(
    joinCode: string,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown>;
  assignDemoTask(
    sessionId: string,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown>;
  demoParticipantView(
    participantToken: string,
    meta: RequestMeta,
  ): Promise<unknown>;
  createHandoverDraft?(
    patientId: string,
    input: HandoverRequest,
    meta: RequestMeta,
  ): Promise<unknown>;
  finalizeHandover?(
    handoverId: string,
    input: {
      expectedVersion: number;
      sourceSnapshotHash: string;
      rendered: unknown;
    },
    meta: RequestMeta,
  ): Promise<unknown>;
  startWardMeeting?(
    input: {
      wardId: string;
      interactionId: string;
      idempotencyKey: string;
    },
    meta: RequestMeta,
  ): Promise<unknown>;
  openMeetingSegment?(
    meetingId: string,
    input: MeetingSegmentOpen,
    meta: RequestMeta,
  ): Promise<unknown>;
  appendMeetingTranscript?(
    meetingId: string,
    input: MeetingTranscriptAppend,
    meta: RequestMeta,
  ): Promise<unknown>;
  closeMeetingSegment?(
    meetingId: string,
    segmentId: string,
    input: MeetingSegmentClose,
    meta: RequestMeta,
  ): Promise<unknown>;
  reconcileMeetingSegment?(
    meetingId: string,
    segmentId: string,
    input: { expectedSegmentVersion: number; idempotencyKey: string },
    meta: RequestMeta,
  ): Promise<unknown>;
  completeWardMeeting?(
    meetingId: string,
    input: WardMeetingComplete,
    meta: RequestMeta,
  ): Promise<unknown>;
  getWardMeeting?(meetingId: string, meta: RequestMeta): Promise<unknown>;
  eventStream(
    lastEventId: string | undefined,
    meta: RequestMeta,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>>;
}

export interface PipelineHealth {
  status: string;
  cortiConfigured: boolean;
  missingCortiVariables: string[];
}

export interface UpstreamJsonResult {
  status: number;
  body: unknown;
}

export interface PipelineGateway {
  health(): Promise<PipelineHealth>;
  request(
    path: PipelineProxyPath,
    body: unknown,
    meta: RequestMeta,
  ): Promise<UpstreamJsonResult>;
  renderHandover?(input: unknown, meta: RequestMeta): Promise<unknown>;
}

export interface ProfileGateway {
  health(): Promise<unknown>;
  getProfile(patientId: string, meta: RequestMeta): Promise<unknown>;
  updateProfile(
    patientId: string,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown>;
  createReferralSnapshot(
    patientId: string,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown>;
  listReferralSnapshots(
    patientId: string,
    meta: RequestMeta,
  ): Promise<unknown[]>;
  getReferralSnapshot(
    referralId: string,
    meta: RequestMeta,
  ): Promise<unknown>;
}

export interface DownstreamGateway {
  health(): Promise<unknown>;
  createDelivery(
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown>;
  listTaskDeliveries(taskId: string, meta: RequestMeta): Promise<unknown[]>;
  listPendingReadbacks(meta: RequestMeta): Promise<unknown[]>;
  readback(deliveryId: string, meta: RequestMeta): Promise<unknown>;
  acknowledgeReadback(
    deliveryId: string,
    body: { outcomeReference: string },
    meta: RequestMeta,
  ): Promise<unknown>;
  simulateStatus(
    deliveryId: string,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown>;
}

export interface MockEhrGateway {
  health(): Promise<unknown>;
  listDocuments(patientId: string, meta: RequestMeta): Promise<unknown[]>;
  createDocument(
    patientId: string,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown>;
  reviseDocument(
    documentId: string,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown>;
  fileDocument(
    documentId: string,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown>;
  documentHistory(documentId: string, meta: RequestMeta): Promise<unknown[]>;
}

interface FetchJsonOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  bearerToken?: string;
  meta?: RequestMeta;
  authenticate?: boolean;
  timeoutMs?: number;
}

export class JsonHttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request(path: string, options: FetchJsonOptions = {}): Promise<unknown> {
    return (await this.requestWithStatus(path, options)).body;
  }

  async requestWithStatus(
    path: string,
    options: FetchJsonOptions = {},
  ): Promise<UpstreamJsonResult> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? this.timeoutMs,
    );
    const headers = new Headers({ accept: "application/json" });
    if (options.body !== undefined) {
      headers.set("content-type", "application/json");
    }
    if (options.authenticate !== false && options.bearerToken) {
      headers.set("authorization", `Bearer ${options.bearerToken}`);
    }
    if (options.meta?.correlationId) {
      headers.set("x-correlation-id", options.meta.correlationId);
    }
    if (options.meta?.actorId) {
      headers.set("x-actor-id", options.meta.actorId);
    }

    try {
      const response = await this.fetchImpl(new URL(path, this.baseUrl), {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      const text = await response.text();
      let payload: unknown = null;
      if (text.length > 0) {
        try {
          payload = JSON.parse(text) as unknown;
        } catch {
          throw new IntegrationError(
            "UPSTREAM_INVALID_RESPONSE",
            "An upstream service returned an invalid response",
            502,
            true,
          );
        }
      }
      if (!response.ok) {
        const upstreamError = errorPayload(payload);
        throw new IntegrationError(
          upstreamError.code,
          upstreamError.message,
          response.status,
          upstreamError.retryable ?? response.status >= 500,
        );
      }
      return { status: response.status, body: payload };
    } catch (error) {
      if (error instanceof IntegrationError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new IntegrationError(
          "UPSTREAM_TIMEOUT",
          "An upstream service timed out",
          504,
          true,
        );
      }
      throw new IntegrationError(
        "UPSTREAM_UNAVAILABLE",
        "An upstream service is unavailable",
        502,
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function errorPayload(payload: unknown): {
  code: string;
  message: string;
  retryable?: boolean;
} {
  if (typeof payload !== "object" || payload === null || !("error" in payload)) {
    return {
      code: "UPSTREAM_REQUEST_FAILED",
      message: "An upstream request failed",
    };
  }
  const value = (payload as { error?: unknown }).error;
  if (typeof value !== "object" || value === null) {
    return {
      code: "UPSTREAM_REQUEST_FAILED",
      message: "An upstream request failed",
    };
  }
  const error = value as Record<string, unknown>;
  return {
    code:
      typeof error.code === "string" ? error.code : "UPSTREAM_REQUEST_FAILED",
    message:
      typeof error.message === "string"
        ? error.message
        : "An upstream request failed",
    ...(typeof error.retryable === "boolean"
      ? { retryable: error.retryable }
      : {}),
  };
}

export class HttpAgenticGateway implements AgenticGateway {
  private readonly client: JsonHttpClient;

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly bearerToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly handoverTimeoutMs: number = timeoutMs,
  ) {
    this.client = new JsonHttpClient(baseUrl, timeoutMs, fetchImpl);
  }

  health(): Promise<unknown> {
    return this.client.request("/healthz", { authenticate: false });
  }

  submitSignal(input: AgenticSignalInput, meta: RequestMeta): Promise<unknown> {
    return this.client.request("/api/signals", {
      method: "POST",
      body: input,
      bearerToken: this.bearerToken,
      meta,
    });
  }

  async listThreads(patientId: string, meta: RequestMeta): Promise<unknown[]> {
    const payload = await this.client.request(
      `/api/patients/${encodeURIComponent(patientId)}/threads`,
      { bearerToken: this.bearerToken, meta },
    );
    return requiredArray(payload, "threads");
  }

  async listTasks(patientId: string, meta: RequestMeta): Promise<unknown[]> {
    const payload = await this.client.request(
      `/api/patients/${encodeURIComponent(patientId)}/tasks`,
      { bearerToken: this.bearerToken, meta },
    );
    return requiredArray(payload, "tasks");
  }

  async listChangeImpacts(
    patientId: string,
    meta: RequestMeta,
  ): Promise<unknown[]> {
    const payload = await this.client.request(
      `/api/patients/${encodeURIComponent(patientId)}/change-impacts`,
      { bearerToken: this.bearerToken, meta },
    );
    return requiredArray(payload, "impacts");
  }

  recordSourceRevision(
    patientId: string,
    input: AgenticSourceRevisionInput,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.client.request(
      `/api/patients/${encodeURIComponent(patientId)}/source-revisions`,
      {
        method: "POST",
        body: input,
        bearerToken: this.bearerToken,
        meta,
      },
    );
  }

  taskCommand(
    taskId: string,
    command: TaskCommand,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.client.request(
      `/api/tasks/${encodeURIComponent(taskId)}/${command}`,
      {
        method: "POST",
        body,
        bearerToken: this.bearerToken,
        meta,
        ...(command === "approve"
          ? { timeoutMs: this.handoverTimeoutMs }
          : {}),
      },
    );
  }

  verifyExternal(
    taskId: string,
    body: {
      expectedVersion: number;
      outcomeRef: string;
      deliveryId: string;
      idempotencyKey: string;
    },
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.client.request(
      `/api/tasks/${encodeURIComponent(taskId)}/verify-external`,
      {
        method: "POST",
        body,
        bearerToken: this.bearerToken,
        meta,
      },
    );
  }

  createDemoSession(
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.client.request("/api/demo/sessions", {
      method: "POST",
      body,
      bearerToken: this.bearerToken,
      meta,
    });
  }

  getDemoSession(sessionId: string, meta: RequestMeta): Promise<unknown> {
    return this.client.request(
      `/api/demo/sessions/${encodeURIComponent(sessionId)}`,
      { bearerToken: this.bearerToken, meta },
    );
  }

  joinDemoSession(
    joinCode: string,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.client.request(`/api/demo/join/${encodeURIComponent(joinCode)}`, {
      method: "POST",
      body,
      bearerToken: this.bearerToken,
      meta,
    });
  }

  assignDemoTask(
    sessionId: string,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.client.request(
      `/api/demo/sessions/${encodeURIComponent(sessionId)}/assign`,
      {
        method: "POST",
        body,
        bearerToken: this.bearerToken,
        meta,
      },
    );
  }

  demoParticipantView(
    participantToken: string,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.client.request("/api/demo/participants/lookup", {
      method: "POST",
      body: { participantToken },
      bearerToken: this.bearerToken,
      meta,
    });
  }

  createHandoverDraft(
    patientId: string,
    input: HandoverRequest,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.client.request(
      `/api/patients/${encodeURIComponent(patientId)}/handover-drafts`,
      {
        method: "POST",
        body: input,
        bearerToken: this.bearerToken,
        meta,
        timeoutMs: this.handoverTimeoutMs,
      },
    );
  }

  finalizeHandover(
    handoverId: string,
    input: {
      expectedVersion: number;
      sourceSnapshotHash: string;
      rendered: unknown;
    },
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.client.request(
      `/api/handovers/${encodeURIComponent(handoverId)}/finalize`,
      {
        method: "POST",
        body: input,
        bearerToken: this.bearerToken,
        meta,
      },
    );
  }

  startWardMeeting(
    input: { wardId: string; interactionId: string; idempotencyKey: string },
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.client.request("/api/ward-meetings", {
      method: "POST",
      body: input,
      bearerToken: this.bearerToken,
      meta,
    });
  }

  openMeetingSegment(
    meetingId: string,
    input: MeetingSegmentOpen,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.meetingRequest(meetingId, "/segments", input, meta);
  }

  appendMeetingTranscript(
    meetingId: string,
    input: MeetingTranscriptAppend,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.meetingRequest(meetingId, "/transcript-segments", input, meta);
  }

  closeMeetingSegment(
    meetingId: string,
    segmentId: string,
    input: MeetingSegmentClose,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.meetingRequest(
      meetingId,
      `/segments/${encodeURIComponent(segmentId)}/close`,
      input,
      meta,
    );
  }

  reconcileMeetingSegment(
    meetingId: string,
    segmentId: string,
    input: { expectedSegmentVersion: number; idempotencyKey: string },
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.meetingRequest(
      meetingId,
      `/segments/${encodeURIComponent(segmentId)}/reconcile`,
      input,
      meta,
      this.handoverTimeoutMs,
    );
  }

  completeWardMeeting(
    meetingId: string,
    input: WardMeetingComplete,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.meetingRequest(meetingId, "/complete", input, meta);
  }

  getWardMeeting(meetingId: string, meta: RequestMeta): Promise<unknown> {
    return this.client.request(
      `/api/ward-meetings/${encodeURIComponent(meetingId)}`,
      { bearerToken: this.bearerToken, meta },
    );
  }

  private meetingRequest(
    meetingId: string,
    suffix: string,
    body: unknown,
    meta: RequestMeta,
    timeoutMs?: number,
  ): Promise<unknown> {
    return this.client.request(
      `/api/ward-meetings/${encodeURIComponent(meetingId)}${suffix}`,
      {
        method: "POST",
        body,
        bearerToken: this.bearerToken,
        meta,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      },
    );
  }

  async eventStream(
    lastEventId: string | undefined,
    meta: RequestMeta,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, this.timeoutMs);
    const headers = new Headers({
      accept: "text/event-stream",
      authorization: `Bearer ${this.bearerToken}`,
      "x-correlation-id": meta.correlationId,
    });
    if (lastEventId !== undefined) {
      headers.set("last-event-id", lastEventId);
    }

    try {
      const response = await this.fetchImpl(new URL("/api/events/stream", this.baseUrl), {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        const payload = await response.text();
        let parsed: unknown = null;
        try {
          parsed = payload.length === 0 ? null : (JSON.parse(payload) as unknown);
        } catch {
          throw invalidUpstreamShape();
        }
        const upstreamError = errorPayload(parsed);
        throw new IntegrationError(
          upstreamError.code,
          upstreamError.message,
          response.status,
          upstreamError.retryable ?? response.status >= 500,
        );
      }
      if (response.body === null) {
        throw invalidUpstreamShape();
      }
      return response.body;
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof IntegrationError) {
        throw error;
      }
      if (controller.signal.aborted && !signal.aborted) {
        throw new IntegrationError(
          "UPSTREAM_TIMEOUT",
          "The upstream event stream timed out while connecting",
          504,
          true,
        );
      }
      throw new IntegrationError(
        "UPSTREAM_UNAVAILABLE",
        "The upstream event stream is unavailable",
        502,
        true,
      );
    }
  }
}

export class HttpPipelineGateway implements PipelineGateway {
  private readonly client: JsonHttpClient;

  constructor(
    baseUrl: string,
    timeoutMs: number,
    fetchImpl: typeof fetch = fetch,
    private readonly handoverTimeoutMs: number = timeoutMs,
  ) {
    this.client = new JsonHttpClient(baseUrl, timeoutMs, fetchImpl);
  }

  async health(): Promise<PipelineHealth> {
    const payload = await this.client.request("/health", {
      authenticate: false,
    });
    if (typeof payload !== "object" || payload === null) {
      throw invalidUpstreamShape();
    }
    const value = payload as Record<string, unknown>;
    if (
      typeof value.status !== "string" ||
      typeof value.cortiConfigured !== "boolean" ||
      !Array.isArray(value.missingCortiVariables) ||
      !value.missingCortiVariables.every((item) => typeof item === "string")
    ) {
      throw invalidUpstreamShape();
    }
    return {
      status: value.status,
      cortiConfigured: value.cortiConfigured,
      missingCortiVariables: value.missingCortiVariables as string[],
    };
  }

  request(
    path: PipelineProxyPath,
    body: unknown,
    meta: RequestMeta,
  ): Promise<UpstreamJsonResult> {
    return this.client.requestWithStatus(path, {
      method: "POST",
      body,
      meta,
      authenticate: false,
    });
  }

  async renderHandover(input: unknown, meta: RequestMeta): Promise<unknown> {
    try {
      return await this.client.request("/api/corti/handovers/render", {
        method: "POST",
        body: input,
        meta,
        authenticate: false,
        timeoutMs: this.handoverTimeoutMs,
      });
    } catch (error) {
      if (error instanceof IntegrationError && error.status === 422) {
        throw new IntegrationError(
          "HANDOVER_RENDER_FAILED",
          "The handover renderer rejected its output",
          502,
          true,
        );
      }
      throw error;
    }
  }
}

export class HttpProfileGateway implements ProfileGateway {
  private readonly client: JsonHttpClient;

  constructor(
    baseUrl: string,
    timeoutMs: number,
    private readonly bearerToken: string,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.client = new JsonHttpClient(baseUrl, timeoutMs, fetchImpl);
  }

  health(): Promise<unknown> {
    return this.client.request("/healthz", { authenticate: false });
  }

  async getProfile(patientId: string, meta: RequestMeta): Promise<unknown> {
    return requiredObject(await this.client.request(
      `/api/patients/${encodeURIComponent(patientId)}/profile`,
      { bearerToken: this.bearerToken, meta },
    ));
  }

  updateProfile(
    patientId: string,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.client.request(
      `/api/patients/${encodeURIComponent(patientId)}/profile`,
      {
        method: "PATCH",
        body,
        bearerToken: this.bearerToken,
        meta,
      },
    );
  }

  createReferralSnapshot(
    patientId: string,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.client.request(
      `/api/patients/${encodeURIComponent(patientId)}/referral-snapshots`,
      {
        method: "POST",
        body,
        bearerToken: this.bearerToken,
        meta,
      },
    );
  }

  async listReferralSnapshots(
    patientId: string,
    meta: RequestMeta,
  ): Promise<unknown[]> {
    const payload = await this.client.request(
      `/api/patients/${encodeURIComponent(patientId)}/referral-snapshots`,
      { bearerToken: this.bearerToken, meta },
    );
    return requiredArray(payload, "referrals");
  }

  async getReferralSnapshot(
    referralId: string,
    meta: RequestMeta,
  ): Promise<unknown> {
    return requiredObject(
      await this.client.request(
        `/api/referral-snapshots/${encodeURIComponent(referralId)}`,
        { bearerToken: this.bearerToken, meta },
      ),
    );
  }
}

export class HttpDownstreamGateway implements DownstreamGateway {
  private readonly client: JsonHttpClient;

  constructor(
    baseUrl: string,
    timeoutMs: number,
    private readonly bearerToken: string,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.client = new JsonHttpClient(baseUrl, timeoutMs, fetchImpl);
  }

  health(): Promise<unknown> {
    return this.client.request("/healthz", { authenticate: false });
  }

  createDelivery(
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.request("/api/deliveries", body, meta);
  }

  async listTaskDeliveries(
    taskId: string,
    meta: RequestMeta,
  ): Promise<unknown[]> {
    const payload = await this.client.request(
      `/api/tasks/${encodeURIComponent(taskId)}/deliveries`,
      { bearerToken: this.bearerToken, meta },
    );
    return requiredArray(payload, "deliveries");
  }

  async listPendingReadbacks(meta: RequestMeta): Promise<unknown[]> {
    const payload = await this.client.request("/api/pending-readbacks", {
      bearerToken: this.bearerToken,
      meta,
    });
    return requiredArray(payload, "deliveries");
  }

  readback(deliveryId: string, meta: RequestMeta): Promise<unknown> {
    return this.request(
      `/api/deliveries/${encodeURIComponent(deliveryId)}/readback`,
      {},
      meta,
    );
  }

  acknowledgeReadback(
    deliveryId: string,
    body: { outcomeReference: string },
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.request(
      `/api/deliveries/${encodeURIComponent(deliveryId)}/acknowledge`,
      body,
      meta,
    );
  }

  simulateStatus(
    deliveryId: string,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.request(
      `/api/simulation/deliveries/${encodeURIComponent(deliveryId)}/status`,
      body,
      meta,
    );
  }

  private request(
    path: string,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.client.request(path, {
      method: "POST",
      body,
      bearerToken: this.bearerToken,
      meta,
    });
  }
}

export class HttpMockEhrGateway implements MockEhrGateway {
  private readonly client: JsonHttpClient;

  constructor(
    baseUrl: string,
    timeoutMs: number,
    private readonly bearerToken: string,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.client = new JsonHttpClient(baseUrl, timeoutMs, fetchImpl);
  }

  health(): Promise<unknown> {
    return this.client.request("/healthz", { authenticate: false });
  }

  async listDocuments(patientId: string, meta: RequestMeta): Promise<unknown[]> {
    const payload = await this.client.request(
      `/api/patients/${encodeURIComponent(patientId)}/documents`,
      { bearerToken: this.bearerToken, meta },
    );
    return requiredArray(payload, "documents");
  }

  createDocument(
    patientId: string,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.client.request(
      `/api/patients/${encodeURIComponent(patientId)}/documents`,
      {
        method: "POST",
        body,
        bearerToken: this.bearerToken,
        meta,
      },
    );
  }

  reviseDocument(
    documentId: string,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.client.request(`/api/documents/${encodeURIComponent(documentId)}`, {
      method: "PATCH",
      body,
      bearerToken: this.bearerToken,
      meta,
    });
  }

  fileDocument(
    documentId: string,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown> {
    return this.client.request(
      `/api/documents/${encodeURIComponent(documentId)}/file`,
      {
        method: "POST",
        body,
        bearerToken: this.bearerToken,
        meta,
      },
    );
  }

  async documentHistory(documentId: string, meta: RequestMeta): Promise<unknown[]> {
    const payload = await this.client.request(
      `/api/documents/${encodeURIComponent(documentId)}/history`,
      { bearerToken: this.bearerToken, meta },
    );
    return requiredArray(payload, "versions");
  }
}

function requiredArray(payload: unknown, key: string): unknown[] {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !Array.isArray((payload as Record<string, unknown>)[key])
  ) {
    throw invalidUpstreamShape();
  }
  return (payload as Record<string, unknown>)[key] as unknown[];
}

function requiredObject(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw invalidUpstreamShape();
  }
  return payload as Record<string, unknown>;
}

function invalidUpstreamShape(): IntegrationError {
  return new IntegrationError(
    "UPSTREAM_INVALID_RESPONSE",
    "An upstream service returned an invalid response",
    502,
    true,
  );
}
