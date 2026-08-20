export class PipelineError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    options: { status: number; retryable: boolean; cause?: unknown },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "PipelineError";
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable;
  }
}

export function upstreamPipelineError(
  operation: string,
  cause: unknown,
): PipelineError {
  return new PipelineError(
    "CORTI_UPSTREAM_ERROR",
    `Corti ${operation} failed. Retry or use the disclosed demo fallback.`,
    { status: 502, retryable: true, cause },
  );
}
