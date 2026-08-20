import { randomUUID } from "node:crypto";

import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { ZodError } from "zod";

import {
  candidateSchema,
  isTaskCommand,
  taskCommandSchemas,
} from "./contracts.js";
import { IntegrationError } from "./errors.js";
import type { IntegrationService } from "./service.js";

const safeCorrelationId = /^[A-Za-z0-9._-]{1,100}$/;

export interface CreateIntegrationAppOptions {
  service: IntegrationService;
  allowedOrigins?: string[];
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
        "content-type,x-actor-id,x-correlation-id,last-event-id",
      );
      response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
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
      const actorId = request.header("x-actor-id");
      if (actorId === undefined || actorId.trim().length === 0) {
        throw new IntegrationError(
          "ACTOR_REQUIRED",
          "x-actor-id is required",
        );
      }
      const body = taskCommandSchemas[command].parse(request.body) as Record<
        string,
        unknown
      >;
      response.json(
        await options.service.executeTaskCommand(
          taskId,
          command,
          body,
          { actorId, correlationId: correlationId(response) },
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

function route(
  handler: (request: Request, response: Response) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request, response).catch(next);
  };
}
