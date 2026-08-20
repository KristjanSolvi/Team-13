import { randomUUID, timingSafeEqual } from "node:crypto";

import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { ZodError } from "zod";

import {
  acknowledgeReadbackSchema,
  createDeliverySchema,
  deliveryIdSchema,
  simulateProviderStatusSchema,
} from "./contracts.js";
import { DownstreamError } from "./errors.js";
import { downstreamOpenApi } from "./openapi.js";
import type { DownstreamGatewayService } from "./service.js";

const safeCorrelationId = /^[A-Za-z0-9._-]{1,100}$/;
const safeActorId = /^[A-Za-z0-9:._-]{1,120}$/;

interface CreateAppOptions {
  service: DownstreamGatewayService;
  bearerToken: string;
}

export function createDownstreamApp(options: CreateAppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    const supplied = request.header("x-correlation-id");
    const value =
      supplied !== undefined && safeCorrelationId.test(supplied)
        ? supplied
        : randomUUID();
    response.locals.correlationId = value;
    response.setHeader("x-correlation-id", value);
    response.setHeader("cache-control", "no-store");
    next();
  });
  app.use(express.json({ limit: "128kb" }));

  app.get("/healthz", (_request, response) => {
    response.json({ status: "ok" });
  });
  app.get("/openapi.json", (_request, response) => {
    response.json(downstreamOpenApi);
  });

  app.use("/api", requireBearer(options.bearerToken));

  app.post(
    "/api/deliveries",
    route(async (request, response) => {
      const input = createDeliverySchema.parse(request.body);
      response.status(201).json(
        await options.service.createDelivery(
          input,
          actorId(request),
          correlationId(response),
        ),
      );
    }),
  );

  app.get(
    "/api/deliveries/:deliveryId",
    route((request, response) => {
      response.json(
        options.service.getDelivery(
          deliveryIdSchema.parse(pathParam(request, "deliveryId")),
        ),
      );
    }),
  );

  app.get(
    "/api/tasks/:sourceTaskId/deliveries",
    route((request, response) => {
      response.json({
        deliveries: options.service.listTaskDeliveries(
          deliveryIdSchema.parse(pathParam(request, "sourceTaskId")),
        ),
      });
    }),
  );

  app.get(
    "/api/deliveries/:deliveryId/events",
    route((request, response) => {
      response.json({
        events: options.service.listEvents(
          deliveryIdSchema.parse(pathParam(request, "deliveryId")),
        ),
      });
    }),
  );

  app.get("/api/pending-readbacks", (_request, response) => {
    response.json({ deliveries: options.service.listPendingReadbacks() });
  });

  app.post(
    "/api/deliveries/:deliveryId/readback",
    route(async (request, response) => {
      response.json(
        await options.service.readback(
          deliveryIdSchema.parse(pathParam(request, "deliveryId")),
        ),
      );
    }),
  );

  app.post(
    "/api/deliveries/:deliveryId/acknowledge",
    route((request, response) => {
      const input = acknowledgeReadbackSchema.parse(request.body);
      response.json(
        options.service.acknowledgeReadback(
          deliveryIdSchema.parse(pathParam(request, "deliveryId")),
          input.outcomeReference,
          actorId(request),
        ),
      );
    }),
  );

  app.post(
    "/api/simulation/deliveries/:deliveryId/status",
    route(async (request, response) => {
      response.json(
        await options.service.simulateProviderStatus(
          deliveryIdSchema.parse(pathParam(request, "deliveryId")),
          simulateProviderStatusSchema.parse(request.body),
          actorId(request),
        ),
      );
    }),
  );

  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    _next,
  ) => {
    const value = normalizeError(error);
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

function normalizeError(error: unknown): DownstreamError {
  if (error instanceof DownstreamError) return error;
  if (error instanceof ZodError) {
    return new DownstreamError(
      "VALIDATION_ERROR",
      error.issues.map((issue) => issue.message).join("; "),
    );
  }
  if (
    error instanceof SyntaxError &&
    "status" in error &&
    (error as SyntaxError & { status?: unknown }).status === 400
  ) {
    return new DownstreamError("INVALID_JSON", "Request body is not valid JSON");
  }
  return new DownstreamError("INTERNAL_ERROR", "Request failed", 500, true);
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
      next(new DownstreamError("UNAUTHORIZED", "Unauthorized", 401));
      return;
    }
    next();
  };
}

function actorId(request: Request): string {
  const value = request.header("x-actor-id");
  if (value === undefined || !safeActorId.test(value)) {
    throw new DownstreamError("ACTOR_REQUIRED", "x-actor-id is required");
  }
  return value;
}

function pathParam(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new DownstreamError("VALIDATION_ERROR", `Missing path parameter: ${name}`);
  }
  return value;
}

function correlationId(response: Response): string {
  const value = response.locals.correlationId;
  return typeof value === "string" ? value : randomUUID();
}

function route(
  handler: (request: Request, response: Response) => void | Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => handler(request, response))
      .catch(next);
  };
}
