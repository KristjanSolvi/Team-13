const secured = [{ serviceBearer: [] }] as const;
const deliveryIdParameter = {
  name: "deliveryId",
  in: "path",
  required: true,
  schema: { type: "string", pattern: "^[A-Za-z0-9:._-]{1,160}$" },
} as const;
const actorParameter = { $ref: "#/components/parameters/ActorId" } as const;
const correlationParameter = {
  $ref: "#/components/parameters/CorrelationId",
} as const;
const errorResponse = {
  description: "Safe structured error",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
    },
  },
} as const;
const readbackResponse = {
  description: "Independent provider readback",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Readback" },
    },
  },
} as const;

export const downstreamOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "Follow-Through Downstream Gateway API",
    version: "0.1.0",
    description:
      "Private delivery and independent-readback boundary. The checked-in provider is explicitly simulated; real adapters implement the same contract.",
  },
  servers: [{ url: "http://127.0.0.1:8792" }],
  paths: {
    "/healthz": {
      get: {
        summary: "Process liveness",
        responses: {
          "200": {
            description: "Service is alive",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["status"],
                  properties: { status: { const: "ok" } },
                },
              },
            },
          },
        },
      },
    },
    "/api/deliveries": {
      post: {
        summary: "Record an intent and submit it idempotently to a provider",
        security: secured,
        parameters: [actorParameter, correlationParameter],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateDelivery" },
            },
          },
        },
        responses: {
          "201": deliveryResponse("Delivery submitted"),
          "400": errorResponse,
          "401": errorResponse,
          "409": errorResponse,
          "502": errorResponse,
          "503": errorResponse,
        },
      },
    },
    "/api/deliveries/{deliveryId}": {
      get: {
        summary: "Read local delivery state",
        security: secured,
        parameters: [deliveryIdParameter, correlationParameter],
        responses: {
          "200": deliveryResponse("Delivery"),
          "401": errorResponse,
          "404": errorResponse,
        },
      },
    },
    "/api/tasks/{sourceTaskId}/deliveries": {
      get: {
        summary: "List delivery attempts for one Agentic task",
        security: secured,
        parameters: [
          {
            name: "sourceTaskId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          correlationParameter,
        ],
        responses: {
          "200": {
            description: "Deliveries",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["deliveries"],
                  properties: {
                    deliveries: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Delivery" },
                    },
                  },
                },
              },
            },
          },
          "401": errorResponse,
        },
      },
    },
    "/api/deliveries/{deliveryId}/events": {
      get: {
        summary: "Read the delivery audit trail",
        security: secured,
        parameters: [deliveryIdParameter, correlationParameter],
        responses: {
          "200": {
            description: "Oldest event first",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["events"],
                  properties: {
                    events: {
                      type: "array",
                      items: { $ref: "#/components/schemas/DeliveryEvent" },
                    },
                  },
                },
              },
            },
          },
          "401": errorResponse,
          "404": errorResponse,
        },
      },
    },
    "/api/pending-readbacks": {
      get: {
        summary: "List submitted work awaiting terminal provider status",
        security: secured,
        parameters: [correlationParameter],
        responses: {
          "200": {
            description: "Pending deliveries",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["deliveries"],
                  properties: {
                    deliveries: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Delivery" },
                    },
                  },
                },
              },
            },
          },
          "401": errorResponse,
        },
      },
    },
    "/api/deliveries/{deliveryId}/readback": {
      post: {
        summary: "Read provider state and record the observation",
        security: secured,
        parameters: [deliveryIdParameter, correlationParameter],
        responses: {
          "200": readbackResponse,
          "401": errorResponse,
          "404": errorResponse,
          "409": errorResponse,
          "503": errorResponse,
        },
      },
    },
    "/api/simulation/deliveries/{deliveryId}/status": {
      post: {
        summary: "Demo-only provider status transition",
        description:
          "Available only when simulation is explicitly enabled and the actor starts with downstream:.",
        security: secured,
        parameters: [deliveryIdParameter, actorParameter, correlationParameter],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SimulateStatus" },
            },
          },
        },
        responses: {
          "200": readbackResponse,
          "400": errorResponse,
          "401": errorResponse,
          "403": errorResponse,
          "404": errorResponse,
          "409": errorResponse,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      serviceBearer: { type: "http", scheme: "bearer" },
    },
    parameters: {
      ActorId: {
        name: "x-actor-id",
        in: "header",
        required: true,
        schema: { type: "string", pattern: "^[A-Za-z0-9:._-]{1,120}$" },
      },
      CorrelationId: {
        name: "x-correlation-id",
        in: "header",
        required: false,
        schema: { type: "string", pattern: "^[A-Za-z0-9._-]{1,100}$" },
      },
    },
    schemas: {
      CreateDelivery: {
        type: "object",
        additionalProperties: false,
        required: [
          "idempotencyKey",
          "sourceTaskId",
          "patientId",
          "targetSystem",
          "kind",
          "summary",
          "instructions",
          "dueAt",
          "referralSnapshotId",
        ],
        properties: {
          idempotencyKey: { type: "string", minLength: 8 },
          sourceTaskId: { type: "string" },
          patientId: { type: "string" },
          targetSystem: { type: "string" },
          kind: { enum: ["team-task", "referral", "callback"] },
          summary: { type: "string" },
          instructions: { type: ["string", "null"] },
          dueAt: { type: "string", format: "date-time" },
          referralSnapshotId: { type: ["string", "null"] },
        },
      },
      Delivery: {
        type: "object",
        required: [
          "schemaVersion",
          "deliveryId",
          "sourceTaskId",
          "patientId",
          "targetSystem",
          "kind",
          "summary",
          "instructions",
          "dueAt",
          "referralSnapshotId",
          "status",
          "externalReference",
          "outcomeReference",
          "statusReason",
          "createdAt",
          "updatedAt",
          "createdBy",
          "correlationId",
        ],
        properties: {
          schemaVersion: { const: "1" },
          deliveryId: { type: "string" },
          sourceTaskId: { type: "string" },
          patientId: { type: "string" },
          targetSystem: { type: "string" },
          kind: { enum: ["team-task", "referral", "callback"] },
          summary: { type: "string" },
          instructions: { type: ["string", "null"] },
          dueAt: { type: "string", format: "date-time" },
          referralSnapshotId: { type: ["string", "null"] },
          status: {
            enum: [
              "pending_submission",
              "submission_failed",
              "submitted",
              "accepted",
              "completed",
              "rejected",
            ],
          },
          externalReference: { type: ["string", "null"] },
          outcomeReference: { type: ["string", "null"] },
          statusReason: { type: ["string", "null"] },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          createdBy: { type: "string" },
          correlationId: { type: "string" },
        },
      },
      DeliveryEvent: {
        type: "object",
        required: [
          "sequence",
          "deliveryId",
          "eventType",
          "occurredAt",
          "actorId",
          "status",
          "details",
        ],
        properties: {
          sequence: { type: "integer", minimum: 1 },
          deliveryId: { type: "string" },
          eventType: { type: "string" },
          occurredAt: { type: "string", format: "date-time" },
          actorId: { type: "string" },
          status: { type: "string" },
          details: { type: "object" },
        },
      },
      SimulateStatus: {
        type: "object",
        additionalProperties: false,
        required: ["idempotencyKey", "status", "outcomeReference", "reason"],
        properties: {
          idempotencyKey: { type: "string", minLength: 8 },
          status: { enum: ["accepted", "completed", "rejected"] },
          outcomeReference: { type: ["string", "null"] },
          reason: { type: ["string", "null"] },
        },
      },
      Readback: {
        type: "object",
        required: [
          "schemaVersion",
          "deliveryId",
          "sourceTaskId",
          "externalReference",
          "status",
          "providerUpdatedAt",
          "outcomeReference",
          "reason",
          "observedAt",
          "verifierActorId",
          "independentlyVerifiable",
        ],
        properties: {
          schemaVersion: { const: "1" },
          deliveryId: { type: "string" },
          sourceTaskId: { type: "string" },
          externalReference: { type: "string" },
          status: { type: "string" },
          providerUpdatedAt: { type: "string", format: "date-time" },
          outcomeReference: { type: ["string", "null"] },
          reason: { type: ["string", "null"] },
          observedAt: { type: "string", format: "date-time" },
          verifierActorId: { type: "string" },
          independentlyVerifiable: { type: "boolean" },
        },
      },
      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message", "retryable", "correlationId"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              retryable: { type: "boolean" },
              correlationId: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;

function deliveryResponse(description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/Delivery" },
      },
    },
  } as const;
}
