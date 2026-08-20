function pipelineProxy(summary: string, successStatus: "200" | "201" = "200") {
  return {
    post: {
      summary,
      description:
        "Allow-listed pass-through to the Corti pipeline. Request and response bodies follow the pipeline contract.",
      parameters: [{ $ref: "#/components/parameters/CorrelationId" }],
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: { type: "object", additionalProperties: true },
          },
        },
      },
      responses: {
        [successStatus]: {
          description: "Successful pipeline response",
          content: {
            "application/json": {
              schema: { type: "object", additionalProperties: true },
            },
          },
        },
        "400": { $ref: "#/components/responses/Error" },
        "502": { $ref: "#/components/responses/Error" },
        "503": { $ref: "#/components/responses/Error" },
      },
    },
  } as const;
}

function handoverActivityVariant(eventType: string, payloadSchema: string) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["eventType", "occurredAt", "actor", "payload"],
    properties: {
      eventType: { const: eventType },
      occurredAt: { type: "string", format: "date-time" },
      actor: { $ref: "#/components/schemas/HandoverActivityActor" },
      payload: { $ref: `#/components/schemas/${payloadSchema}` },
    },
  } as const;
}

export const integrationOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "Follow-Through Integration API",
    version: "0.1.0",
    description:
      "Stateless UI-facing facade for the Corti pipeline and authoritative Agentic/MCP ledger.",
  },
  servers: [{ url: "http://127.0.0.1:8790" }],
  paths: {
    "/healthz": {
      get: {
        summary: "Process liveness",
        responses: {
          "200": {
            description: "The integration process is alive",
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
    "/readyz": {
      get: {
        summary: "Aggregate upstream readiness",
        responses: {
          "200": {
            description: "Both upstream services are reachable",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Readiness" },
              },
            },
          },
          "503": {
            description: "At least one upstream service is unavailable",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Readiness" },
              },
            },
          },
        },
      },
    },
    "/api/candidates/investigate": {
      post: {
        summary: "Retain a normalized pipeline candidate as an Agentic signal",
        parameters: [{ $ref: "#/components/parameters/CorrelationId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Candidate" },
            },
          },
        },
        responses: {
          "202": {
            description: "The candidate was handed to the Agentic backend",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["candidateId", "handoff"],
                  properties: {
                    candidateId: { type: "string" },
                    handoff: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/demo/sessions": {
      post: {
        summary: "Create an audience-participation demo session",
        parameters: [
          { $ref: "#/components/parameters/ActorId" },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DemoSessionCreate" },
            },
          },
        },
        responses: {
          "201": {
            description: "Session, QR join path, groups, and assignments",
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
          "409": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/demo/sessions/{sessionId}": {
      get: {
        summary: "Read the current demo groups and assignments",
        parameters: [
          { $ref: "#/components/parameters/DemoSessionId" },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        responses: {
          "200": {
            description: "Current session projection",
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
          "404": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/demo/join/{joinCode}": {
      post: {
        summary: "Join a solo or duo audience group from a QR code",
        parameters: [
          { $ref: "#/components/parameters/DemoJoinCode" },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DemoJoin" },
            },
          },
        },
        responses: {
          "201": {
            description: "Participant identity, group, and one-time participant token",
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/demo/sessions/{sessionId}/assign": {
      post: {
        summary: "Assign a published team task to one participant in a group",
        parameters: [
          { $ref: "#/components/parameters/DemoSessionId" },
          { $ref: "#/components/parameters/ActorId" },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DemoAssignment" },
            },
          },
        },
        responses: {
          "200": {
            description: "The selected participant and authoritative assigned task",
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
          "409": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/demo/participants/me": {
      get: {
        summary: "Read the current participant's assigned demo tasks",
        security: [{ DemoParticipantToken: [] }],
        parameters: [{ $ref: "#/components/parameters/CorrelationId" }],
        responses: {
          "200": {
            description: "Participant identity and assignments",
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
          "401": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/corti/ambient/session": pipelineProxy(
      "Create a Corti Ambient interaction and scoped browser session",
      "201",
    ),
    "/api/corti/ambient/token": pipelineProxy(
      "Refresh the scoped Corti Ambient browser token",
    ),
    "/api/corti/dictation/token": pipelineProxy(
      "Create a scoped Corti Dictation browser token",
    ),
    "/api/corti/candidates/generate": pipelineProxy(
      "Generate conservative follow-through candidates",
    ),
    "/api/corti/dictation/revision-preview": pipelineProxy(
      "Parse an intentional Dictation correction into a preview",
    ),
    "/api/corti/documents/generate": pipelineProxy(
      "Generate an approved supporting-document draft",
    ),
    "/api/corti/coding/predict": pipelineProxy(
      "Request evidence-linked medical coding suggestions",
    ),
    "/api/patients/{patientId}/overview": {
      get: {
        summary: "Read authoritative threads and tasks for one patient",
        parameters: [
          {
            name: "patientId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        responses: {
          "200": {
            description: "Authoritative patient follow-through projection",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PatientOverview" },
              },
            },
          },
          "502": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/patients/{patientId}/handovers": {
      post: {
        summary: "Generate or replay a grounded patient handover",
        description:
          "Creates a patient-scoped Agentic draft, renders it through the dedicated Corti pipeline operation, and finalizes it only while its source snapshot remains current.",
        parameters: [
          { $ref: "#/components/parameters/PatientId" },
          { $ref: "#/components/parameters/ActorId" },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/HandoverRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Existing handover replayed or saved draft resumed",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Handover" },
              },
            },
          },
          "201": {
            description: "New grounded handover generated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Handover" },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "403": { $ref: "#/components/responses/Error" },
          "409": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
          "503": { $ref: "#/components/responses/Error" },
          "504": { $ref: "#/components/responses/Error" },
        },
        security: [{ integrationBearer: [] }],
      },
    },
    "/api/ward-meetings": {
      post: {
        summary: "Start an Ambient ward meeting",
        description:
          "Creates the Corti Ambient browser session and the attributable ward-meeting ledger record as one public orchestration flow.",
        security: [{ integrationBearer: [] }],
        parameters: [
          { $ref: "#/components/parameters/ActorId" },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WardMeetingStart" },
            },
          },
        },
        responses: {
          "200": { description: "Existing meeting replayed" },
          "201": { description: "Ambient session and meeting created" },
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "409": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
          "503": { $ref: "#/components/responses/Error" },
          "504": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/ward-meetings/{meetingId}": {
      get: {
        summary: "Read a ward meeting and its patient segments",
        security: [{ integrationBearer: [] }],
        parameters: [
          { $ref: "#/components/parameters/MeetingId" },
          { $ref: "#/components/parameters/ActorId" },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        responses: {
          "200": { description: "Safe meeting projection" },
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/ward-meetings/{meetingId}/segments": {
      post: {
        summary: "Explicitly select the patient now being discussed",
        security: [{ integrationBearer: [] }],
        parameters: [
          { $ref: "#/components/parameters/MeetingId" },
          { $ref: "#/components/parameters/ActorId" },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/MeetingSegmentOpen" },
            },
          },
        },
        responses: {
          "200": { description: "Existing selected segment replayed" },
          "201": { description: "Patient segment opened" },
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
          "409": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/ward-meetings/{meetingId}/transcript-segments": {
      post: {
        summary: "Retain final Ambient transcript segments",
        description:
          "A null patientSegmentId retains unscoped meeting context but can never create patient evidence or a task.",
        security: [{ integrationBearer: [] }],
        parameters: [
          { $ref: "#/components/parameters/MeetingId" },
          { $ref: "#/components/parameters/ActorId" },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/MeetingTranscriptAppend",
              },
            },
          },
        },
        responses: {
          "200": { description: "Existing transcript append replayed" },
          "201": { description: "Final transcript retained" },
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
          "409": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/ward-meetings/{meetingId}/segments/{segmentId}/close": {
      post: {
        summary: "Close and automatically reconcile one patient discussion",
        description:
          "Freezes patient evidence, compares it with prior meeting context, handover and active tasks, then creates draft-only suggestions and carry-forward warnings.",
        security: [{ integrationBearer: [] }],
        parameters: [
          { $ref: "#/components/parameters/MeetingId" },
          { $ref: "#/components/parameters/SegmentId" },
          { $ref: "#/components/parameters/ActorId" },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/MeetingSegmentClose" },
            },
          },
        },
        responses: {
          "200": { description: "Close and reconciliation replayed" },
          "201": { description: "Segment closed and reconciled" },
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
          "409": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
          "503": { $ref: "#/components/responses/Error" },
          "504": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/ward-meetings/{meetingId}/complete": {
      post: {
        summary: "Complete a ward meeting after every patient segment closes",
        security: [{ integrationBearer: [] }],
        parameters: [
          { $ref: "#/components/parameters/MeetingId" },
          { $ref: "#/components/parameters/ActorId" },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WardMeetingComplete" },
            },
          },
        },
        responses: {
          "200": { description: "Meeting completed or replayed" },
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
          "409": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/patients/{patientId}/companion": {
      get: {
        summary: "Read a Ward Companion-compatible patient projection",
        description:
          "Maps authoritative Agentic threads and tasks into the current Ward Companion thread shape. Dismissed records are omitted and completed tasks remain tracking until verified.",
        parameters: [
          {
            name: "patientId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        responses: {
          "200": {
            description: "Ward Companion patient follow-through projection",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/WardCompanionOverview",
                },
              },
            },
          },
          "502": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/demo/patients/{patientId}/source-revisions": {
      post: {
        summary: "Inject the predefined synthetic source revision",
        description:
          "Demo-only trigger for synthetic Karen. The authoritative backend records a source revision and review-required impacts without mutating tracked work.",
        parameters: [
          { $ref: "#/components/parameters/PatientId" },
          { $ref: "#/components/parameters/ActorId" },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["idempotencyKey"],
                properties: {
                  idempotencyKey: { type: "string", minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Synthetic source revision recorded",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SourceRevisionResult",
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "403": { $ref: "#/components/responses/Error" },
          "409": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
          "503": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/ehr/patients/{patientId}": {
      get: {
        summary: "Read one composed synthetic EHR record",
        description:
          "Combines the current audited patient profile with versioned mock-EHR documents.",
        parameters: [
          { $ref: "#/components/parameters/PatientId" },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        responses: {
          "200": {
            description: "Current patient profile and clinical documents",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EhrPatientRecord" },
              },
            },
          },
          "404": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
          "503": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/ehr/patients/{patientId}/profile": {
      patch: {
        summary: "Apply an attributed patient-profile edit from the EHR surface",
        parameters: [
          { $ref: "#/components/parameters/PatientId" },
          { $ref: "#/components/parameters/ActorId" },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/EhrProfileUpdate" },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated authoritative profile version",
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
          "409": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/ehr/patients/{patientId}/documents": {
      post: {
        summary: "Create an attributed mock-EHR document draft",
        parameters: [
          { $ref: "#/components/parameters/PatientId" },
          { $ref: "#/components/parameters/ActorId" },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/EhrDocumentCreate" },
            },
          },
        },
        responses: {
          "201": {
            description: "Created document draft",
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "409": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/ehr/documents/{documentId}": {
      patch: {
        summary: "Create a new version of an unfiled document",
        parameters: [
          { $ref: "#/components/parameters/DocumentId" },
          { $ref: "#/components/parameters/ActorId" },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/EhrDocumentRevision" },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated document draft",
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
          "409": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/ehr/documents/{documentId}/file": {
      post: {
        summary: "File the reviewed document version to the synthetic record",
        parameters: [
          { $ref: "#/components/parameters/DocumentId" },
          { $ref: "#/components/parameters/ActorId" },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/EhrDocumentFile" },
            },
          },
        },
        responses: {
          "200": {
            description: "Immutable filed document version",
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
          "409": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/ehr/documents/{documentId}/history": {
      get: {
        summary: "Read immutable mock-EHR document version history",
        parameters: [
          { $ref: "#/components/parameters/DocumentId" },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        responses: {
          "200": {
            description: "Newest-first document versions",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["versions"],
                  properties: {
                    versions: { type: "array", items: { type: "object" } },
                  },
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/events/stream": {
      get: {
        summary: "Proxy the Agentic domain-event stream",
        parameters: [
          { $ref: "#/components/parameters/CorrelationId" },
          {
            name: "Last-Event-ID",
            in: "header",
            required: false,
            description: "Last processed non-negative event sequence",
            schema: { type: "string", pattern: "^[0-9]+$" },
          },
        ],
        responses: {
          "200": {
            description: "Server-sent domain events",
            content: {
              "text/event-stream": { schema: { type: "string" } },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api/tasks/{taskId}/{command}": {
      post: {
        summary: "Validate and forward an attributed task command",
        parameters: [
          {
            name: "taskId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "command",
            in: "path",
            required: true,
            schema: {
              type: "string",
              enum: [
                "approve",
                "correct",
                "dismiss",
                "reopen",
                "accept",
                "decline",
                "complete",
                "verify",
              ],
            },
          },
          {
            name: "x-actor-id",
            in: "header",
            required: true,
            schema: {
              type: "string",
              pattern: "^[A-Za-z0-9:._-]{1,120}$",
            },
          },
          { $ref: "#/components/parameters/CorrelationId" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TaskCommand" },
            },
          },
        },
        responses: {
          "200": {
            description: "Authoritative Agentic command result",
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
          "400": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
          "409": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      DemoParticipantToken: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "opaque participant token",
        description:
          "Opaque demo participant credential returned only by the QR join endpoint.",
      },
      integrationBearer: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "opaque",
      },
    },
    parameters: {
      DemoSessionId: {
        name: "sessionId",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      DemoJoinCode: {
        name: "joinCode",
        in: "path",
        required: true,
        schema: { type: "string", pattern: "^[A-Z0-9_-]{8,32}$" },
      },
      PatientId: {
        name: "patientId",
        in: "path",
        required: true,
        schema: { type: "string", pattern: "^[A-Za-z0-9:._-]{1,160}$" },
      },
      MeetingId: {
        name: "meetingId",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      SegmentId: {
        name: "segmentId",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      DocumentId: {
        name: "documentId",
        in: "path",
        required: true,
        schema: { type: "string", pattern: "^[A-Za-z0-9:._-]{1,160}$" },
      },
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
      WardMeetingStart: {
        type: "object",
        additionalProperties: false,
        required: ["wardId", "idempotencyKey"],
        properties: {
          wardId: { type: "string", minLength: 1, maxLength: 200 },
          encounterIdentifier: {
            type: "string",
            minLength: 1,
            maxLength: 120,
          },
          idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
        },
      },
      WardMeeting: {
        type: "object",
        additionalProperties: false,
        required: [
          "meetingId",
          "wardId",
          "interactionId",
          "status",
          "startedBy",
          "startedAt",
          "completedAt",
          "version",
        ],
        properties: {
          meetingId: { type: "string", format: "uuid" },
          wardId: { type: "string" },
          interactionId: { type: "string" },
          status: {
            type: "string",
            enum: ["recording", "completed", "failed"],
          },
          startedBy: { type: "string" },
          startedAt: { type: "string", format: "date-time" },
          completedAt: { type: ["string", "null"], format: "date-time" },
          version: { type: "integer", minimum: 1 },
        },
      },
      PatientMeetingSegment: {
        type: "object",
        additionalProperties: false,
        required: [
          "segmentId",
          "meetingId",
          "patientId",
          "status",
          "openedBy",
          "openedAt",
          "closedAt",
          "version",
        ],
        properties: {
          segmentId: { type: "string", format: "uuid" },
          meetingId: { type: "string", format: "uuid" },
          patientId: { type: "string" },
          status: {
            type: "string",
            enum: [
              "recording",
              "closed",
              "reconciling",
              "reconciled",
              "failed",
            ],
          },
          openedBy: { type: "string" },
          openedAt: { type: "string", format: "date-time" },
          closedAt: { type: ["string", "null"], format: "date-time" },
          version: { type: "integer", minimum: 1 },
        },
      },
      MeetingSegmentOpen: {
        type: "object",
        additionalProperties: false,
        required: ["patientId", "expectedMeetingVersion", "idempotencyKey"],
        properties: {
          patientId: { type: "string", minLength: 1, maxLength: 160 },
          expectedMeetingVersion: { type: "integer", minimum: 1 },
          idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
        },
      },
      MeetingTranscriptAppend: {
        type: "object",
        additionalProperties: false,
        required: ["patientSegmentId", "segments", "idempotencyKey"],
        properties: {
          patientSegmentId: { type: ["string", "null"], format: "uuid" },
          segments: {
            type: "array",
            minItems: 1,
            maxItems: 500,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "segmentKey",
                "text",
                "startSeconds",
                "endSeconds",
                "isFinal",
                "audioQuality",
              ],
              properties: {
                segmentKey: { type: "string" },
                text: { type: "string" },
                startSeconds: { type: "number", minimum: 0 },
                endSeconds: { type: "number", minimum: 0 },
                speakerId: { type: "integer" },
                isFinal: { type: "boolean" },
                audioQuality: {
                  type: "string",
                  enum: ["clear", "uncertain"],
                },
              },
            },
          },
          idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
        },
      },
      MeetingSegmentClose: {
        type: "object",
        additionalProperties: false,
        required: [
          "expectedMeetingVersion",
          "expectedSegmentVersion",
          "idempotencyKey",
        ],
        properties: {
          expectedMeetingVersion: { type: "integer", minimum: 1 },
          expectedSegmentVersion: { type: "integer", minimum: 1 },
          idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
        },
      },
      WardMeetingComplete: {
        type: "object",
        additionalProperties: false,
        required: ["expectedMeetingVersion", "idempotencyKey"],
        properties: {
          expectedMeetingVersion: { type: "integer", minimum: 1 },
          idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
        },
      },
      DemoSessionCreate: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "scenario",
          "groupSize",
          "targetTeamId",
          "idempotencyKey",
        ],
        properties: {
          title: { type: "string", minLength: 3, maxLength: 120 },
          scenario: {
            type: "string",
            enum: [
              "meeting",
              "discharge_coordination",
              "ward_consultation",
            ],
          },
          groupSize: { type: "integer", enum: [1, 2] },
          targetTeamId: { type: "string", minLength: 1, maxLength: 160 },
          idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
        },
      },
      DemoJoin: {
        type: "object",
        additionalProperties: false,
        required: ["displayName", "joinKey"],
        properties: {
          displayName: { type: "string", minLength: 1, maxLength: 80 },
          joinKey: {
            type: "string",
            minLength: 8,
            maxLength: 200,
            description:
              "Stable browser-generated retry key; it is not an authentication token.",
          },
        },
      },
      DemoAssignment: {
        type: "object",
        additionalProperties: false,
        required: [
          "groupId",
          "taskId",
          "expectedVersion",
          "idempotencyKey",
        ],
        properties: {
          groupId: { type: "string", pattern: "^group-[1-9][0-9]*$" },
          taskId: { type: "string", format: "uuid" },
          expectedVersion: { type: "integer", minimum: 1 },
          idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
        },
      },
      HandoverRequest: {
        type: "object",
        additionalProperties: false,
        required: ["idempotencyKey", "reason"],
        properties: {
          idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
          reason: { type: "string", enum: ["assignment", "on_demand"] },
          focus: {
            type: ["string", "null"],
            minLength: 1,
            maxLength: 500,
            default: null,
          },
        },
      },
      Handover: {
        type: "object",
        additionalProperties: false,
        required: [
          "handoverId",
          "patientId",
          "status",
          "renderingStatus",
          "reason",
          "requestedBy",
          "generatedAt",
          "version",
          "sourceSnapshotHash",
          "packet",
          "rendered",
          "activity",
        ],
        properties: {
          handoverId: { type: "string", format: "uuid" },
          patientId: { type: "string" },
          status: { const: "draft" },
          renderingStatus: { type: "string", enum: ["pending", "rendered"] },
          reason: { type: "string", enum: ["assignment", "on_demand"] },
          requestedBy: { type: "string" },
          generatedAt: { type: ["string", "null"], format: "date-time" },
          version: { type: "integer", minimum: 1 },
          sourceSnapshotHash: {
            type: "string",
            pattern: "^sha256:[a-f0-9]{64}$",
          },
          packet: { $ref: "#/components/schemas/HandoverPacket" },
          rendered: {
            oneOf: [
              { $ref: "#/components/schemas/RenderedHandover" },
              { type: "null" },
            ],
          },
          activity: {
            type: "array",
            items: { $ref: "#/components/schemas/HandoverActivity" },
          },
        },
      },
      GroundedStatement: {
        type: "object",
        additionalProperties: false,
        required: ["statement", "sourceRefs"],
        properties: {
          statement: { type: "string", minLength: 1, maxLength: 1000 },
          sourceRefs: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: { type: "string", minLength: 1, maxLength: 240 },
          },
        },
      },
      HandoverTaskItem: {
        type: "object",
        additionalProperties: false,
        required: [
          "taskId",
          "threadId",
          "summary",
          "state",
          "targetTeamId",
          "assignedMemberId",
          "clinicalUrgency",
          "acceptBy",
          "dueBy",
          "version",
          "sourceRefs",
        ],
        properties: {
          taskId: { type: "string", format: "uuid" },
          threadId: { type: "string", format: "uuid" },
          summary: { type: "string", minLength: 1, maxLength: 240 },
          state: {
            type: "string",
            enum: [
              "draft",
              "offered_to_team",
              "assigned_to_member",
              "accepted",
              "completed",
              "escalated",
            ],
          },
          targetTeamId: { type: "string", minLength: 1, maxLength: 160 },
          assignedMemberId: {
            type: ["string", "null"],
            minLength: 1,
            maxLength: 160,
          },
          clinicalUrgency: {
            type: "string",
            enum: ["high", "medium", "routine"],
          },
          acceptBy: { type: "string", format: "date-time" },
          dueBy: { type: "string", format: "date-time" },
          version: { type: "integer", minimum: 1 },
          sourceRefs: {
            type: "array",
            minItems: 1,
            maxItems: 20,
            items: { type: "string", minLength: 1, maxLength: 240 },
          },
        },
      },
      HandoverPacket: {
        type: "object",
        additionalProperties: false,
        required: [
          "situation",
          "background",
          "currentConcerns",
          "outstandingTasks",
          "awaitingVerification",
          "escalations",
          "unknowns",
        ],
        properties: {
          situation: {
            type: "array",
            maxItems: 20,
            items: { $ref: "#/components/schemas/GroundedStatement" },
          },
          background: {
            type: "array",
            maxItems: 20,
            items: { $ref: "#/components/schemas/GroundedStatement" },
          },
          currentConcerns: {
            type: "array",
            maxItems: 20,
            items: { $ref: "#/components/schemas/GroundedStatement" },
          },
          outstandingTasks: {
            type: "array",
            maxItems: 50,
            items: { $ref: "#/components/schemas/HandoverTaskItem" },
          },
          awaitingVerification: {
            type: "array",
            maxItems: 50,
            items: { $ref: "#/components/schemas/HandoverTaskItem" },
          },
          escalations: {
            type: "array",
            maxItems: 50,
            items: { $ref: "#/components/schemas/HandoverTaskItem" },
          },
          unknowns: {
            type: "array",
            maxItems: 20,
            items: { type: "string", minLength: 1, maxLength: 500 },
          },
        },
      },
      RenderedStatement: {
        type: "object",
        additionalProperties: false,
        required: ["statement", "sourceRefs"],
        properties: {
          statement: { type: "string", minLength: 1, maxLength: 1000 },
          sourceRefs: {
            type: "array",
            maxItems: 20,
            items: { type: "string", minLength: 1, maxLength: 240 },
          },
        },
      },
      RenderedSection: {
        type: "object",
        additionalProperties: false,
        required: ["sectionId", "heading", "statements"],
        properties: {
          sectionId: {
            type: "string",
            enum: [
              "situation",
              "background",
              "current-concerns",
              "outstanding-tasks",
              "awaiting-verification",
              "escalations",
              "unknowns",
            ],
          },
          heading: { type: "string", minLength: 1, maxLength: 160 },
          statements: {
            type: "array",
            maxItems: 50,
            items: { $ref: "#/components/schemas/RenderedStatement" },
          },
        },
      },
      RenderedHandover: {
        type: "object",
        additionalProperties: false,
        required: ["title", "sections", "creditsConsumed"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 160 },
          sections: {
            type: "array",
            maxItems: 10,
            items: { $ref: "#/components/schemas/RenderedSection" },
          },
          creditsConsumed: { type: "number", minimum: 0 },
        },
      },
      HandoverActivityActor: {
        type: "object",
        additionalProperties: false,
        required: ["type", "id"],
        properties: {
          type: {
            type: "string",
            enum: ["agent", "clinician", "team_member", "router", "system"],
          },
          id: { type: "string", minLength: 1, maxLength: 160 },
        },
      },
      HandoverRequestedPayload: {
        type: "object",
        additionalProperties: false,
        required: ["handoverId", "reason", "focusProvided", "status", "version"],
        properties: {
          handoverId: { type: "string", format: "uuid" },
          reason: { type: "string", enum: ["assignment", "on_demand"] },
          focusProvided: { type: "boolean" },
          status: { const: "requested" },
          version: { type: "integer", minimum: 1 },
        },
      },
      HandoverContextInitializedPayload: {
        type: "object",
        additionalProperties: false,
        required: ["handoverId", "contextId", "status", "version"],
        properties: {
          handoverId: { type: "string", format: "uuid" },
          contextId: { type: "string", minLength: 1, maxLength: 160 },
          status: { const: "requested" },
          version: { type: "integer", minimum: 1 },
        },
      },
      HandoverSourcesRetrievedPayload: {
        type: "object",
        additionalProperties: false,
        required: [
          "handoverId",
          "sourceSnapshotHash",
          "recordItemCount",
          "threadCount",
          "taskCount",
          "status",
          "version",
        ],
        properties: {
          handoverId: { type: "string", format: "uuid" },
          sourceSnapshotHash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
          recordItemCount: { type: "integer", minimum: 0 },
          threadCount: { type: "integer", minimum: 0 },
          taskCount: { type: "integer", minimum: 0 },
          status: { const: "draft" },
          version: { type: "integer", minimum: 1 },
        },
      },
      HandoverDraftSavedPayload: {
        type: "object",
        additionalProperties: false,
        required: ["handoverId", "sourceSnapshotHash", "status", "version"],
        properties: {
          handoverId: { type: "string", format: "uuid" },
          sourceSnapshotHash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
          status: { const: "draft" },
          version: { type: "integer", minimum: 1 },
        },
      },
      HandoverRenderRequestedPayload: {
        type: "object",
        additionalProperties: false,
        required: ["handoverId", "status", "version"],
        properties: {
          handoverId: { type: "string", format: "uuid" },
          status: { const: "draft" },
          version: { type: "integer", minimum: 1 },
        },
      },
      HandoverSourceChangedPayload: {
        type: "object",
        additionalProperties: false,
        required: [
          "handoverId",
          "expectedSnapshotHash",
          "currentSnapshotHash",
          "status",
          "version",
        ],
        properties: {
          handoverId: { type: "string", format: "uuid" },
          expectedSnapshotHash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
          currentSnapshotHash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
          status: { const: "draft" },
          version: { type: "integer", minimum: 1 },
        },
      },
      HandoverRenderedPayload: {
        type: "object",
        additionalProperties: false,
        required: [
          "handoverId",
          "sourceSnapshotHash",
          "version",
          "creditsConsumed",
          "sectionCount",
        ],
        properties: {
          handoverId: { type: "string", format: "uuid" },
          sourceSnapshotHash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
          version: { type: "integer", minimum: 1 },
          creditsConsumed: { type: "number", minimum: 0 },
          sectionCount: { type: "integer", minimum: 0 },
        },
      },
      HandoverFailedPayload: {
        type: "object",
        additionalProperties: false,
        required: ["handoverId", "code", "retryable", "status", "version"],
        properties: {
          handoverId: { type: "string", format: "uuid" },
          code: { type: "string", minLength: 1, maxLength: 160 },
          retryable: { type: "boolean" },
          status: { const: "failed" },
          version: { type: "integer", minimum: 1 },
        },
      },
      HandoverRequestedActivity: handoverActivityVariant(
        "handover.requested",
        "HandoverRequestedPayload",
      ),
      HandoverContextInitializedActivity: handoverActivityVariant(
        "handover.context_initialized",
        "HandoverContextInitializedPayload",
      ),
      HandoverSourcesRetrievedActivity: handoverActivityVariant(
        "handover.sources_retrieved",
        "HandoverSourcesRetrievedPayload",
      ),
      HandoverDraftSavedActivity: handoverActivityVariant(
        "handover.draft_saved",
        "HandoverDraftSavedPayload",
      ),
      HandoverRenderRequestedActivity: handoverActivityVariant(
        "handover.render_requested",
        "HandoverRenderRequestedPayload",
      ),
      HandoverSourceChangedActivity: handoverActivityVariant(
        "handover.source_changed",
        "HandoverSourceChangedPayload",
      ),
      HandoverRenderedActivity: handoverActivityVariant(
        "handover.rendered",
        "HandoverRenderedPayload",
      ),
      HandoverFailedActivity: handoverActivityVariant(
        "handover.failed",
        "HandoverFailedPayload",
      ),
      HandoverActivity: {
        oneOf: [
          { $ref: "#/components/schemas/HandoverRequestedActivity" },
          {
            $ref: "#/components/schemas/HandoverContextInitializedActivity",
          },
          { $ref: "#/components/schemas/HandoverSourcesRetrievedActivity" },
          { $ref: "#/components/schemas/HandoverDraftSavedActivity" },
          { $ref: "#/components/schemas/HandoverRenderRequestedActivity" },
          { $ref: "#/components/schemas/HandoverSourceChangedActivity" },
          { $ref: "#/components/schemas/HandoverRenderedActivity" },
          { $ref: "#/components/schemas/HandoverFailedActivity" },
        ],
        discriminator: {
          propertyName: "eventType",
          mapping: {
            "handover.requested":
              "#/components/schemas/HandoverRequestedActivity",
            "handover.context_initialized":
              "#/components/schemas/HandoverContextInitializedActivity",
            "handover.sources_retrieved":
              "#/components/schemas/HandoverSourcesRetrievedActivity",
            "handover.draft_saved":
              "#/components/schemas/HandoverDraftSavedActivity",
            "handover.render_requested":
              "#/components/schemas/HandoverRenderRequestedActivity",
            "handover.source_changed":
              "#/components/schemas/HandoverSourceChangedActivity",
            "handover.rendered":
              "#/components/schemas/HandoverRenderedActivity",
            "handover.failed": "#/components/schemas/HandoverFailedActivity",
          },
        },
      },
      EhrPatientRecord: {
        type: "object",
        additionalProperties: false,
        required: ["schemaVersion", "patientId", "profile", "documents", "observedAt"],
        properties: {
          schemaVersion: { const: "1" },
          patientId: { type: "string" },
          profile: { type: "object", additionalProperties: true },
          documents: { type: "array", items: { type: "object" } },
          observedAt: { type: "string", format: "date-time" },
        },
      },
      EhrProfileUpdate: {
        type: "object",
        additionalProperties: false,
        required: ["expectedVersion", "idempotencyKey", "reason", "changes"],
        properties: {
          expectedVersion: { type: "integer", minimum: 1 },
          idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
          reason: { type: "string", minLength: 3, maxLength: 500 },
          changes: { type: "object", minProperties: 1, additionalProperties: true },
        },
      },
      EhrDocumentCreate: {
        type: "object",
        additionalProperties: false,
        required: ["idempotencyKey", "category", "title", "content", "source"],
        properties: {
          idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
          category: { type: "string", enum: ["medical", "discharge"] },
          title: { type: "string", minLength: 1, maxLength: 240 },
          content: { type: "string", minLength: 1, maxLength: 40000 },
          source: { type: "string", enum: ["clinician", "agent", "scribe"] },
        },
      },
      EhrDocumentRevision: {
        type: "object",
        additionalProperties: false,
        required: ["expectedVersion", "idempotencyKey", "reason", "changes"],
        properties: {
          expectedVersion: { type: "integer", minimum: 1 },
          idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
          reason: { type: "string", minLength: 3, maxLength: 500 },
          changes: {
            type: "object",
            minProperties: 1,
            additionalProperties: false,
            properties: {
              title: { type: "string", minLength: 1, maxLength: 240 },
              content: { type: "string", minLength: 1, maxLength: 40000 },
            },
          },
        },
      },
      EhrDocumentFile: {
        type: "object",
        additionalProperties: false,
        required: ["expectedVersion", "idempotencyKey", "reason"],
        properties: {
          expectedVersion: { type: "integer", minimum: 1 },
          idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
          reason: { type: "string", minLength: 3, maxLength: 500 },
        },
      },
      Evidence: {
        type: "object",
        additionalProperties: false,
        required: [
          "interactionId",
          "sourceQuote",
          "startSeconds",
          "endSeconds",
        ],
        properties: {
          interactionId: { type: "string" },
          sourceQuote: { type: "string" },
          startSeconds: { type: "number", minimum: 0 },
          endSeconds: { type: "number", minimum: 0 },
          speakerId: { type: "integer" },
        },
      },
      Candidate: {
        type: "object",
        additionalProperties: false,
        required: [
          "candidateId",
          "interactionId",
          "patientId",
          "category",
          "summary",
          "evidence",
          "status",
        ],
        properties: {
          candidateId: { type: "string" },
          interactionId: { type: "string" },
          patientId: { type: "string" },
          category: {
            type: "string",
            enum: [
              "symptom",
              "medication-concern",
              "investigation",
              "referral",
              "follow-up",
              "social-barrier",
            ],
          },
          summary: { type: "string", minLength: 5 },
          evidence: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/components/schemas/Evidence" },
          },
          status: { const: "candidate" },
        },
      },
      Readiness: {
        type: "object",
        required: ["status", "liveCortiReady", "services"],
        properties: {
          status: { type: "string", enum: ["ready", "degraded"] },
          liveCortiReady: { type: "boolean" },
          services: {
            type: "object",
            required: ["agentic", "pipeline"],
            properties: {
              agentic: { $ref: "#/components/schemas/ServiceStatus" },
              pipeline: { $ref: "#/components/schemas/ServiceStatus" },
            },
          },
        },
      },
      ServiceStatus: {
        type: "object",
        required: ["reachable"],
        properties: {
          reachable: { type: "boolean" },
          detail: {},
          error: { type: "string" },
        },
      },
      PatientOverview: {
        type: "object",
        required: [
          "patientId",
          "threads",
          "tasks",
          "changeImpacts",
          "observedAt",
        ],
        properties: {
          patientId: { type: "string" },
          threads: { type: "array", items: { type: "object" } },
          tasks: { type: "array", items: { type: "object" } },
          changeImpacts: {
            type: "array",
            items: { $ref: "#/components/schemas/ChangeImpact" },
          },
          observedAt: { type: "string", format: "date-time" },
        },
      },
      WardCompanionOverview: {
        type: "object",
        additionalProperties: false,
        required: [
          "schemaVersion",
          "patientId",
          "observedAt",
          "threads",
          "changeImpacts",
        ],
        properties: {
          schemaVersion: { const: "1" },
          patientId: { type: "string" },
          observedAt: { type: "string", format: "date-time" },
          threads: {
            type: "array",
            items: { $ref: "#/components/schemas/WardCompanionThread" },
          },
          changeImpacts: {
            type: "array",
            items: { $ref: "#/components/schemas/ChangeImpact" },
          },
        },
      },
      ChangeImpact: {
        type: "object",
        additionalProperties: false,
        required: [
          "impactId",
          "revisionId",
          "dependencyId",
          "patientId",
          "sourceItemId",
          "sourceRef",
          "artifactKind",
          "artifactId",
          "artifactVersion",
          "status",
          "summary",
          "detectedAt",
          "changedAt",
          "changedBy",
          "reason",
        ],
        properties: {
          impactId: { type: "string", format: "uuid" },
          revisionId: { type: "string", format: "uuid" },
          dependencyId: { type: "string", format: "uuid" },
          patientId: { type: "string" },
          sourceItemId: { type: "string" },
          sourceRef: { type: "string" },
          artifactKind: { type: "string", enum: ["task", "handover"] },
          artifactId: { type: "string" },
          artifactVersion: { type: "integer", minimum: 1 },
          status: { const: "review_required" },
          summary: { type: "string" },
          detectedAt: { type: "string", format: "date-time" },
          changedAt: { type: "string", format: "date-time" },
          changedBy: { type: "string" },
          reason: {
            type: "string",
            enum: [
              "new_result",
              "medication_update",
              "clinical_note_revision",
              "other",
            ],
          },
        },
      },
      SourceRevisionResult: {
        type: "object",
        additionalProperties: false,
        required: [
          "revision",
          "impacts",
          "reviewRequiredCount",
          "replayed",
        ],
        properties: {
          revision: { type: "object" },
          impacts: {
            type: "array",
            items: { $ref: "#/components/schemas/ChangeImpact" },
          },
          reviewRequiredCount: { type: "integer", minimum: 0 },
          replayed: { type: "boolean" },
        },
      },
      WardCompanionThread: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "patientId",
          "title",
          "status",
          "heard",
          "matters",
          "suggestion",
          "assignee",
          "candidates",
          "due",
          "activity",
          "backend",
        ],
        properties: {
          id: { type: "string" },
          patientId: { type: "string" },
          title: { type: "string" },
          status: {
            type: "string",
            enum: ["pending", "tracking", "verified", "escalated"],
          },
          heard: { type: "string" },
          matters: { type: "string" },
          suggestion: { type: "string" },
          assignee: { type: ["string", "null"] },
          candidates: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "role", "free"],
              properties: {
                name: { type: "string" },
                role: { type: "string" },
                free: { type: "boolean" },
              },
            },
          },
          due: { type: "string" },
          activity: {
            type: "array",
            items: { $ref: "#/components/schemas/WardCompanionActivity" },
          },
          backend: {
            $ref: "#/components/schemas/WardCompanionBackendMetadata",
          },
        },
      },
      WardCompanionActivity: {
        type: "object",
        additionalProperties: false,
        required: ["id", "at", "actor", "text", "kind"],
        properties: {
          id: { type: "string" },
          at: { type: "string" },
          actor: { type: "string" },
          text: { type: "string" },
          kind: { type: "string", enum: ["note", "system", "action"] },
        },
      },
      WardCompanionBackendMetadata: {
        type: "object",
        additionalProperties: false,
        required: [
          "threadId",
          "taskId",
          "threadVersion",
          "taskVersion",
          "threadState",
          "taskState",
          "targetTeamId",
          "evidenceRefs",
          "availableCommands",
        ],
        properties: {
          threadId: { type: "string" },
          taskId: { type: ["string", "null"] },
          threadVersion: { type: "integer", minimum: 1 },
          taskVersion: { type: ["integer", "null"], minimum: 1 },
          threadState: {
            type: "string",
            enum: [
              "awaiting_review",
              "tracking",
              "verified",
              "escalated",
              "dismissed",
            ],
          },
          taskState: {
            type: ["string", "null"],
            enum: [
              "draft",
              "offered_to_team",
              "assigned_to_member",
              "accepted",
              "completed",
              "verified",
              "escalated",
              "dismissed",
              null,
            ],
          },
          targetTeamId: { type: ["string", "null"] },
          evidenceRefs: { type: "array", items: { type: "string" } },
          availableCommands: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "approve",
                "correct",
                "dismiss",
                "reopen",
                "accept",
                "decline",
                "complete",
                "verify",
              ],
            },
          },
        },
      },
      TaskCommand: {
        type: "object",
        required: ["expectedVersion", "idempotencyKey"],
        properties: {
          expectedVersion: { type: "integer", minimum: 1 },
          idempotencyKey: { type: "string", minLength: 8 },
          approvalChannel: {
            type: "string",
            enum: ["app_one_tap", "dictation_confirmation"],
          },
          summary: { type: "string" },
          targetTeamId: { type: "string" },
          requiredCapabilities: {
            type: "array",
            items: { type: "string" },
          },
          clinicalUrgency: {
            type: "string",
            enum: ["high", "medium", "routine"],
          },
          dueInMs: { type: "integer", minimum: 1 },
          reason: { type: "string" },
          outcomeRef: { type: "string" },
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
