import { randomUUID, timingSafeEqual } from "node:crypto";

import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { ZodError } from "zod";

import {
  createDocumentSchema,
  ehrIdentifierSchema,
  fileDocumentSchema,
  reviseDocumentSchema,
} from "./contracts.js";
import { MockEhrError } from "./errors.js";
import { mockEhrOpenApi } from "./openapi.js";
import type { MockEhrService } from "./service.js";

const safeCorrelationId = /^[A-Za-z0-9._-]{1,100}$/;
const safeActorId = /^[A-Za-z0-9:._-]{1,120}$/;

interface CreateAppOptions {
  service: MockEhrService;
  bearerToken: string;
}

export function createMockEhrApp(options: CreateAppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));
  app.use((request, response, next) => {
    const supplied = request.header("x-correlation-id");
    const correlationId =
      supplied !== undefined && safeCorrelationId.test(supplied)
        ? supplied
        : randomUUID();
    response.locals.correlationId = correlationId;
    response.setHeader("x-correlation-id", correlationId);
    response.setHeader("cache-control", "no-store");
    next();
  });

  app.get("/healthz", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.get("/openapi.json", (_request, response) => {
    response.json(mockEhrOpenApi);
  });

  app.use("/api", requireBearer(options.bearerToken));

  app.post(
    "/api/patients/:patientId/documents",
    route((request, response) => {
      const patientId = identifier(request, "patientId");
      const input = createDocumentSchema.parse(request.body);
      response.status(201).json(
        options.service.createDocument(
          patientId,
          input,
          actorId(request),
          correlationId(response),
        ),
      );
    }),
  );

  app.get(
    "/api/patients/:patientId/documents",
    route((request, response) => {
      const patientId = identifier(request, "patientId");
      response.json({
        documents: options.service.listPatientDocuments(patientId),
      });
    }),
  );

  app.get(
    "/api/documents/:documentId",
    route((request, response) => {
      response.json(options.service.getDocument(identifier(request, "documentId")));
    }),
  );

  app.patch(
    "/api/documents/:documentId",
    route((request, response) => {
      const input = reviseDocumentSchema.parse(request.body);
      response.json(
        options.service.reviseDocument(
          identifier(request, "documentId"),
          input,
          actorId(request),
          correlationId(response),
        ),
      );
    }),
  );

  app.post(
    "/api/documents/:documentId/file",
    route((request, response) => {
      const input = fileDocumentSchema.parse(request.body);
      response.json(
        options.service.fileDocument(
          identifier(request, "documentId"),
          input,
          actorId(request),
          correlationId(response),
        ),
      );
    }),
  );

  app.get(
    "/api/documents/:documentId/history",
    route((request, response) => {
      response.json({
        versions: options.service.listHistory(identifier(request, "documentId")),
      });
    }),
  );

  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    _next,
  ) => {
    const value =
      error instanceof MockEhrError
        ? error
        : error instanceof ZodError
          ? new MockEhrError(
              "VALIDATION_ERROR",
              error.issues.map((issue) => issue.message).join("; "),
            )
          : new MockEhrError("INTERNAL_ERROR", "Request failed", 500, true);
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

function requireBearer(expectedToken: string) {
  const expected = Buffer.from(expectedToken);
  return (request: Request, _response: Response, next: NextFunction) => {
    const authorization = request.header("authorization");
    const supplied =
      authorization?.startsWith("Bearer ") === true
        ? Buffer.from(authorization.slice("Bearer ".length))
        : Buffer.alloc(0);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      next(new MockEhrError("UNAUTHORIZED", "Unauthorized", 401));
      return;
    }
    next();
  };
}

function actorId(request: Request): string {
  const value = request.header("x-actor-id");
  if (value === undefined || !safeActorId.test(value)) {
    throw new MockEhrError("ACTOR_REQUIRED", "x-actor-id is required");
  }
  return value;
}

function identifier(request: Request, name: string): string {
  return ehrIdentifierSchema.parse(pathParam(request, name));
}

function pathParam(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new MockEhrError("VALIDATION_ERROR", `Missing path parameter: ${name}`);
  }
  return value;
}

function correlationId(response: Response): string {
  const value = response.locals.correlationId;
  return typeof value === "string" ? value : randomUUID();
}

function route(handler: (request: Request, response: Response) => void) {
  return (request: Request, response: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => handler(request, response))
      .catch(next);
  };
}
