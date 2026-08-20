import { randomUUID, timingSafeEqual } from "node:crypto";

import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { ZodError } from "zod";

import {
  createProfileSchema,
  createReferralSnapshotSchema,
  patientIdSchema,
  updateProfileSchema,
} from "./contracts.js";
import { ProfileError } from "./errors.js";
import { patientProfileOpenApi } from "./openapi.js";
import type { PatientProfileService } from "./service.js";

const safeCorrelationId = /^[A-Za-z0-9._-]{1,100}$/;
const safeActorId = /^[A-Za-z0-9:._-]{1,120}$/;

interface CreateAppOptions {
  service: PatientProfileService;
  bearerToken: string;
}

export function createPatientProfileApp(options: CreateAppOptions) {
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
    response.json(patientProfileOpenApi);
  });

  app.use("/api", requireBearer(options.bearerToken));

  app.post(
    "/api/patients/:patientId/profile",
    route((request, response) => {
      const patientId = patientIdSchema.parse(pathParam(request, "patientId"));
      const body = createProfileSchema.parse(request.body);
      response
        .status(201)
        .json(options.service.createProfile(patientId, body, actorId(request)));
    }),
  );

  app.get(
    "/api/patients/:patientId/profile",
    route((request, response) => {
      const patientId = patientIdSchema.parse(pathParam(request, "patientId"));
      response.json(options.service.getProfile(patientId));
    }),
  );

  app.patch(
    "/api/patients/:patientId/profile",
    route((request, response) => {
      const patientId = patientIdSchema.parse(pathParam(request, "patientId"));
      const body = updateProfileSchema.parse(request.body);
      response.json(
        options.service.updateProfile(patientId, body, actorId(request)),
      );
    }),
  );

  app.get(
    "/api/patients/:patientId/profile/history",
    route((request, response) => {
      const patientId = patientIdSchema.parse(pathParam(request, "patientId"));
      response.json({ versions: options.service.listHistory(patientId) });
    }),
  );

  app.post(
    "/api/patients/:patientId/referral-snapshots",
    route((request, response) => {
      const patientId = patientIdSchema.parse(pathParam(request, "patientId"));
      const body = createReferralSnapshotSchema.parse(request.body);
      response.status(201).json(
        options.service.createReferralSnapshot(
          patientId,
          body,
          actorId(request),
          correlationId(response),
        ),
      );
    }),
  );

  app.get(
    "/api/patients/:patientId/referral-snapshots",
    route((request, response) => {
      const patientId = patientIdSchema.parse(pathParam(request, "patientId"));
      response.json({
        referrals: options.service.listReferralSnapshots(patientId),
      });
    }),
  );

  app.get(
    "/api/referral-snapshots/:referralId",
    route((request, response) => {
      response.json(
        options.service.getReferralSnapshot(
          patientIdSchema.parse(pathParam(request, "referralId")),
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
    const value =
      error instanceof ProfileError
        ? error
        : error instanceof ZodError
          ? new ProfileError(
              "VALIDATION_ERROR",
              error.issues.map((issue) => issue.message).join("; "),
            )
          : new ProfileError("INTERNAL_ERROR", "Request failed", 500, true);
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
      next(new ProfileError("UNAUTHORIZED", "Unauthorized", 401));
      return;
    }
    next();
  };
}

function actorId(request: Request): string {
  const value = request.header("x-actor-id");
  if (value === undefined || !safeActorId.test(value)) {
    throw new ProfileError("ACTOR_REQUIRED", "x-actor-id is required");
  }
  return value;
}

function pathParam(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new ProfileError("VALIDATION_ERROR", `Missing path parameter: ${name}`);
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
