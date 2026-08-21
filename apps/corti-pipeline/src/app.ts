import { randomUUID } from "node:crypto";

import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z, ZodError } from "zod";

import {
  audioQualityStates,
  codingSystems,
  supportingDocumentTypes,
  type DirectoryOption,
  type TranscriptSegment,
} from "./contracts.js";
import { PipelineError } from "./errors.js";
import type { CortiGateway } from "./gateway.js";
import { parseDictatedRevision } from "./revision.js";

const transcriptSegmentSchema = z
  .object({
    interactionId: z.string().min(1),
    segmentKey: z.string().min(1),
    text: z.string(),
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().nonnegative(),
    speakerId: z.number().int().optional(),
    isFinal: z.boolean(),
    audioQuality: z.enum(audioQualityStates).optional(),
  })
  .refine((segment) => segment.endSeconds >= segment.startSeconds, {
    message: "Transcript segment end must not precede its start",
    path: ["endSeconds"],
  });

const ambientSessionSchema = z.object({
  encounterIdentifier: z.string().min(1).max(120).optional(),
});

const candidateRequestSchema = z.object({
  patientId: z.string().min(1).max(120),
  interactionId: z.string().min(1),
  segments: z.array(transcriptSegmentSchema).min(1).max(500),
  facts: z
    .array(
      z
        .object({
          factId: z.string().min(1).max(160),
          text: z.string().min(1).max(1_000),
          group: z.string().min(1).max(120),
          source: z.string().min(1).max(160),
          createdAt: z.string().min(1).max(160),
        })
        .strict(),
    )
    .max(100)
    .default([]),
});

const transcriptReviewRequestSchema = z
  .object({
    interactionId: z.string().min(1).max(160),
    segments: z.array(transcriptSegmentSchema).min(1).max(500),
    contextTerms: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
    protectedTerms: z.array(z.string().trim().min(1).max(120)).max(25).default([]),
  })
  .strict();

const supportingDocumentSchema = z.object({
  approvalId: z.string().min(1).max(120),
  approvedClinicalText: z.string().min(1).max(50_000),
  documentType: z.enum(supportingDocumentTypes),
});

const codingRequestSchema = z.object({
  approvalId: z.string().min(1).max(120),
  approvedClinicalText: z.string().min(1).max(50_000),
  system: z.enum(codingSystems).optional(),
});

const handoverGroundedStatementSchema = z
  .object({
    statement: z.string().trim().min(1).max(1_000),
    sourceRefs: z.array(z.string().min(1).max(240)).min(1).max(20),
  })
  .strict();

const handoverTaskItemSchema = z
  .object({
    taskId: z.string().uuid(),
    threadId: z.string().uuid(),
    summary: z.string().min(1).max(240),
    state: z.enum([
      "draft",
      "offered_to_team",
      "assigned_to_member",
      "accepted",
      "completed",
      "escalated",
    ]),
    targetTeamId: z.string().min(1).max(160),
    assignedMemberId: z.string().min(1).max(160).nullable(),
    clinicalUrgency: z.enum(["high", "medium", "routine"]),
    acceptBy: z.string().datetime(),
    dueBy: z.string().datetime(),
    version: z.number().int().positive(),
    sourceRefs: z.array(z.string().min(1).max(240)).min(1).max(20),
  })
  .strict();

const handoverPacketSchema = z
  .object({
    situation: z.array(handoverGroundedStatementSchema).max(20),
    background: z.array(handoverGroundedStatementSchema).max(20),
    currentConcerns: z.array(handoverGroundedStatementSchema).max(20),
    outstandingTasks: z.array(handoverTaskItemSchema).max(50),
    awaitingVerification: z.array(handoverTaskItemSchema).max(50),
    escalations: z.array(handoverTaskItemSchema).max(50),
    unknowns: z.array(z.string().trim().min(1).max(500)).max(20),
  })
  .strict();

const renderHandoverRequestSchema = z
  .object({
    handoverId: z.string().uuid(),
    patientId: z.string().min(1).max(160),
    sourceSnapshotHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    packet: handoverPacketSchema,
  })
  .strict();

const directoryOptionSchema = z.object({
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(160),
  aliases: z.array(z.string().min(1).max(160)).max(10).optional(),
});

const revisionPreviewSchema = z.object({
  taskId: z.string().min(1).max(120),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(160),
  transcript: z.string().max(2_000),
  recipientTeams: z.array(directoryOptionSchema).max(100),
});

const safeCorrelationId = /^[A-Za-z0-9._-]{1,100}$/;

function transcriptSegment(
  input: z.infer<typeof transcriptSegmentSchema>,
): TranscriptSegment {
  const segment: TranscriptSegment = {
    interactionId: input.interactionId,
    segmentKey: input.segmentKey,
    text: input.text,
    startSeconds: input.startSeconds,
    endSeconds: input.endSeconds,
    isFinal: input.isFinal,
  };
  if (input.speakerId !== undefined) {
    segment.speakerId = input.speakerId;
  }
  if (input.audioQuality !== undefined) {
    segment.audioQuality = input.audioQuality;
  }
  return segment;
}

function directoryOption(
  input: z.infer<typeof directoryOptionSchema>,
): DirectoryOption {
  const option: DirectoryOption = { id: input.id, label: input.label };
  if (input.aliases !== undefined) {
    option.aliases = input.aliases;
  }
  return option;
}

