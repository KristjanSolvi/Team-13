const patientPathParameter = {
  name: "patientId",
  in: "path",
  required: true,
  schema: { type: "string", pattern: "^[A-Za-z0-9:._-]{1,160}$" },
} as const;

const secured = [{ serviceBearer: [] }] as const;

export const patientProfileOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "Fluence Patient Profile API",
    version: "0.1.0",
    description:
      "Private service for versioned manual patient details and immutable referral-input snapshots.",
  },
  servers: [{ url: "http://127.0.0.1:8791" }],
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
    "/api/patients/{patientId}/profile": {
      post: {
        summary: "Create a patient profile",
        security: secured,
        parameters: [
          patientPathParameter,
          { $ref: "#/components/parameters/ActorId" },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateProfile" },
            },
          },
        },
        responses: {
          "201": profileResponse("Profile created"),
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "409": { $ref: "#/components/responses/Error" },
        },
      },
      get: {
        summary: "Read the current patient profile",
        security: secured,
        parameters: [
          patientPathParameter,
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        responses: {
          "200": profileResponse("Current patient profile"),
          "401": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
        },
      },
      patch: {
        summary: "Apply an attributed, version-checked profile update",
        security: secured,
        parameters: [
          patientPathParameter,
          { $ref: "#/components/parameters/ActorId" },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UpdateProfile" },
            },
          },
        },
        responses: {
          "200": profileResponse("Updated patient profile"),
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
          "409": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/patients/{patientId}/profile/history": {
      get: {
        summary: "Read the complete profile version history",
        security: secured,
        parameters: [
          patientPathParameter,
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        responses: {
          "200": {
            description: "Newest profile version first",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["versions"],
                  properties: {
                    versions: {
                      type: "array",
                      items: { $ref: "#/components/schemas/ProfileVersion" },
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/patients/{patientId}/referral-snapshots": {
      post: {
        summary: "Freeze the current profile as referral input",
        security: secured,
        parameters: [
          patientPathParameter,
          { $ref: "#/components/parameters/ActorId" },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateReferralSnapshot" },
            },
          },
        },
        responses: {
          "201": referralResponse("Referral snapshot created"),
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
          "409": { $ref: "#/components/responses/Error" },
        },
      },
      get: {
        summary: "List patient referral snapshots",
        security: secured,
        parameters: [
          patientPathParameter,
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        responses: {
          "200": {
            description: "Newest referral snapshot first",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["referrals"],
                  properties: {
                    referrals: {
                      type: "array",
                      items: { $ref: "#/components/schemas/ReferralSnapshot" },
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/referral-snapshots/{referralId}": {
      get: {
        summary: "Read one immutable referral snapshot",
        security: secured,
        parameters: [
          {
            name: "referralId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        responses: {
          "200": referralResponse("Referral snapshot"),
          "401": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
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
    responses: {
      Error: {
        description: "Safe structured error",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
    },
    schemas: {
      PatientProfileData: {
        type: "object",
        additionalProperties: false,
        required: [
          "displayName",
          "identifiers",
          "demographics",
          "location",
          "flow",
          "contact",
          "referralDetails",
        ],
        properties: {
          displayName: { type: "string" },
          identifiers: objectWithNullableStrings([
            "medicalRecordNumber",
            "nationalHealthId",
          ]),
          demographics: {
            type: "object",
            additionalProperties: false,
            required: ["dateOfBirth", "pronouns"],
            properties: {
              dateOfBirth: { type: ["string", "null"], format: "date" },
              pronouns: { type: ["string", "null"] },
            },
          },
          location: objectWithNullableStrings(["bed", "bay"]),
          flow: {
            type: "object",
            additionalProperties: false,
            required: ["todaySchedule", "waitingFor", "homeTomorrow"],
            properties: {
              todaySchedule: { type: ["string", "null"] },
              waitingFor: { type: ["string", "null"] },
              homeTomorrow: { type: "boolean" },
            },
          },
          contact: objectWithNullableStrings(["phone", "email", "address"]),
          referralDetails: {
            type: "object",
            additionalProperties: false,
            required: [
              "preferredLanguage",
              "interpreterRequired",
              "mobilityNeeds",
              "transportNeeds",
              "homeSupport",
              "additionalDetails",
            ],
            properties: {
              preferredLanguage: { type: ["string", "null"] },
              interpreterRequired: { type: "boolean" },
              mobilityNeeds: { type: ["string", "null"] },
              transportNeeds: { type: ["string", "null"] },
              homeSupport: { type: ["string", "null"] },
              additionalDetails: { type: ["string", "null"] },
            },
          },
        },
      },
      PatientProfile: {
        type: "object",
        required: [
          "schemaVersion",
          "patientId",
          "profile",
          "version",
          "createdAt",
          "updatedAt",
          "updatedBy",
        ],
        properties: {
          schemaVersion: { const: "1" },
          patientId: { type: "string" },
          profile: { $ref: "#/components/schemas/PatientProfileData" },
          version: { type: "integer", minimum: 1 },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          updatedBy: { type: "string" },
        },
      },
      ProfileVersion: {
        allOf: [
          { $ref: "#/components/schemas/PatientProfile" },
          {
            type: "object",
            required: ["changeReason"],
            properties: { changeReason: { type: "string" } },
          },
        ],
      },
      CreateProfile: {
        type: "object",
        required: ["idempotencyKey", "profile"],
        properties: {
          idempotencyKey: { type: "string", minLength: 8 },
          profile: { $ref: "#/components/schemas/PatientProfileData" },
        },
      },
      UpdateProfile: {
        type: "object",
        required: ["expectedVersion", "idempotencyKey", "reason", "changes"],
        properties: {
          expectedVersion: { type: "integer", minimum: 1 },
          idempotencyKey: { type: "string", minLength: 8 },
          reason: { type: "string", minLength: 3 },
          changes: { type: "object", minProperties: 1 },
        },
      },
      CreateReferralSnapshot: {
        type: "object",
        required: [
          "idempotencyKey",
          "referralType",
          "destination",
          "clinicalReason",
          "additionalInstructions",
        ],
        properties: {
          idempotencyKey: { type: "string", minLength: 8 },
          referralType: { type: "string" },
          destination: { type: "string" },
          clinicalReason: { type: "string" },
          additionalInstructions: { type: ["string", "null"] },
        },
      },
      ReferralSnapshot: {
        type: "object",
        required: [
          "schemaVersion",
          "referralId",
          "patientId",
          "referralType",
          "destination",
          "clinicalReason",
          "additionalInstructions",
          "profileVersion",
          "patientProfile",
          "createdAt",
          "createdBy",
          "correlationId",
          "currentProfileVersion",
          "profileChanged",
        ],
        properties: {
          schemaVersion: { const: "1" },
          referralId: { type: "string" },
          patientId: { type: "string" },
          referralType: { type: "string" },
          destination: { type: "string" },
          clinicalReason: { type: "string" },
          additionalInstructions: { type: ["string", "null"] },
          profileVersion: { type: "integer", minimum: 1 },
          patientProfile: { $ref: "#/components/schemas/PatientProfileData" },
          createdAt: { type: "string", format: "date-time" },
          createdBy: { type: "string" },
          correlationId: { type: "string" },
          currentProfileVersion: { type: "integer", minimum: 1 },
          profileChanged: { type: "boolean" },
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

function profileResponse(description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/PatientProfile" },
      },
    },
  } as const;
}

function referralResponse(description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ReferralSnapshot" },
      },
    },
  } as const;
}

function objectWithNullableStrings<const T extends readonly string[]>(keys: T) {
  return {
    type: "object",
    additionalProperties: false,
    required: keys,
    properties: Object.fromEntries(
      keys.map((key) => [key, { type: ["string", "null"] }]),
    ),
  } as const;
}
