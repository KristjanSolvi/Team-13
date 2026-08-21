import { createHash, randomUUID } from "node:crypto";

import {
  type NextFunction,
  type Request,
  type Response,
  Router,
} from "express";
import { ZodError, z } from "zod";

import { sourceRevisionReasons } from "../domain/change-radar.js";
import { demoScenarios } from "../demo/types.js";
import { DomainError } from "../domain/errors.js";
import { isHandoverTaskActive } from "../domain/handover.js";
import type { CorrectDraftPatch } from "../services/ledger-service.js";
import { evaluateTaskRouting } from "../services/scheduler-service.js";
import type { AppDependencies } from "./app.js";
import { requireActor, requireAppAuth } from "./auth.js";
import { mountHandoverRoutes } from "./handover-routes.js";
import { mountMeetingRoutes } from "./meeting-routes.js";

const EVIDENCE_REFERENCE = /^(encounter|record|dictation):[A-Za-z0-9._-]+$/;
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._-]{1,100}$/;

const sourceEvidenceSchema = z
  .object({
    evidenceRef: z.string().regex(EVIDENCE_REFERENCE),
    sourceQuote: z.string().trim().min(1).max(4_000),
    startSeconds: z.number().nonnegative().optional(),
    endSeconds: z.number().nonnegative().optional(),
    speakerId: z.number().int().optional(),
  })
  .refine(
    (value) =>
      value.startSeconds === undefined ||
      value.endSeconds === undefined ||
      value.endSeconds >= value.startSeconds,
    "Evidence endSeconds must not precede startSeconds",
  );

const signalSchema = z.object({
  patientId: z.string().min(1).max(160),
  interactionId: z.string().min(1).max(160),
  signalText: z.string().min(5).max(1_000),
  evidenceRefs: z
    .array(z.string().regex(EVIDENCE_REFERENCE))
    .min(1)
    .max(20)
    .refine((references) => new Set(references).size === references.length, {
      message: "Evidence references must be unique",
    }),
  sourceEvidence: z.array(sourceEvidenceSchema).min(1).max(20).optional(),
  idempotencyKey: z.string().min(8).max(200),
});

const commandBase = {
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(200),
};

