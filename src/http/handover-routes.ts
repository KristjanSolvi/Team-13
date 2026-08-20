import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";

import { DomainError } from "../domain/errors.js";
import {
  type HandoverRecord,
  handoverReasons,
  renderedHandoverSchema,
} from "../domain/handover.js";
import type { AppDependencies } from "./app.js";
import { requireActor } from "./auth.js";

const SAFE_CORRELATION_ID = /^[A-Za-z0-9._-]{1,100}$/;

const draftRequestSchema = z
  .object({
    reason: z.enum(handoverReasons),
    focus: z.string().trim().min(1).max(500).nullable().default(null),
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict();

const finalizationSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    sourceSnapshotHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    rendered: renderedHandoverSchema,
  })
  .strict();

const asyncRoute =
  (handler: (request: Request, response: Response) => Promise<void> | void) =>
  (request: Request, response: Response, next: NextFunction): void => {
    Promise.resolve()
      .then(() => handler(request, response))
      .catch(next);
  };

export function mountHandoverRoutes(
  router: Router,
  dependencies: AppDependencies,
): void {
  router.post(
    "/patients/:patientId/handover-drafts",
    asyncRoute(async (request, response) => {
      const body = draftRequestSchema.parse(request.body);
      const requestedBy = requireActor(request);
      const patientId = pathParam(request, "patientId");
      const existing = dependencies.store.getHandoverByRequest(
        requestedBy,
        body.idempotencyKey,
      );
      if (!existing && !dependencies.handoverRunner) {
        throw new DomainError(
          "CORTI_HANDOVER_AGENT_NOT_CONFIGURED",
          "Corti handover generation is not configured",
          false,
          503,
        );
      }

      const begun = dependencies.handovers.beginRequest({
        patientId,
        requestedBy,
        reason: body.reason,
        focus: body.focus,
        correlationId: correlationId(request),
        idempotencyKey: body.idempotencyKey,
      });
      let handover = begun.handover;
      if (!begun.replayed) {
        const runner = dependencies.handoverRunner;
        if (!runner) {
          throw new DomainError(
            "CORTI_HANDOVER_AGENT_NOT_CONFIGURED",
            "Corti handover generation is not configured",
            false,
            503,
          );
        }
        try {
          await runner.generate({
            handoverId: handover.handoverId,
            patientId,
            reason: body.reason,
            focus: body.focus,
            idempotencyKey: body.idempotencyKey,
          });
          handover = dependencies.store.requireHandover(handover.handoverId);
        } catch {
          const persisted = dependencies.store.requireHandover(
            handover.handoverId,
          );
          if (persisted.status === "draft" || persisted.status === "rendered") {
            handover = persisted;
          } else {
            dependencies.handovers.markFailed(
              handover.handoverId,
              "CORTI_HANDOVER_AGENT_FAILED",
              true,
            );
            throw new DomainError(
              "CORTI_HANDOVER_AGENT_FAILED",
              "Corti handover generation failed; retry with a new idempotency key",
              true,
              502,
            );
          }
        }
      }

      handover = prepareResponse(dependencies, handover);
      response.status(begun.replayed ? 200 : 201).json({
        replayed: begun.replayed,
        lifecycleStatus: lifecycleStatus(handover),
        handover: dependencies.handovers.response(handover),
      });
    }),
  );

  router.post(
    "/handovers/:handoverId/finalize",
    asyncRoute((request, response) => {
      const body = finalizationSchema.parse(request.body);
      requireActor(request);
      const handoverId = handoverPathParam(request);
      const result = dependencies.handovers.finalizeWithReplay(
        handoverId,
        body.expectedVersion,
        body.sourceSnapshotHash,
        body.rendered,
      );
      response.status(result.replayed ? 200 : 201).json({
        replayed: result.replayed,
        lifecycleStatus: "rendered",
        handover: dependencies.handovers.response(result.handover),
      });
    }),
  );

  router.get(
    "/handovers/:handoverId",
    asyncRoute((request, response) => {
      const handover = dependencies.store.requireHandover(
        handoverPathParam(request),
      );
      response.json(dependencies.handovers.response(handover));
    }),
  );
}

function prepareResponse(
  dependencies: AppDependencies,
  handover: HandoverRecord,
): HandoverRecord {
  return handover.status === "draft"
    ? dependencies.handovers.markRenderRequested(handover.handoverId)
    : handover;
}

function lifecycleStatus(handover: HandoverRecord): "draft" | "rendered" {
  if (handover.status === "draft" || handover.status === "rendered") {
    return handover.status;
  }
  throw new DomainError(
    "HANDOVER_RESPONSE_UNAVAILABLE",
    "Handover response is not available",
    false,
    409,
  );
}

function handoverPathParam(request: Request): string {
  return z.string().uuid().parse(pathParam(request, "handoverId"));
}

function pathParam(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `Missing path parameter: ${name}`,
    );
  }
  return value;
}

function correlationId(request: Request): string {
  const supplied = request.header("x-correlation-id");
  return supplied !== undefined && SAFE_CORRELATION_ID.test(supplied)
    ? supplied
    : `handover:${randomUUID()}`;
}
