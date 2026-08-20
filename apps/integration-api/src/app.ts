import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { ZodError } from "zod";

import {
  candidateSchema,
  demoAssignmentSchema,
  demoJoinSchema,
  demoSessionCreateSchema,
  ehrCreateDocumentSchema,
  ehrFileDocumentSchema,
  ehrProfileUpdateSchema,
  ehrReviseDocumentSchema,
  handoverRequestSchema,
  isTaskCommand,
  pipelineProxyPaths,
  taskCommandSchemas,
} from "./contracts.js";
import { IntegrationError } from "./errors.js";
import { integrationOpenApi } from "./openapi.js";
import type { IntegrationService } from "./service.js";

const safeCorrelationId = /^[A-Za-z0-9._-]{1,100}$/;
const safeActorId = /^[A-Za-z0-9:._-]{1,120}$/;
const safeEhrIdentifier = /^[A-Za-z0-9:._-]{1,160}$/;

export interface CreateIntegrationAppOptions {
  service: IntegrationService;
  allowedOrigins?: string[];
  integrationApiBearerToken: string;
}

export function createIntegrationApp(options: CreateIntegrationAppOptions) {
  const app = express();
  const origins = new Set(options.allowedOrigins ?? []);

  app.disable("x-powered-by");
  app.use(express.json({ limit: "512kb" }));
  app.use((request, response, next) => {
    const supplied = request.header("x-correlation-id");
    const correlationId =
      supplied !== undefined && safeCorrelationId.test(supplied)
        ? supplied
        : randomUUID();
    response.locals.correlationId = correlationId;
    response.setHeader("x-correlation-id", correlationId);
    response.setHeader("cache-control", "no-store");

    const origin = request.header("origin");
    if (origin !== undefined && origins.has(origin)) {
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("vary", "Origin");
      response.setHeader(
        "access-control-allow-headers",
        "authorization,content-type,x-actor-id,x-correlation-id,last-event-id",
      );
      response.setHeader("access-control-allow-methods", "GET,POST,PATCH,OPTIONS");
    }
    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }
    next();
  });

  app.get("/healthz", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.get("/openapi.json", (_request, response) => {
    response.json(integrationOpenApi);
  });

  app.get(
    "/readyz",
    route(async (_request, response) => {
      const status = await options.service.readiness();
      response.status(status.status === "ready" ? 200 : 503).json(status);
    }),
  );

  app.post(
    "/api/candidates/investigate",
    route(async (request, response) => {
      const candidate = candidateSchema.parse(request.body);
      response
        .status(202)
        .json(
          await options.service.investigateCandidate(
            candidate,
            correlationId(response),
          ),
        );
    }),
  );

  for (const pipelinePath of pipelineProxyPaths) {
    app.post(
      pipelinePath,
      route(async (request, response) => {
        const result = await options.service.pipelineRequest(
          pipelinePath,
          request.body,
          correlationId(response),
        );
        response.status(result.status).json(result.body);
      }),
    );
  }

  app.get("/api/events/stream", async (request, response, next) => {
    const lastEventId = request.header("last-event-id");
    if (lastEventId !== undefined && !/^\d+$/.test(lastEventId)) {
      next(
        new IntegrationError(
          "INVALID_EVENT_SEQUENCE",
          "Last-Event-ID must be a non-negative integer sequence",
        ),
      );
      return;
    }

    const controller = new AbortController();
    request.once("aborted", () => controller.abort());
    response.once("close", () => controller.abort());
    try {
      const stream = await options.service.eventStream(
        lastEventId,
        correlationId(response),
        controller.signal,
      );
      response.status(200);
      response.setHeader("content-type", "text/event-stream");
      response.setHeader("cache-control", "no-cache");
      response.setHeader("connection", "keep-alive");
      response.flushHeaders();

      const reader = stream.getReader();
      try {
        while (!response.destroyed) {
          const chunk = await reader.read();
          if (chunk.done) break;
          response.write(Buffer.from(chunk.value));
        }
      } finally {
        reader.releaseLock();
      }
      if (!response.writableEnded && !response.destroyed) {
        response.end();
      }
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      next(error);
    }
  });

  app.get(
    "/api/patients/:patientId/overview",
    route(async (request, response) => {
      const patientId = pathParam(request, "patientId");
      response.json(
        await options.service.patientOverview(
          patientId,
          correlationId(response),
        ),
      );
    }),
  );

  app.get(
    "/api/patients/:patientId/companion",
    route(async (request, response) => {
      const patientId = pathParam(request, "patientId");
      response.json(
        await options.service.wardCompanionOverview(
          patientId,
          correlationId(response),
        ),
      );
    }),
  );

  app.post(
    "/api/patients/:patientId/handovers",
    requireIntegrationBearer(options.integrationApiBearerToken),
    route(async (request, response) => {
      const meta = requestMeta(request, response);
      const result = await options.service.requestHandover(
        pathParam(request, "patientId"),
        handoverRequestSchema.parse(request.body),
        meta,
      );
      response.status(result.status).json(result.body);
    }),
  );

  app.get(
    "/api/ehr/patients/:patientId",
    route(async (request, response) => {
      response.json(
        await options.service.ehrPatientRecord(
          ehrIdentifier(request, "patientId"),
          correlationId(response),
        ),
      );
    }),
  );

  app.patch(
    "/api/ehr/patients/:patientId/profile",
    route(async (request, response) => {
      response.json(
        await options.service.updateEhrProfile(
          ehrIdentifier(request, "patientId"),
          ehrProfileUpdateSchema.parse(request.body),
          requestMeta(request, response),
        ),
      );
    }),
  );

  app.post(
    "/api/ehr/patients/:patientId/documents",
    route(async (request, response) => {
      response.status(201).json(
        await options.service.createEhrDocument(
          ehrIdentifier(request, "patientId"),
          ehrCreateDocumentSchema.parse(request.body),
          requestMeta(request, response),
        ),
      );
    }),
  );

  app.patch(
    "/api/ehr/documents/:documentId",
    route(async (request, response) => {
      response.json(
        await options.service.reviseEhrDocument(
          ehrIdentifier(request, "documentId"),
          ehrReviseDocumentSchema.parse(request.body),
          requestMeta(request, response),
        ),
      );
    }),
  );

  app.post(
    "/api/ehr/documents/:documentId/file",
    route(async (request, response) => {
      response.json(
        await options.service.fileEhrDocument(
          ehrIdentifier(request, "documentId"),
          ehrFileDocumentSchema.parse(request.body),
          requestMeta(request, response),
        ),
      );
    }),
  );

  app.get(
    "/api/ehr/documents/:documentId/history",
    route(async (request, response) => {
      response.json(
        await options.service.ehrDocumentHistory(
          ehrIdentifier(request, "documentId"),
          correlationId(response),
        ),
      );
    }),
  );

  app.post(
    "/api/demo/sessions",
    route(async (request, response) => {
      response.status(201).json(
        await options.service.createDemoSession(
          demoSessionCreateSchema.parse(request.body),
          requestMeta(request, response),
        ),
      );
    }),
  );

  app.get(
    "/api/demo/sessions/:sessionId",
    route(async (request, response) => {
      response.json(
        await options.service.getDemoSession(
          pathParam(request, "sessionId"),
          correlationId(response),
        ),
      );
    }),
  );

  app.post(
    "/api/demo/join/:joinCode",
    route(async (request, response) => {
      response.status(201).json(
        await options.service.joinDemoSession(
          pathParam(request, "joinCode"),
          demoJoinSchema.parse(request.body),
          correlationId(response),
        ),
      );
    }),
  );

  app.post(
    "/api/demo/sessions/:sessionId/assign",
    route(async (request, response) => {
      response.json(
        await options.service.assignDemoTask(
          pathParam(request, "sessionId"),
          demoAssignmentSchema.parse(request.body),
          requestMeta(request, response),
        ),
      );
    }),
  );

  app.get(
    "/api/demo/participants/me",
    route(async (request, response) => {
      response.json(
        await options.service.demoParticipantView(
          participantToken(request),
          correlationId(response),
        ),
      );
    }),
  );

  app.post(
    "/api/tasks/:taskId/:command",
    route(async (request, response) => {
      const taskId = pathParam(request, "taskId");
      const command = pathParam(request, "command");
      if (!isTaskCommand(command)) {
        throw new IntegrationError(
          "COMMAND_NOT_SUPPORTED",
          "Task command is not supported",
          404,
        );
      }
      const actor = actorId(request);
      const body = taskCommandSchemas[command].parse(request.body) as Record<
        string,
        unknown
      >;
      response.json(
        await options.service.executeTaskCommand(
          taskId,
          command,
          body,
          { actorId: actor, correlationId: correlationId(response) },
        ),
      );
    }),
  );

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    const value =
      error instanceof IntegrationError
        ? error
        : error instanceof ZodError
          ? new IntegrationError(
              "VALIDATION_ERROR",
              error.issues.map((issue) => issue.message).join("; "),
            )
          : new IntegrationError(
              "INTERNAL_ERROR",
              "Request failed",
              500,
              true,
            );
    response.status(value.status).json({
      error: {
        code: value.code,
        message: value.message,
        retryable: value.retryable,
        correlationId: correlationId(response),
      },
    });
  };
  app.use(errorHandler);

  return app;
}

