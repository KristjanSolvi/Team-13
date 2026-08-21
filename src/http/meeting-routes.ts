import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";

import { DomainError } from "../domain/errors.js";
import { isMeetingAgentReconciliationVerified } from "../services/meeting-verification.js";
import type { AppDependencies } from "./app.js";
import { requireActor } from "./auth.js";

const safeCorrelationId = /^[A-Za-z0-9._-]{1,100}$/;
const idempotencyKey = z.string().min(8).max(200);
const expectedVersion = z.number().int().positive();
const transcriptSegment = z
  .object({
    segmentKey: z.string().min(1).max(200),
    text: z.string().min(1).max(4_000),
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().nonnegative(),
    speakerId: z.number().int().optional(),
    isFinal: z.boolean(),
    audioQuality: z.enum(["clear", "uncertain"]),
  })
  .strict()
  .refine((value) => value.endSeconds >= value.startSeconds, {
    path: ["endSeconds"],
    message: "Transcript end cannot precede its start",
  });

const startSchema = z
  .object({
    wardId: z.string().min(1).max(200),
    interactionId: z.string().min(1).max(200),
    idempotencyKey,
  })
  .strict();
const openSegmentSchema = z
  .object({
    patientId: z.string().min(1).max(160),
    expectedMeetingVersion: expectedVersion,
    idempotencyKey,
  })
  .strict();
const transcriptSchema = z
  .object({
    patientSegmentId: z.string().uuid().nullable(),
    segments: z.array(transcriptSegment).min(1).max(500),
    idempotencyKey,
  })
  .strict();
const closeSegmentSchema = z
  .object({
    expectedMeetingVersion: expectedVersion,
    expectedSegmentVersion: expectedVersion,
    idempotencyKey,
  })
  .strict();
const reconcileSchema = z
  .object({
    expectedSegmentVersion: expectedVersion,
    idempotencyKey,
  })
  .strict();
const completeSchema = z
  .object({
    expectedMeetingVersion: expectedVersion,
    idempotencyKey,
  })
  .strict();

const asyncRoute =
  (handler: (request: Request, response: Response) => Promise<void> | void) =>
  (request: Request, response: Response, next: NextFunction): void => {
    Promise.resolve()
      .then(() => handler(request, response))
      .catch(next);
  };