const sourceRevisionSchema = z
  .object({
    sourceItemId: z.string().min(1).max(160),
    expectedSourceRef: z.string().regex(EVIDENCE_REFERENCE),
    newText: z.string().trim().min(3).max(4_000),
    reason: z.enum(sourceRevisionReasons),
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict();

const asyncRoute =
  (handler: (request: Request, response: Response) => Promise<void> | void) =>
  (request: Request, response: Response, next: NextFunction): void => {
    Promise.resolve()
      .then(() => handler(request, response))
      .catch(next);
  };

export function mountRoutes(app: Router, dependencies: AppDependencies): void {
  const router = Router();
  router.use(requireAppAuth(dependencies.appBearerToken));
  mountHandoverRoutes(router, dependencies);
  mountMeetingRoutes(router, dependencies);

  router.post(
    "/signals",
    asyncRoute(async (request, response) => {
      const body = signalSchema.parse(request.body);
      const actorId = requireActor(request);
      const commandScope = `signal:${body.interactionId}`;
      const replay = dependencies.store.getProcessedCommand(
        commandScope,
        body.idempotencyKey,
      );
      if (replay) {
        response.status(202).json(replay);
        return;
      }
      if (!dependencies.store.getPatient(body.patientId)) {
        throw new DomainError(
          "PATIENT_NOT_FOUND",
          "Patient not found",
          false,
          404,
        );
      }

      const suppliedByRef = new Map(
        (body.sourceEvidence ?? []).map((evidence) => [
          evidence.evidenceRef,
          evidence,
        ]),
      );
      const missingEvidenceRefs = body.evidenceRefs.filter(
        (reference) => !suppliedByRef.has(reference),
      );
      const extraEvidenceRefs = [...suppliedByRef.keys()].filter(
        (reference) => !body.evidenceRefs.includes(reference),
      );
      const duplicateSourceRefs =
        suppliedByRef.size !== (body.sourceEvidence?.length ?? 0);
      const evidenceComplete =
        missingEvidenceRefs.length === 0 &&
        extraEvidenceRefs.length === 0 &&
        !duplicateSourceRefs;
      const occurredAt = dependencies.clock.now().toISOString();

      const result = dependencies.store.transaction(() => {
        if (evidenceComplete) {
          for (const evidence of body.sourceEvidence ?? []) {
            const existing = dependencies.store
              .listRecordItems(body.patientId)
              .find((item) => item.sourceRef === evidence.evidenceRef);
            if (existing && existing.text !== evidence.sourceQuote) {
              throw new DomainError(
                "EVIDENCE_CONFLICT",
                "Evidence reference already has different source content",
                false,
                409,
              );
            }
            dependencies.store.putRecordItem({
              itemId: signalEvidenceItemId(
                body.patientId,
                body.interactionId,
                evidence.evidenceRef,
              ),
              patientId: body.patientId,
              itemType: "encounter-evidence",
              text: evidence.sourceQuote,
              sourceRef: evidence.evidenceRef,
              recordedAt: occurredAt,
            });
          }
        }

        const event = dependencies.store.appendEvent({
          eventType: "encounter.signal_received",
          occurredAt,
          correlationId: correlationId(request, body.interactionId),
          patientId: body.patientId,
          interactionId: body.interactionId,
          contextId: dependencies.store.contextForInteraction(
            body.interactionId,
          ),
          actor: { type: "system", id: actorId },
          payload: {
            signalSummary: body.signalText,
            evidenceRefs: body.evidenceRefs,
            evidenceStatus: evidenceComplete
              ? "registered"
              : "source_content_required",
          },
        });
        const commandResult = evidenceComplete
          ? {
              signalEventId: event.eventId,
              status: "retained",
              investigationStatus: "ready",
              recovery: "AGENT_INVESTIGATION_AVAILABLE",
              evidenceRefs: body.evidenceRefs,
            }
          : {
              signalEventId: event.eventId,
              status: "retained",
              investigationStatus: "blocked_missing_source_evidence",
              recovery: "RESUBMIT_WITH_SOURCE_EVIDENCE_OR_CREATE_MANUAL_TASK",
              missingEvidenceRefs:
                missingEvidenceRefs.length > 0
                  ? missingEvidenceRefs
                  : body.evidenceRefs,
            };
        if (!evidenceComplete || !dependencies.runner) {
          dependencies.store.saveProcessedCommand(
            commandScope,
            body.idempotencyKey,
            commandResult,
            occurredAt,
          );
        }
        return commandResult;
      });
      if (evidenceComplete && dependencies.runner) {
        try {
          const agent = await dependencies.runner.investigate({
            patientId: body.patientId,
            interactionId: body.interactionId,
            signalText: body.signalText,
            evidenceRefs: body.evidenceRefs,
            idempotencyKey: body.idempotencyKey,
          });
          const agentResult = {
            signalEventId: result.signalEventId,
            contextId: agent.contextId,
            cortiTaskId: agent.taskId,
            agentState: agent.state,
            ...(agent.credits === undefined ? {} : { credits: agent.credits }),
          };
          dependencies.store.saveProcessedCommand(
            commandScope,
            body.idempotencyKey,
            agentResult,
            occurredAt,
          );
          response.status(202).json(agentResult);
          return;
        } catch {
          response.status(502).json({
            error: {
              code: "AGENT_INVESTIGATION_FAILED",
              message: "Corti investigation failed; the signal was retained",
              retryable: true,
            },
            signalEventId: result.signalEventId,
            recovery: "MANUAL_TASK_AVAILABLE",
          });
          return;
        }
      }
      response.status(202).json(result);
    }),
  );

  router.post(
    "/tasks/manual",
    asyncRoute((request, response) => {
      const body = z
        .object({
          patientId: z.string().min(1).max(160),
          interactionId: z.string().min(1).max(160),
          contextId: z.string().min(1).max(160).nullable().optional(),
          threadId: z.string().uuid().optional(),
          summary: z.string().min(5).max(240),
          taskType: z.string().min(1).max(160),
          evidenceRefs: z.array(z.string().regex(EVIDENCE_REFERENCE)).min(1),
          targetTeamId: z.string().min(1).max(160),
          requiredCapabilities: z.array(z.string().min(1)).min(1),
          clinicalUrgency: z.enum(["high", "medium", "routine"]),
          dueInMs: z.number().int().positive(),
          idempotencyKey: z.string().min(8).max(200),
        })
        .parse(request.body);
      if (body.contextId) {
        dependencies.records.getPatientContext(body.contextId, body.patientId);
        dependencies.records.requireInteraction(
          body.contextId,
          body.interactionId,
        );
      }
      const { threadId, ...draft } = body;
      response.status(201).json(
        dependencies.ledger.createDraft({
          ...draft,
          ...(threadId === undefined ? {} : { threadId }),
          contextId: body.contextId ?? null,
          origin: "clinician_created",
          actor: { type: "clinician", id: requireActor(request) },
        }),
      );
    }),
  );

  router.post(
    "/tasks/:taskId/approve",
    asyncRoute(async (request, response) => {
      const body = z
        .object({
          ...commandBase,
          approvalChannel: z
            .enum(["app_one_tap", "dictation_confirmation"])
            .default("app_one_tap"),
        })
        .parse(request.body);
      const taskId = pathParam(request, "taskId");
      const task = dependencies.ledger.getTask(taskId);
      const thread = dependencies.store.requireThread(task.threadId);
      const approval = dependencies.ledger.approveDraft(
        taskId,
        body.expectedVersion,
        requireActor(request),
        body.approvalChannel,
        body.idempotencyKey,
      );
      if (dependencies.runner) {
        try {
          const agent = await dependencies.runner.publishApproved({
            patientId: task.patientId,
            interactionId: thread.interactionId,
            taskId,
            expectedVersion: body.expectedVersion,
            approvalProof: approval.proof,
            idempotencyKey: body.idempotencyKey,
          });
          response.json({
            task: dependencies.ledger.getTask(taskId),
            contextId: agent.contextId,
            cortiTaskId: agent.taskId,
            agentState: agent.state,
            ...(agent.credits === undefined ? {} : { credits: agent.credits }),
          });
          return;
        } catch {
          response.status(502).json({
            error: {
              code: "MANUAL_PUBLICATION_REQUIRED",
              message: "Corti publication could not be confirmed",
              retryable: true,
            },
            taskId,
            approvalProof: approval.proof,
            expiresAt: approval.expiresAt,
          });
          return;
        }
      }
      response.json({
        taskId,
        approvalProof: approval.proof,
        expiresAt: approval.expiresAt,
        status: "approved_not_published",
      });
    }),
  );

  router.post(
    "/tasks/:taskId/correct",
    asyncRoute((request, response) => {
      const body = z
        .object({
          ...commandBase,
          summary: z.string().min(5).max(240).optional(),
          targetTeamId: z.string().min(1).max(160).optional(),
          requiredCapabilities: z.array(z.string().min(1)).min(1).optional(),
          clinicalUrgency: z.enum(["high", "medium", "routine"]).optional(),
          dueInMs: z.number().int().positive().optional(),
        })
        .refine(
          (value) =>
            value.summary !== undefined ||
            value.targetTeamId !== undefined ||
            value.requiredCapabilities !== undefined ||
            value.clinicalUrgency !== undefined ||
            value.dueInMs !== undefined,
          "At least one corrected field is required",
        )
        .parse(request.body);
      const taskId = pathParam(request, "taskId");
      const patch: CorrectDraftPatch = {};
      if (body.summary !== undefined) patch.summary = body.summary;
      if (body.targetTeamId !== undefined) {
        patch.targetTeamId = body.targetTeamId;
      }
      if (body.requiredCapabilities !== undefined) {
        patch.requiredCapabilities = body.requiredCapabilities;
      }
      if (body.clinicalUrgency !== undefined) {
        patch.clinicalUrgency = body.clinicalUrgency;
      }
      if (body.dueInMs !== undefined) patch.dueInMs = body.dueInMs;
      response.json(
        dependencies.store.runTaskCommand(
          `http-correct:${taskId}`,
          body.idempotencyKey,
          dependencies.clock.now().toISOString(),
          () =>
            dependencies.ledger.correctDraft(
              taskId,
              body.expectedVersion,
              patch,
              {
                type: "clinician",
                id: requireActor(request),
              },
            ),
        ),
      );
    }),
  );

  router.post(
    "/tasks/:taskId/dismiss",
    asyncRoute((request, response) => {
      const body = z
        .object({
          ...commandBase,
          reason: z.string().min(3).max(500),
        })
        .parse(request.body);
      const taskId = pathParam(request, "taskId");
      response.json(
        dependencies.store.runTaskCommand(
          `http-dismiss:${taskId}`,
          body.idempotencyKey,
          dependencies.clock.now().toISOString(),
          () =>
            dependencies.ledger.dismissDraft(
              taskId,
              body.expectedVersion,
              requireActor(request),
              body.reason,
            ),
        ),
      );
    }),
  );

  router.post(
    "/tasks/:taskId/reopen",
    asyncRoute((request, response) => {
      const body = z
        .object({
          ...commandBase,
          dueInMs: z.number().int().positive(),
        })
        .parse(request.body);
      const taskId = pathParam(request, "taskId");
      response.json(
        dependencies.store.runTaskCommand(
          `http-reopen:${taskId}`,
          body.idempotencyKey,
          dependencies.clock.now().toISOString(),
          () =>
            dependencies.ledger.reopenToTeam(
              taskId,
              body.expectedVersion,
              requireActor(request),
              body.dueInMs,
            ),
        ),
      );
    }),
  );

  router.post(
    "/tasks/:taskId/accept",
    asyncRoute((request, response) => {
      const body = z.object(commandBase).parse(request.body);
      response.json(
        dependencies.ledger.acceptTask(
          pathParam(request, "taskId"),
          body.expectedVersion,
          requireActor(request),
          body.idempotencyKey,
        ),
      );
    }),
  );

  router.post(
    "/tasks/:taskId/decline",
    asyncRoute((request, response) => {
      const body = z.object(commandBase).parse(request.body);
      const taskId = pathParam(request, "taskId");
      response.json(
        dependencies.store.runTaskCommand(
          `http-decline:${taskId}`,
          body.idempotencyKey,
          dependencies.clock.now().toISOString(),
          () => {
            dependencies.scheduler.decline(
              taskId,
              body.expectedVersion,
              requireActor(request),
            );
            return dependencies.ledger.getTask(taskId);
          },
        ),
      );
    }),
  );

  router.post(
    "/tasks/:taskId/complete",
    asyncRoute((request, response) => {
      const body = z
        .object({
          ...commandBase,
          outcomeRef: z.string().min(1).max(240),
        })
        .parse(request.body);
      const taskId = pathParam(request, "taskId");
      response.json(
        dependencies.store.runTaskCommand(
          `http-complete:${taskId}`,
          body.idempotencyKey,
          dependencies.clock.now().toISOString(),
          () =>
            dependencies.ledger.completeTask(
              taskId,
              body.expectedVersion,
              requireActor(request),
              body.outcomeRef,
            ),
        ),
      );
    }),
  );

  router.post(
    "/tasks/:taskId/verify",
    asyncRoute((request, response) => {
      const body = z
        .object({
          ...commandBase,
          outcomeRef: z.string().min(1).max(240),
        })
        .parse(request.body);
      const verifierId = requireActor(request);
      if (!verifierId.startsWith("downstream:")) {
        throw new DomainError(
          "DOWNSTREAM_VERIFIER_REQUIRED",
          "Independent downstream verification is required",
          false,
          403,
        );
      }
      const taskId = pathParam(request, "taskId");
      response.json(
        dependencies.store.runTaskCommand(
          `http-verify:${taskId}`,
          body.idempotencyKey,
          dependencies.clock.now().toISOString(),
          () =>
            dependencies.ledger.verifyTask(
              taskId,
              body.expectedVersion,
              body.outcomeRef,
              verifierId,
            ),
        ),
      );
    }),
  );

  router.post(
    "/tasks/:taskId/verify-external",
    asyncRoute((request, response) => {
      const body = z
        .object({
          ...commandBase,
          outcomeRef: z.string().min(1).max(240),
          deliveryId: z.string().min(1).max(160),
        })
        .parse(request.body);
      const verifierId = requireActor(request);
      if (!verifierId.startsWith("downstream:")) {
        throw new DomainError(
          "DOWNSTREAM_VERIFIER_REQUIRED",
          "Independent downstream verification is required",
          false,
          403,
        );
      }
      const taskId = pathParam(request, "taskId");
      response.json(
        dependencies.store.runTaskCommand(
          `http-verify-external:${taskId}:${verifierId}`,
          body.idempotencyKey,
          dependencies.clock.now().toISOString(),
          () =>
            dependencies.ledger.verifyTaskFromExternalReadback(
              taskId,
              body.expectedVersion,
              body.outcomeRef,
              body.deliveryId,
              verifierId,
            ),
        ),
      );
    }),
  );

  router.post(
    "/demo/sessions",
    asyncRoute((request, response) => {
      const body = z
        .object({
          title: z.string().trim().min(3).max(120),
          scenario: z.enum(demoScenarios),
          groupSize: z.union([z.literal(1), z.literal(2)]),
          targetTeamId: z.string().min(1).max(160),
          idempotencyKey: z.string().min(8).max(200),
        })
        .strict()
        .parse(request.body);
      response.status(201).json(
        dependencies.demoAudience.createSession({
          ...body,
          actorId: requireActor(request),
        }),
      );
    }),
  );

  router.get(
    "/demo/sessions/:sessionId",
    asyncRoute((request, response) => {
      response.json(
        dependencies.demoAudience.getSession(pathParam(request, "sessionId")),
      );
    }),
  );

  router.post(
    "/demo/join/:joinCode",
    asyncRoute((request, response) => {
      const body = z
        .object({
          displayName: z.string().trim().min(1).max(80),
          joinKey: z.string().min(8).max(200),
        })
        .strict()
        .parse(request.body);
      response.status(201).json(
        dependencies.demoAudience.joinSession({
          ...body,
          joinCode: pathParam(request, "joinCode"),
        }),
      );
    }),
  );

  router.post(
    "/demo/sessions/:sessionId/assign",
    asyncRoute((request, response) => {
      const body = z
        .object({
          groupId: z.string().regex(/^group-[1-9]\d*$/),
          taskId: z.string().uuid(),
          expectedVersion: z.number().int().positive(),
          idempotencyKey: z.string().min(8).max(200),
        })
        .strict()
        .parse(request.body);
      response.json(
        dependencies.demoAudience.assignTask({
          ...body,
          sessionId: pathParam(request, "sessionId"),
          actorId: requireActor(request),
        }),
      );
    }),
  );

  router.post(
    "/demo/participants/lookup",
    asyncRoute((request, response) => {
      const body = z
        .object({ participantToken: z.string().min(32).max(200) })
        .strict()
        .parse(request.body);
      response.json(
        dependencies.demoAudience.participantView(body.participantToken),
      );
    }),
  );

  router.post(
    "/demo/advance-clock",
    asyncRoute((request, response) => {
      const body = z
        .object({
          milliseconds: z.number().int().positive(),
          idempotencyKey: z.string().min(8).max(200),
        })
        .parse(request.body);
      const replay = dependencies.store.getProcessedCommand(
        "demo-clock",
        body.idempotencyKey,
      );
      if (replay) {
        response.json(replay);
        return;
      }
      const now = dependencies.clock.advance(body.milliseconds);
      dependencies.scheduler.tick();
      dependencies.store.appendEvent({
        eventType: "demo.clock_advanced",
        occurredAt: now.toISOString(),
        correlationId: correlationId(request, randomUUID()),
        patientId: "synthetic-system",
        interactionId: "demo-clock",
        contextId: null,
        actor: { type: "system", id: requireActor(request) },
        payload: { milliseconds: body.milliseconds },
      });
      const result = { now: now.toISOString() };
      dependencies.store.saveProcessedCommand(
        "demo-clock",
        body.idempotencyKey,
        result,
        now.toISOString(),
      );
      response.json(result);
    }),
  );

  router.post(
    "/demo/tasks/:taskId/route-now",
    asyncRoute((request, response) => {
      const body = z
        .object({ idempotencyKey: z.string().min(8).max(200) })
        .strict()
        .parse(request.body);
      dependencies.clock.assertDemoEnabled();
      const taskId = pathParam(request, "taskId");
      const commandScope = `demo-route-now:${taskId}`;
      const replay = dependencies.store.getProcessedCommand(
        commandScope,
        body.idempotencyKey,
      );
      if (replay) {
        response.json(replay);
        return;
      }
      const offered = dependencies.ledger.getTask(taskId);
      if (offered.state !== "offered_to_team") {
        throw new DomainError(
          "DEMO_TASK_NOT_ROUTABLE",
          "Demo routing requires a task currently offered to a team",
          false,
          409,
        );
      }
      if (Date.parse(offered.dueBy) <= Date.parse(offered.acceptBy)) {
        throw new DomainError(
          "DEMO_TASK_DEADLINE_COLLISION",
          "This task reaches its clinical deadline before smart assignment can run",
          false,
          409,
        );
      }
      const preflightRouting = evaluateTaskRouting(dependencies.store, offered);
      if (preflightRouting.decision.selectedMemberId === null) {
        throw new DomainError(
          "DEMO_ROUTING_INCOMPLETE",
          "No eligible available team member could receive this task",
          false,
          409,
        );
      }
      const advancedByMs = Math.max(
        0,
        Date.parse(offered.acceptBy) - dependencies.clock.now().getTime(),
      );
      if (advancedByMs > 0) dependencies.clock.advance(advancedByMs);
      dependencies.scheduler.tick();
      const task = dependencies.ledger.getTask(taskId);
      const receipt = dependencies.store.getTaskRoutingReceipt(taskId);
      if (task.state !== "assigned_to_member" || receipt === null) {
        throw new DomainError(
          "DEMO_ROUTING_INCOMPLETE",
          "No eligible available team member could receive this task",
          false,
          409,
        );
      }
      const result = { advancedByMs, task, receipt };
      dependencies.store.saveProcessedCommand(
        commandScope,
        body.idempotencyKey,
        result,
        dependencies.clock.now().toISOString(),
      );
      response.json(result);
    }),
  );

  router.get(
    "/patients/:patientId/threads",
    asyncRoute((request, response) => {
      response.json({
        threads: dependencies.store.listOpenThreads(
          pathParam(request, "patientId"),
        ),
      });
    }),
  );
  router.get(
    "/patients/:patientId/tasks",
    asyncRoute((request, response) => {
      response.json({
        tasks: dependencies.store
          .listPatientTasks(pathParam(request, "patientId"))
          .filter(isHandoverTaskActive),
      });
    }),
  );
  router.get(
    "/patients/:patientId/change-impacts",
    asyncRoute((request, response) => {
      response.json({
        impacts: dependencies.records.listChangeImpacts(
          pathParam(request, "patientId"),
        ),
      });
    }),
  );
  router.post(
    "/patients/:patientId/source-revisions",
    asyncRoute((request, response) => {
      const body = sourceRevisionSchema.parse(request.body);
      response.status(201).json(
        dependencies.records.recordSourceRevision({
          patientId: pathParam(request, "patientId"),
          sourceItemId: body.sourceItemId,
          expectedSourceRef: body.expectedSourceRef,
          newText: body.newText,
          reason: body.reason,
          changedBy: requireActor(request),
          changedAt: dependencies.clock.now().toISOString(),
          correlationId: correlationId(request, randomUUID()),
          idempotencyKey: body.idempotencyKey,
        }),
      );
    }),
  );
  router.get(
    "/teams/:teamId/tasks",
    asyncRoute((request, response) => {
      response.json({
        tasks: dependencies.store.listTeamTasks(pathParam(request, "teamId")),
      });
    }),
  );
  router.get(
    "/tasks/:taskId",
    asyncRoute((request, response) => {
      response.json(dependencies.ledger.getTask(pathParam(request, "taskId")));
    }),
  );
  router.get(
    "/tasks/:taskId/routing-receipt",
    asyncRoute((request, response) => {
      response.json({
        receipt: dependencies.store.getTaskRoutingReceipt(
          pathParam(request, "taskId"),
        ),
      });
    }),
  );
  router.get(
    "/events",
    asyncRoute((request, response) => {
      const after = z.coerce
        .number()
        .int()
        .min(0)
        .default(0)
        .parse(request.query.after);
      response.json({ events: dependencies.store.listEvents(after) });
    }),
  );
  router.get("/events/stream", (request, response, next) => {
    try {
      const rawLastEventId = request.header("last-event-id") ?? "0";
      if (!/^\d+$/.test(rawLastEventId)) {
        throw new DomainError(
          "INVALID_EVENT_SEQUENCE",
          "Last-Event-ID must be a non-negative integer sequence",
        );
      }
      let after = Number(rawLastEventId);
      if (!Number.isSafeInteger(after)) {
        throw new DomainError(
          "INVALID_EVENT_SEQUENCE",
          "Last-Event-ID must be a non-negative integer sequence",
        );
      }
      response.status(200);
      response.setHeader("content-type", "text/event-stream");
      response.setHeader("cache-control", "no-cache");
      response.setHeader("connection", "keep-alive");
      response.flushHeaders();
      const flush = () => {
        for (const event of dependencies.store.listEvents(after)) {
          response.write(
            `id: ${event.sequence}\nevent: ${event.eventType}\ndata: ${JSON.stringify(event)}\n\n`,
          );
          after = event.sequence;
        }
      };
      flush();
      const interval = setInterval(flush, 500);
      request.once("close", () => clearInterval(interval));
    } catch (error) {
      next(error);
    }
  });

  app.use("/api", router);
  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      const value =
        error instanceof DomainError
          ? error
          : error instanceof ZodError
            ? new DomainError(
                "VALIDATION_ERROR",
                error.issues.map((issue) => issue.message).join("; "),
              )
            : new DomainError("INTERNAL_ERROR", "Request failed", true, 500);
      response.status(value.status).json({
        error: {
          code: value.code,
          message: value.message,
          retryable: value.retryable,
        },
      });
    },
  );
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

function correlationId(request: Request, fallback: string): string {
  const supplied = request.header("x-correlation-id");
  return supplied !== undefined && SAFE_CORRELATION_ID.test(supplied)
    ? supplied
    : fallback;
}

function signalEvidenceItemId(
  patientId: string,
  interactionId: string,
  evidenceRef: string,
): string {
  return `signal-evidence-${createHash("sha256")
    .update(patientId)
    .update("\0")
    .update(interactionId)
    .update("\0")
    .update(evidenceRef)
    .digest("hex")
    .slice(0, 32)}`;
}