function getCorrelationId(request: Request): string {
  const supplied = request.header("x-correlation-id");
  return supplied !== undefined && safeCorrelationId.test(supplied)
    ? supplied
    : randomUUID();
}

function correlationId(response: Response): string {
  const value = response.locals.correlationId;
  return typeof value === "string" ? value : randomUUID();
}

function route(
  handler: (request: Request, response: Response) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request, response).catch(next);
  };
}

export interface CreatePipelineAppOptions {
  gateway: CortiGateway | null;
  allowedOrigins?: string[];
  missingCortiVariables?: string[];
}

export function createPipelineApp(options: CreatePipelineAppOptions) {
  const app = express();
  const allowedOrigins = new Set(options.allowedOrigins ?? []);

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use((request, response, next) => {
    const id = getCorrelationId(request);
    response.locals.correlationId = id;
    response.setHeader("x-correlation-id", id);
    if (request.path.startsWith("/api/corti/")) {
      response.setHeader("cache-control", "no-store");
    }

    const origin = request.header("origin");
    if (origin !== undefined && allowedOrigins.has(origin)) {
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("vary", "Origin");
      response.setHeader("access-control-allow-headers", "content-type,x-correlation-id");
      response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    }
    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }
    next();
  });

  const requireGateway = (): CortiGateway => {
    if (options.gateway === null) {
      throw new PipelineError(
        "CORTI_NOT_CONFIGURED",
        "Corti credentials are not configured on the pipeline server.",
        { status: 503, retryable: false },
      );
    }
    return options.gateway;
  };

  app.get("/health", (_request, response) => {
    response.json({
      status: "ok",
      cortiConfigured: options.gateway !== null,
      missingCortiVariables: options.missingCortiVariables ?? [],
    });
  });

  app.post(
    "/api/corti/ambient/session",
    route(async (request, response) => {
      const input = ambientSessionSchema.parse(request.body ?? {});
      response.status(201).json(
        await requireGateway().createAmbientSession(input.encounterIdentifier),
      );
    }),
  );

  app.post(
    "/api/corti/ambient/token",
    route(async (_request, response) => {
      response.json(await requireGateway().mintAmbientToken());
    }),
  );

  app.post(
    "/api/corti/dictation/token",
    route(async (_request, response) => {
      response.json(await requireGateway().mintDictationToken());
    }),
  );

  app.post(
    "/api/corti/transcripts/review",
    route(async (request, response) => {
      const input = transcriptReviewRequestSchema.parse(request.body);
      response.json(
        await requireGateway().reviewTranscript({
          interactionId: input.interactionId,
          correlationId: correlationId(response),
          segments: input.segments.map(transcriptSegment),
          contextTerms: input.contextTerms,
          protectedTerms: input.protectedTerms,
        }),
      );
    }),
  );

  app.post(
    "/api/corti/candidates/generate",
    route(async (request, response) => {
      const input = candidateRequestSchema.parse(request.body);
      response.json(
        await requireGateway().generateCandidates({
          patientId: input.patientId,
          interactionId: input.interactionId,
          correlationId: correlationId(response),
          segments: input.segments.map(transcriptSegment),
          facts: input.facts,
        }),
      );
    }),
  );

  app.post(
    "/api/corti/dictation/revision-preview",
    route(async (request, response) => {
      const input = revisionPreviewSchema.parse(request.body);
      response.json(
        parseDictatedRevision({
          taskId: input.taskId,
          expectedVersion: input.expectedVersion,
          idempotencyKey: input.idempotencyKey,
          transcript: input.transcript,
          recipientTeams: input.recipientTeams.map(directoryOption),
        }),
      );
    }),
  );

  app.post(
    "/api/corti/documents/generate",
    route(async (request, response) => {
      const input = supportingDocumentSchema.parse(request.body);
      response.json(await requireGateway().generateSupportingDocument(input));
    }),
  );

  app.post(
    "/api/corti/handovers/render",
    route(async (request, response) => {
      const input = renderHandoverRequestSchema.parse(request.body);
      response.json(await requireGateway().renderHandover(input));
    }),
  );

  app.post(
    "/api/corti/coding/predict",
    route(async (request, response) => {
      const input = codingRequestSchema.parse(request.body);
      response.json(
        await requireGateway().predictCodes(
          input.system === undefined
            ? {
                approvalId: input.approvalId,
                approvedClinicalText: input.approvedClinicalText,
              }
            : {
                approvalId: input.approvalId,
                approvedClinicalText: input.approvedClinicalText,
                system: input.system,
              },
        ),
      );
    }),
  );

  app.use((_request, response) => {
    response.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Pipeline route not found.",
        retryable: false,
        correlationId: correlationId(response),
      },
    });
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    const id = correlationId(response);
    if (error instanceof ZodError) {
      response.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: "The pipeline request did not match the documented contract.",
          retryable: false,
          correlationId: id,
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      });
      return;
    }

    if (error instanceof PipelineError) {
      response.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          correlationId: id,
        },
      });
      return;
    }

    response.status(500).json({
      error: {
        code: "PIPELINE_INTERNAL_ERROR",
        message: "The pipeline could not complete the request.",
        retryable: false,
        correlationId: id,
      },
    });
  };
  app.use(errorHandler);

  return app;
}
