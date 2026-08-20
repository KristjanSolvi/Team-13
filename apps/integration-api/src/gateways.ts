import { IntegrationError } from "./errors.js";
import type { PipelineProxyPath, TaskCommand } from "./contracts.js";

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

export interface AgenticGateway {
  health(): Promise<unknown>;
  submitSignal(input: AgenticSignalInput, meta: RequestMeta): Promise<unknown>;
  listThreads(patientId: string, meta: RequestMeta): Promise<unknown[]>;
  listTasks(patientId: string, meta: RequestMeta): Promise<unknown[]>;
  taskCommand(
    taskId: string,
    command: TaskCommand,
    body: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<unknown>;
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
}

interface FetchJsonOptions {
  method?: "GET" | "POST";
  body?: unknown;
  bearerToken?: string;
  meta?: RequestMeta;
  authenticate?: boolean;
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
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
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

function invalidUpstreamShape(): IntegrationError {
  return new IntegrationError(
    "UPSTREAM_INVALID_RESPONSE",
    "An upstream service returned an invalid response",
    502,
    true,
  );
}
