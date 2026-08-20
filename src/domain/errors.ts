export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly status = 400,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