export function mountMeetingRoutes(
  router: Router,
  dependencies: AppDependencies,
): void {
  router.post(
    "/ward-meetings",
    asyncRoute((request, response) => {
      const body = startSchema.parse(request.body);
      const result = dependencies.meetings.startMeeting({
        wardId: body.wardId,
        interactionId: body.interactionId,
        idempotencyKey: body.idempotencyKey,
        actor: clinicianActor(request),
        correlationId: correlationId(request),
      });
      response.status(result.replayed ? 200 : 201).json(result);
    }),
  );

  router.post(
    "/ward-meetings/:meetingId/segments",
    asyncRoute((request, response) => {
      const body = openSegmentSchema.parse(request.body);
      const result = dependencies.meetings.openPatientSegment({
        meetingId: meetingId(request),
        patientId: body.patientId,
        expectedMeetingVersion: body.expectedMeetingVersion,
        idempotencyKey: body.idempotencyKey,
        actor: clinicianActor(request),
        correlationId: correlationId(request),
      });
      response.status(result.replayed ? 200 : 201).json(result);
    }),
  );

  router.post(
    "/ward-meetings/:meetingId/transcript-segments",
    asyncRoute((request, response) => {
      const body = transcriptSchema.parse(request.body);
      const result = dependencies.meetings.appendTranscript({
        meetingId: meetingId(request),
        patientSegmentId: body.patientSegmentId,
        segments: body.segments.map(({ speakerId, ...segment }) => ({
          ...segment,
          ...(speakerId === undefined ? {} : { speakerId }),
        })),
        idempotencyKey: body.idempotencyKey,
        actor: clinicianActor(request),
        correlationId: correlationId(request),
      });
      response.status(result.replayed ? 200 : 201).json(result);
    }),
  );

  router.post(
    "/ward-meetings/:meetingId/segments/:segmentId/close",
    asyncRoute((request, response) => {
      const body = closeSegmentSchema.parse(request.body);
      response.json(
        dependencies.meetings.closePatientSegment({
          meetingId: meetingId(request),
          segmentId: segmentId(request),
          expectedMeetingVersion: body.expectedMeetingVersion,
          expectedSegmentVersion: body.expectedSegmentVersion,
          idempotencyKey: body.idempotencyKey,
          actor: clinicianActor(request),
          correlationId: correlationId(request),
        }),
      );
    }),
  );

  router.post(
    "/ward-meetings/:meetingId/segments/:segmentId/reconcile",
    asyncRoute(async (request, response) => {
      const body = reconcileSchema.parse(request.body);
      const selectedSegmentId = segmentId(request);
      const existing =
        dependencies.store.getMeetingReconciliationForSegment(
          selectedSegmentId,
        );
      if (!existing && !dependencies.meetingRunner) {
        throw meetingAgentNotConfigured();
      }
      const begun = dependencies.meetings.beginReconciliation({
        meetingId: meetingId(request),
        segmentId: selectedSegmentId,
        expectedSegmentVersion: body.expectedSegmentVersion,
        idempotencyKey: body.idempotencyKey,
        actor: clinicianActor(request),
        correlationId: correlationId(request),
      });
      let reconciliation = begun.reconciliation;
      if (reconciliation.status === "requested") {
        const runner = dependencies.meetingRunner;
        if (!runner) throw meetingAgentNotConfigured();
        try {
          reconciliation = await runner.generate({
            reconciliationId: reconciliation.reconciliationId,
            patientId: reconciliation.patientId,
            idempotencyKey: reconciliation.idempotencyKey,
          });
        } catch (error) {
          console.error(
            JSON.stringify({
              event: "corti.meeting_agent.reconciliation_failed",
              error:
                error instanceof DomainError
                  ? error.code
                  : error instanceof Error
                    ? error.name
                    : "UnknownError",
            }),
          );
          throw new DomainError(
            "CORTI_MEETING_AGENT_FAILED",
            "Corti meeting reconciliation failed; retry the same request",
            true,
            502,
          );
        }
      }
      if (reconciliation.status !== "saved") {
        throw new DomainError(
          "MEETING_RECONCILIATION_UNAVAILABLE",
          "Meeting reconciliation is unavailable",
          true,
          409,
        );
      }
      if (
        !isMeetingAgentReconciliationVerified(
          dependencies.store,
          reconciliation,
        )
      ) {
        throw new DomainError(
          "MEETING_RECONCILIATION_UNCONFIRMED",
          "Meeting reconciliation has not been verified",
          true,
          502,
        );
      }
      response.status(begun.replayed ? 200 : 201).json({
        replayed: begun.replayed,
        reconciliation,
        newDraftTasks: reconciliation.newDraftTaskIds.map((taskId) =>
          dependencies.store.requireTask(taskId),
        ),
        carryForwards: dependencies.store.listMeetingCarryForwards(
          reconciliation.reconciliationId,
        ),
      });
    }),
  );

  router.post(
    "/ward-meetings/:meetingId/complete",
    asyncRoute((request, response) => {
      const body = completeSchema.parse(request.body);
      response.json(
        dependencies.meetings.completeMeeting({
          meetingId: meetingId(request),
          expectedMeetingVersion: body.expectedMeetingVersion,
          idempotencyKey: body.idempotencyKey,
          actor: clinicianActor(request),
          correlationId: correlationId(request),
        }),
      );
    }),
  );

  router.get(
    "/ward-meetings/:meetingId",
    asyncRoute((request, response) => {
      response.json(
        dependencies.meetings.getMeetingResponse(meetingId(request)),
      );
    }),
  );
}

function clinicianActor(request: Request) {
  return { type: "clinician" as const, id: requireActor(request) };
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

function meetingId(request: Request): string {
  return z.string().uuid().parse(pathParam(request, "meetingId"));
}

function segmentId(request: Request): string {
  return z.string().uuid().parse(pathParam(request, "segmentId"));
}

function correlationId(request: Request): string {
  const supplied = request.header("x-correlation-id");
  return supplied !== undefined && safeCorrelationId.test(supplied)
    ? supplied
    : `meeting:${randomUUID()}`;
}

function meetingAgentNotConfigured(): DomainError {
  return new DomainError(
    "CORTI_MEETING_AGENT_NOT_CONFIGURED",
    "Corti meeting reconciliation is not configured",
    false,
    503,
  );
}
