import type { NextFunction, Request, Response } from "express";

import { DomainError } from "../domain/errors.js";
import { hasBearer } from "../mcp/auth.js";

const ACTOR_ID = /^[A-Za-z0-9:._-]{1,120}$/;

export function requireAppAuth(expected: string) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!hasBearer(request, expected)) {
      response.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Application authentication is required",
          retryable: false,
        },
      });
      return;
    }
    next();
  };
}

export function requireActor(request: Request): string {
  const actorId = request.header("x-actor-id");
  if (actorId === undefined || !ACTOR_ID.test(actorId)) {
    throw new DomainError("ACTOR_REQUIRED", "x-actor-id is required");
  }
  return actorId;
}
