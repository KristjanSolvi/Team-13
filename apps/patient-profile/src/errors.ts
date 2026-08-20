export class ProfileError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly retryable = false,
  ) {
    super(message);
  }
}