function requireIntegrationBearer(expectedToken: string) {
  const expectedDigest = tokenDigest(expectedToken);
  return (request: Request, _response: Response, next: NextFunction) => {
    const authorization = request.header("authorization") ?? "";
    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    const candidate = match?.[1] ?? "";
    const authenticated = timingSafeEqual(
      tokenDigest(candidate),
      expectedDigest,
    );
    if (match === null || !authenticated) {
      next(
        new IntegrationError(
          "UNAUTHORIZED",
          "Authentication required",
          401,
          false,
        ),
      );
      return;
    }
    next();
  };
}

function tokenDigest(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

function correlationId(response: Response): string {
  const value = response.locals.correlationId;
  return typeof value === "string" ? value : randomUUID();
}

function pathParam(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new IntegrationError(
      "VALIDATION_ERROR",
      `Missing path parameter: ${name}`,
    );
  }
  return value;
}

function ehrIdentifier(request: Request, name: string): string {
  const value = pathParam(request, name);
  if (!safeEhrIdentifier.test(value)) {
    throw new IntegrationError(
      "VALIDATION_ERROR",
      `Invalid EHR identifier: ${name}`,
    );
  }
  return value;
}

function actorId(request: Request): string {
  const value = request.header("x-actor-id");
  if (value === undefined || !safeActorId.test(value)) {
    throw new IntegrationError("ACTOR_REQUIRED", "x-actor-id is required");
  }
  return value;
}

function participantToken(request: Request): string {
  const authorization = request.header("authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,200})$/);
  if (!match?.[1]) {
    throw new IntegrationError(
      "DEMO_PARTICIPANT_AUTH_REQUIRED",
      "Demo participant authentication is required",
      401,
    );
  }
  return match[1];
}

function requestMeta(request: Request, response: Response) {
  return {
    actorId: actorId(request),
    correlationId: correlationId(response),
  };
}

function route(
  handler: (request: Request, response: Response) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request, response).catch(next);
  };
}
