import { timingSafeEqual } from "node:crypto";

import type { Request } from "express";

import { DomainError } from "../domain/errors.js";

export interface ContextMetaSource {
  _meta?: { [key: string]: unknown };
}

export function contextIdFromMeta(
  extra: ContextMetaSource | undefined,
): string {
  const value = extra?._meta?._contextId;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DomainError(
      "CONTEXT_REQUIRED",
      "A Corti context is required",
      false,
      403,
    );
  }
  return value;
}

export function hasBearer(request: Request, expected: string): boolean {
  const authorization = request.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const actual = match?.[1] ?? "";
  if (actual.length === 0 || expected.length === 0) return false;

  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
