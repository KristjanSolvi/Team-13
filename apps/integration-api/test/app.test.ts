import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createIntegrationApp } from "../src/app.js";
import type {
  AgenticGateway,
  PipelineGateway,
} from "../src/gateways.js";
import { IntegrationError } from "../src/errors.js";
import { IntegrationService } from "../src/service.js";

const sourceSnapshotHash = `sha256:${"a".repeat(64)}`;
const integrationApiBearerToken = "integration-public-token";
const handoverPacket = {
  situation: [],
  background: [],
  currentConcerns: [],
  outstandingTasks: [],
  awaitingVerification: [],
  escalations: [],
  unknowns: ["No current concerns were found in the available sources."],
};

function handoverResponse(renderingStatus: "pending" | "rendered") {
  return {
    handoverId: "11111111-1111-4111-8111-111111111111",
    patientId: "synthetic-karen",
    status: "draft" as const,
    renderingStatus,
    reason: "on_demand" as const,
    requestedBy: "clinician:karen",
    generatedAt:
      renderingStatus === "rendered" ? "2026-08-20T12:00:00.000Z" : null,
    version: renderingStatus === "rendered" ? 3 : 2,
    sourceSnapshotHash,
    packet: handoverPacket,
    rendered:
      renderingStatus === "rendered"
        ? { title: "Current handover", sections: [], creditsConsumed: 1 }
        : null,
    activity: [],
  };
}

function requestedActivity(extra: Record<string, unknown> = {}) {
  return {
    eventType: "handover.requested",
    occurredAt: "2026-08-20T11:59:00.000Z",
    actor: { type: "clinician", id: "clinician:karen" },
    payload: {
      handoverId: "11111111-1111-4111-8111-111111111111",
      reason: "on_demand",
      focusProvided: false,
      status: "requested",
      version: 1,
    },
    ...extra,
  };
}

function contextInitializedActivity(extra: Record<string, unknown> = {}) {
  return {
    eventType: "handover.context_initialized",
    occurredAt: "2026-08-20T11:59:01.000Z",
    actor: { type: "agent", id: "corti" },
    payload: {
      handoverId: "11111111-1111-4111-8111-111111111111",
      contextId: "ctx-handover-1",
      status: "requested",
      version: 1,
    },
    ...extra,
  };
}

type HandoverAgenticGateway = AgenticGateway & {
  createHandoverDraft: NonNullable<AgenticGateway["createHandoverDraft"]>;
  finalizeHandover: NonNullable<AgenticGateway["finalizeHandover"]>;
};

type HandoverPipelineGateway = PipelineGateway & {
  renderHandover: NonNullable<PipelineGateway["renderHandover"]>;
};

function harness() {
  const calls: string[] = [];
  const agentic: HandoverAgenticGateway = {
    health: vi.fn(async () => ({ ok: true })),
    submitSignal: vi.fn(async () => ({
      signalEventId: "event-1",
      status: "retained",
    })),
    listThreads: vi.fn(async () => [{ threadId: "thread-1" }]),
    listTasks: vi.fn(async () => [{ taskId: "task-1", state: "draft" }]),
    taskCommand: vi.fn(async () => ({
      taskId: "task-1",
      state: "offered_to_team",
    })),
    createDemoSession: vi.fn(async () => ({
      sessionId: "session-1",
      joinCode: "JOINCODE",
    })),
    getDemoSession: vi.fn(async () => ({
      sessionId: "session-1",
      groups: [],
    })),
    joinDemoSession: vi.fn(async () => ({
      participant: { participantId: "participant-1", groupId: "group-1" },
      participantToken: "participant-token-value-with-enough-length",
    })),
    assignDemoTask: vi.fn(async () => ({
      assignment: { assignmentId: "assignment-1" },
      task: { taskId: "11111111-1111-4111-8111-111111111111" },
    })),
    demoParticipantView: vi.fn(async () => ({
      participant: { participantId: "participant-1" },
      assignments: [],
    })),
    createHandoverDraft: vi.fn(async () => {
      calls.push("draft");
      return {
        replayed: false,
        lifecycleStatus: "draft",
        handover: handoverResponse("pending"),
      };
    }),
    finalizeHandover: vi.fn(async () => {
      calls.push("finalize");
      return {
        replayed: false,
        lifecycleStatus: "rendered",
        handover: handoverResponse("rendered"),
      };
    }),
    eventStream: vi.fn(async () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'id: 42\nevent: thread.state_changed\ndata: {"sequence":42}\n\n',
            ),
          );
          controller.close();
        },
      }),
    ),
  };
  const pipeline: HandoverPipelineGateway = {
    health: vi.fn(async () => ({
      status: "ok",
      cortiConfigured: true,
      missingCortiVariables: [],
    })),
    request: vi.fn(async () => ({ status: 200, body: { candidates: [] } })),
    renderHandover: vi.fn(async () => {
      calls.push("render");
      return { title: "Current handover", sections: [], creditsConsumed: 1 };
    }),
  };
  const service = new IntegrationService(agentic, pipeline, () =>
    new Date("2026-08-20T12:00:00.000Z"),
  );
  const app = createIntegrationApp({
    service,
    allowedOrigins: ["http://127.0.0.1:5173"],
    integrationApiBearerToken,
  });
  return { agentic, pipeline, app, calls };
}

describe("integration API", () => {
  it("reports liveness without contacting upstream services", async () => {
    const { agentic, pipeline, app } = harness();

    const response = await request(app).get("/healthz").expect(200);

    expect(response.body).toEqual({ status: "ok" });
    expect(agentic.health).not.toHaveBeenCalled();
    expect(pipeline.health).not.toHaveBeenCalled();
  });

  it("publishes a machine-readable contract without server credentials", async () => {
    const { app } = harness();

    const response = await request(app).get("/openapi.json").expect(200);

    expect(response.body.openapi).toBe("3.1.0");
    expect(response.body.paths).toHaveProperty("/api/events/stream");
    expect(response.body.paths).toHaveProperty(
      "/api/corti/candidates/generate",
    );
    expect(response.body.paths).toHaveProperty(
      "/api/patients/{patientId}/overview",
    );
    expect(response.body.paths).toHaveProperty(
      "/api/patients/{patientId}/companion",
    );
    expect(response.body.paths).toHaveProperty(
      "/api/ehr/patients/{patientId}",
    );
    expect(response.body.paths).toHaveProperty(
      "/api/ehr/patients/{patientId}/profile",
    );
    expect(response.body.paths).toHaveProperty(
      "/api/ehr/patients/{patientId}/documents",
    );
    expect(response.body.paths).toHaveProperty(
      "/api/ehr/documents/{documentId}/file",
    );
    expect(response.body.paths).toHaveProperty("/api/demo/sessions");
    expect(response.body.paths).toHaveProperty(
      "/api/demo/sessions/{sessionId}/assign",
    );
    expect(response.body.paths).toHaveProperty("/api/demo/join/{joinCode}");
    expect(response.body.paths).toHaveProperty("/api/demo/participants/me");
    expect(response.body.components.securitySchemes).toHaveProperty(
      "DemoParticipantToken",
    );
    expect(response.body.paths).toHaveProperty(
      "/api/patients/{patientId}/handovers",
    );
    expect(
      Object.keys(
        response.body.paths["/api/patients/{patientId}/handovers"].post
          .responses,
      ).sort(),
    ).toEqual([
      "200",
      "201",
      "400",
      "401",
      "403",
      "409",
      "502",
      "503",
      "504",
    ]);
    expect(
      response.body.paths["/api/patients/{patientId}/handovers"].post.security,
    ).toEqual([{ integrationBearer: [] }]);
    expect(response.body.components.securitySchemes.integrationBearer).toEqual({
      type: "http",
      scheme: "bearer",
      bearerFormat: "opaque",
    });
    const handoverSchema = response.body.components.schemas.Handover;
    expect(handoverSchema.properties.packet).toEqual({
      $ref: "#/components/schemas/HandoverPacket",
    });
    expect(handoverSchema.properties.rendered.oneOf).toContainEqual({
      $ref: "#/components/schemas/RenderedHandover",
    });
    expect(handoverSchema.properties.activity.items).toEqual({
      $ref: "#/components/schemas/HandoverActivity",
    });
    for (const schemaName of [
      "HandoverPacket",
      "GroundedStatement",
      "HandoverTaskItem",
      "RenderedHandover",
      "RenderedSection",
    ]) {
      expect(response.body.components.schemas[schemaName]).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
    }
    expect(
      response.body.components.schemas.HandoverActivity.oneOf,
    ).toHaveLength(8);
    expect(
      response.body.components.schemas.RenderedSection.properties.sectionId
        .enum,
    ).toEqual([
      "situation",
      "background",
      "current-concerns",
      "outstanding-tasks",
      "awaiting-verification",
      "escalations",
      "unknowns",
    ]);
    for (const variant of [
      "HandoverRequestedActivity",
      "HandoverContextInitializedActivity",
      "HandoverSourcesRetrievedActivity",
      "HandoverDraftSavedActivity",
      "HandoverRenderRequestedActivity",
      "HandoverSourceChangedActivity",
      "HandoverRenderedActivity",
      "HandoverFailedActivity",
    ]) {
      expect(response.body.components.schemas[variant]).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
    }
    expect(JSON.stringify(response.body)).not.toContain(
      "AGENTIC_APP_BEARER_TOKEN",
    );
  });

  it("aggregates backend readiness and Corti configuration", async () => {
    const { app } = harness();

    const response = await request(app).get("/readyz").expect(200);

    expect(response.body).toEqual({
      status: "ready",
      liveCortiReady: true,
      services: {
        agentic: { reachable: true, detail: { ok: true } },
        pipeline: {
          reachable: true,
          detail: {
            status: "ok",
            cortiConfigured: true,
            missingCortiVariables: [],
          },
        },
      },
    });
  });

  it("returns degraded readiness without leaking upstream errors", async () => {
    const { agentic, app } = harness();
    vi.mocked(agentic.health).mockRejectedValue(
      new Error("Bearer app-secret was rejected by 10.0.0.5"),
    );

    const response = await request(app).get("/readyz").expect(503);

    expect(response.body.status).toBe("degraded");
    expect(response.body.services.agentic).toEqual({
      reachable: false,
      error: "Service unavailable",
    });
    expect(JSON.stringify(response.body)).not.toContain("app-secret");
    expect(JSON.stringify(response.body)).not.toContain("10.0.0.5");
  });

  it("converts a pipeline candidate into one idempotent agentic signal", async () => {
    const { agentic, app } = harness();

    const response = await request(app)
      .post("/api/candidates/investigate")
      .set("x-correlation-id", "corr-karen-1")
      .send({
        candidateId: "candidate-karen-1",
        interactionId: "interaction-karen-1",
        patientId: "synthetic-karen",
        category: "medication-concern",
        summary: "Dizziness after a medication change needs follow-through",
        evidence: [
          {
            interactionId: "interaction-karen-1",
            sourceQuote: "I've been dizzy since the medication changed.",
            startSeconds: 42.1,
            endSeconds: 46.8,
            speakerId: 1,
          },
          {
            interactionId: "interaction-karen-1",
            sourceQuote: "Nobody has arranged a blood pressure check.",
            startSeconds: 50.25,
            endSeconds: 53.75,
          },
        ],
        status: "candidate",
      })
      .expect(202);

    expect(response.body).toEqual({
      candidateId: "candidate-karen-1",
      handoff: { signalEventId: "event-1", status: "retained" },
    });
    expect(agentic.submitSignal).toHaveBeenCalledWith(
      {
        patientId: "synthetic-karen",
        interactionId: "interaction-karen-1",
        signalText: "Dizziness after a medication change needs follow-through",
        evidenceRefs: [
          "encounter:candidate-9a23a2890125a1859ee91fbf.1",
          "encounter:candidate-9a23a2890125a1859ee91fbf.2",
        ],
        sourceEvidence: [
          {
            evidenceRef: "encounter:candidate-9a23a2890125a1859ee91fbf.1",
            sourceQuote: "I've been dizzy since the medication changed.",
            startSeconds: 42.1,
            endSeconds: 46.8,
            speakerId: 1,
          },
          {
            evidenceRef: "encounter:candidate-9a23a2890125a1859ee91fbf.2",
            sourceQuote: "Nobody has arranged a blood pressure check.",
            startSeconds: 50.25,
            endSeconds: 53.75,
          },
        ],
        idempotencyKey: "candidate-9a23a2890125a1859ee91fbf",
      },
      {
        actorId: "pipeline:candidate-handoff",
        correlationId: "corr-karen-1",
      },
    );
  });

  it("proxies only the explicit Corti pipeline surface", async () => {
    const { pipeline, app } = harness();

    const response = await request(app)
      .post("/api/corti/candidates/generate")
      .set("x-correlation-id", "corr-pipeline-1")
      .send({
        patientId: "synthetic-karen",
        interactionId: "interaction-karen-1",
        segments: [],
      })
      .expect(200);
    await request(app)
      .post("/api/corti/not-a-real-route")
      .send({})
      .expect(404);

    expect(response.body).toEqual({ candidates: [] });
    expect(pipeline.request).toHaveBeenCalledOnce();
    expect(pipeline.request).toHaveBeenCalledWith(
      "/api/corti/candidates/generate",
      {
        patientId: "synthetic-karen",
        interactionId: "interaction-karen-1",
        segments: [],
      },
      { correlationId: "corr-pipeline-1" },
    );
    await request(app)
      .post("/api/corti/handovers/render")
      .send({ packet: handoverPacket })
      .expect(404);
    expect(pipeline.request).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing", undefined],
    ["wrong", "Bearer wrong-public-token"],
    ["malformed", `Basic ${integrationApiBearerToken}`],
  ])(
    "rejects a %s public handover credential before validation or upstream calls",
    async (_label, authorization) => {
      const { agentic, pipeline, app } = harness();
      let pending = request(app)
        .post("/api/patients/synthetic-karen/handovers")
        .send({ invalid: "body" });
      if (authorization !== undefined) {
        pending = pending.set("authorization", authorization);
      }

      const response = await pending.expect(401);

      expect(response.body.error).toMatchObject({
        code: "UNAUTHORIZED",
        message: "Authentication required",
        retryable: false,
      });
      expect(agentic.createHandoverDraft).not.toHaveBeenCalled();
      expect(pipeline.renderHandover).not.toHaveBeenCalled();
      expect(agentic.finalizeHandover).not.toHaveBeenCalled();
    },
  );

  it("accepts a lowercase bearer scheme and orchestrates a new handover", async () => {
    const { agentic, pipeline, app, calls } = harness();

    const response = await request(app)
      .post("/api/patients/synthetic-karen/handovers")
      .set("authorization", `bearer ${integrationApiBearerToken}`)
      .set("x-actor-id", "clinician:karen")
      .set("x-correlation-id", "corr-handover-1")
      .send({
        idempotencyKey: "handover-karen-001",
        reason: "on_demand",
        focus: "  Overnight changes  ",
      })
      .expect(201);

    expect(calls).toEqual(["draft", "render", "finalize"]);
    expect(agentic.createHandoverDraft).toHaveBeenCalledWith(
      "synthetic-karen",
      {
        idempotencyKey: "handover-karen-001",
        reason: "on_demand",
        focus: "Overnight changes",
      },
      {
        actorId: "clinician:karen",
        correlationId: "corr-handover-1",
      },
    );
    expect(pipeline.renderHandover).toHaveBeenCalledWith(
      {
        handoverId: "11111111-1111-4111-8111-111111111111",
        patientId: "synthetic-karen",
        sourceSnapshotHash,
        packet: handoverPacket,
      },
      {
        actorId: "clinician:karen",
        correlationId: "corr-handover-1",
      },
    );
    expect(agentic.finalizeHandover).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      {
        expectedVersion: 2,
        sourceSnapshotHash,
        rendered: {
          title: "Current handover",
          sections: [],
          creditsConsumed: 1,
        },
      },
      {
        actorId: "clinician:karen",
        correlationId: "corr-handover-1",
      },
    );
    expect(response.body).toEqual(handoverResponse("rendered"));
    expect(response.body).not.toHaveProperty("lifecycleStatus");
    expect(response.body).not.toHaveProperty("replayed");
  });

  it("accepts the exact safe context-initialized activity from the Agentic service", async () => {
    const { agentic, app } = harness();
    const activity = [requestedActivity(), contextInitializedActivity()];
    vi.mocked(agentic.createHandoverDraft).mockResolvedValue({
      replayed: false,
      lifecycleStatus: "draft",
      handover: { ...handoverResponse("pending"), activity },
    });
    vi.mocked(agentic.finalizeHandover).mockResolvedValue({
      replayed: false,
      lifecycleStatus: "rendered",
      handover: { ...handoverResponse("rendered"), activity },
    });

    const response = await request(app)
      .post("/api/patients/synthetic-karen/handovers")
      .set("authorization", `Bearer ${integrationApiBearerToken}`)
      .set("x-actor-id", "clinician:karen")
      .send({ idempotencyKey: "handover-karen-001", reason: "on_demand" })
      .expect(201);

    expect(response.body.activity).toEqual(activity);
  });

  it("returns a rendered replay without another renderer or finalization call", async () => {
    const { agentic, pipeline, app, calls } = harness();
    vi.mocked(agentic.createHandoverDraft).mockImplementation(async () => {
      calls.push("draft");
      return {
        replayed: true,
        lifecycleStatus: "rendered",
        handover: handoverResponse("rendered"),
      };
    });

    const response = await request(app)
      .post("/api/patients/synthetic-karen/handovers")
      .set("authorization", `Bearer ${integrationApiBearerToken}`)
      .set("x-actor-id", "clinician:karen")
      .send({ idempotencyKey: "handover-karen-001", reason: "on_demand" })
      .expect(200);

    expect(response.body).toEqual(handoverResponse("rendered"));
    expect(calls).toEqual(["draft"]);
    expect(pipeline.renderHandover).not.toHaveBeenCalled();
    expect(agentic.finalizeHandover).not.toHaveBeenCalled();
  });

  it("resumes rendering a draft replay without starting another agent run", async () => {
    const { agentic, app, calls } = harness();
    vi.mocked(agentic.createHandoverDraft).mockImplementation(async () => {
      calls.push("draft");
      return {
        replayed: true,
        lifecycleStatus: "draft",
        handover: handoverResponse("pending"),
      };
    });

    await request(app)
      .post("/api/patients/synthetic-karen/handovers")
      .set("authorization", `Bearer ${integrationApiBearerToken}`)
      .set("x-actor-id", "clinician:karen")
      .send({ idempotencyKey: "handover-karen-001", reason: "on_demand" })
      .expect(200);

    expect(calls).toEqual(["draft", "render", "finalize"]);
    expect(agentic.createHandoverDraft).toHaveBeenCalledOnce();
  });

  it("stops before render and finalize when draft generation fails", async () => {
    const { agentic, pipeline, app } = harness();
    vi.mocked(agentic.createHandoverDraft).mockRejectedValue(
      new Error("private upstream details"),
    );

    const response = await request(app)
      .post("/api/patients/synthetic-karen/handovers")
      .set("authorization", `Bearer ${integrationApiBearerToken}`)
      .set("x-actor-id", "clinician:karen")
      .send({ idempotencyKey: "handover-karen-001", reason: "on_demand" })
      .expect(500);

    expect(response.body.error).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "Request failed",
    });
    expect(JSON.stringify(response.body)).not.toContain("private upstream details");
    expect(pipeline.renderHandover).not.toHaveBeenCalled();
    expect(agentic.finalizeHandover).not.toHaveBeenCalled();
  });

  it("stops before finalize and safely propagates a retryable render failure", async () => {
    const { agentic, pipeline, app } = harness();
    vi.mocked(pipeline.renderHandover).mockRejectedValue(
      new IntegrationError(
        "CORTI_RENDER_UNAVAILABLE",
        "Please retry rendering",
        503,
        true,
      ),
    );

    const response = await request(app)
      .post("/api/patients/synthetic-karen/handovers")
      .set("authorization", `Bearer ${integrationApiBearerToken}`)
      .set("x-actor-id", "clinician:karen")
      .send({ idempotencyKey: "handover-karen-001", reason: "on_demand" })
      .expect(503);

    expect(response.body.error).toMatchObject({
      code: "CORTI_RENDER_UNAVAILABLE",
      message: "Please retry rendering",
      retryable: true,
    });
    expect(agentic.finalizeHandover).not.toHaveBeenCalled();
  });

  it.each([
    [
      "malformed sections",
      {
        title: "Current handover",
        sections: "private malformed renderer output",
        creditsConsumed: 1,
      },
    ],
    [
      "extra renderer field",
      {
        title: "Current handover",
        sections: [],
        creditsConsumed: 1,
        hiddenReasoning: "private renderer reasoning",
      },
    ],
    [
      "unknown section with evidence",
      {
        title: "Current handover",
        sections: [
          {
            sectionId: "unknowns",
            heading: "Unknowns",
            statements: [
              {
                statement: "An unsafe unknown statement.",
                sourceRefs: ["record:not-in-packet"],
              },
            ],
          },
        ],
        creditsConsumed: 1,
      },
    ],
    [
      "uncited clinical section",
      {
        title: "Current handover",
        sections: [
          {
            sectionId: "situation",
            heading: "Situation",
            statements: [
              {
                statement: "An uncited clinical claim.",
                sourceRefs: [],
              },
            ],
          },
        ],
        creditsConsumed: 1,
      },
    ],
    [
      "source outside packet",
      {
        title: "Current handover",
        sections: [
          {
            sectionId: "situation",
            heading: "Situation",
            statements: [
              {
                statement: "A claim with ungrounded evidence.",
                sourceRefs: ["record:not-in-packet"],
              },
            ],
          },
        ],
        creditsConsumed: 1,
      },
    ],
    [
      "unsupported section id",
      {
        title: "Current handover",
        sections: [
          {
            sectionId: "diagnosis",
            heading: "Diagnosis",
            statements: [
              {
                statement: "An invented diagnosis section.",
                sourceRefs: ["record:not-in-packet"],
              },
            ],
          },
        ],
        creditsConsumed: 1,
      },
    ],
  ])("rejects %s from a successful renderer before finalization", async (_label, rendered) => {
    const { agentic, pipeline, app } = harness();
    vi.mocked(pipeline.renderHandover).mockResolvedValue(rendered);

    const response = await request(app)
      .post("/api/patients/synthetic-karen/handovers")
      .set("authorization", `Bearer ${integrationApiBearerToken}`)
      .set("x-actor-id", "clinician:karen")
      .send({ idempotencyKey: "handover-karen-001", reason: "on_demand" })
      .expect(502);

    expect(response.body.error).toMatchObject({
      code: "HANDOVER_RENDER_FAILED",
      retryable: true,
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /private malformed|private renderer reasoning|invented diagnosis/,
    );
    expect(agentic.finalizeHandover).not.toHaveBeenCalled();
  });

  it("returns a retryable source conflict without stale rendered content", async () => {
    const { agentic, app } = harness();
    vi.mocked(agentic.finalizeHandover).mockRejectedValue(
      new IntegrationError(
        "HANDOVER_SOURCE_CHANGED",
        "Handover sources changed; retry the request",
        409,
        true,
      ),
    );

    const response = await request(app)
      .post("/api/patients/synthetic-karen/handovers")
      .set("authorization", `Bearer ${integrationApiBearerToken}`)
      .set("x-actor-id", "clinician:karen")
      .send({ idempotencyKey: "handover-karen-001", reason: "on_demand" })
      .expect(409);

    expect(response.body.error).toMatchObject({
      code: "HANDOVER_SOURCE_CHANGED",
      retryable: true,
    });
    expect(response.body).not.toHaveProperty("rendered");
  });

  it.each([
    ["missing actor", undefined, { idempotencyKey: "handover-001", reason: "on_demand" }],
    ["malformed actor", "bad actor", { idempotencyKey: "handover-001", reason: "on_demand" }],
    ["invalid reason", "clinician:karen", { idempotencyKey: "handover-001", reason: "routine" }],
    ["blank focus", "clinician:karen", { idempotencyKey: "handover-001", reason: "on_demand", focus: "   " }],
    ["short key", "clinician:karen", { idempotencyKey: "short", reason: "on_demand" }],
    ["unknown field", "clinician:karen", { idempotencyKey: "handover-001", reason: "on_demand", surprise: true }],
  ])("rejects %s before any upstream call", async (_label, actor, body) => {
    const { agentic, pipeline, app } = harness();
    let pending = request(app)
      .post("/api/patients/synthetic-karen/handovers")
      .set("authorization", `Bearer ${integrationApiBearerToken}`);
    if (actor !== undefined) pending = pending.set("x-actor-id", actor);

    await pending.send(body).expect(400);

    expect(agentic.createHandoverDraft).not.toHaveBeenCalled();
    expect(pipeline.renderHandover).not.toHaveBeenCalled();
    expect(agentic.finalizeHandover).not.toHaveBeenCalled();
  });

  it("rejects malformed agentic envelopes before rendering", async () => {
    const { agentic, pipeline, app } = harness();
    vi.mocked(agentic.createHandoverDraft).mockResolvedValue({
      replayed: false,
      lifecycleStatus: "draft",
      handover: { ...handoverResponse("pending"), packet: "unsafe" },
    });

    const response = await request(app)
      .post("/api/patients/synthetic-karen/handovers")
      .set("authorization", `Bearer ${integrationApiBearerToken}`)
      .set("x-actor-id", "clinician:karen")
      .send({ idempotencyKey: "handover-karen-001", reason: "on_demand" })
      .expect(502);

    expect(response.body.error.code).toBe("UPSTREAM_INVALID_RESPONSE");
    expect(pipeline.renderHandover).not.toHaveBeenCalled();
  });

  it.each([
    ["request reason", { reason: "assignment" }],
    ["request actor", { requestedBy: "clinician:other" }],
  ])("rejects a structurally valid draft with a mismatched %s", async (_label, change) => {
    const { agentic, pipeline, app } = harness();
    vi.mocked(agentic.createHandoverDraft).mockResolvedValue({
      replayed: false,
      lifecycleStatus: "draft",
      handover: { ...handoverResponse("pending"), ...change },
    });

    const response = await request(app)
      .post("/api/patients/synthetic-karen/handovers")
      .set("authorization", `Bearer ${integrationApiBearerToken}`)
      .set("x-actor-id", "clinician:karen")
      .send({ idempotencyKey: "handover-karen-001", reason: "on_demand" })
      .expect(502);

    expect(response.body.error.code).toBe("UPSTREAM_INVALID_RESPONSE");
    expect(pipeline.renderHandover).not.toHaveBeenCalled();
  });

  it.each([
    ["request reason", { reason: "assignment" }],
    ["request actor", { requestedBy: "clinician:other" }],
  ])("rejects a rendered replay with a mismatched %s", async (_label, change) => {
    const { agentic, pipeline, app } = harness();
    vi.mocked(agentic.createHandoverDraft).mockResolvedValue({
      replayed: true,
      lifecycleStatus: "rendered",
      handover: { ...handoverResponse("rendered"), ...change },
    });

    await request(app)
      .post("/api/patients/synthetic-karen/handovers")
      .set("authorization", `Bearer ${integrationApiBearerToken}`)
      .set("x-actor-id", "clinician:karen")
      .send({ idempotencyKey: "handover-karen-001", reason: "on_demand" })
      .expect(502);

    expect(pipeline.renderHandover).not.toHaveBeenCalled();
  });

  it.each([
    ["version", { version: 99 }],
    ["reason", { reason: "assignment" }],
    ["requester", { requestedBy: "clinician:other" }],
    [
      "packet",
      {
        packet: {
          ...handoverPacket,
          unknowns: ["A malicious finalizer changed the canonical packet."],
        },
      },
    ],
    [
      "rendered output",
      {
        rendered: {
          title: "Different pipeline output",
          sections: [],
          creditsConsumed: 1,
        },
      },
    ],
  ])("rejects a structurally valid final envelope with changed %s", async (_label, change) => {
    const { agentic, app } = harness();
    vi.mocked(agentic.finalizeHandover).mockResolvedValue({
      replayed: false,
      lifecycleStatus: "rendered",
      handover: { ...handoverResponse("rendered"), ...change },
    });

    const response = await request(app)
      .post("/api/patients/synthetic-karen/handovers")
      .set("authorization", `Bearer ${integrationApiBearerToken}`)
      .set("x-actor-id", "clinician:karen")
      .send({ idempotencyKey: "handover-karen-001", reason: "on_demand" })
      .expect(502);

    expect(response.body.error.code).toBe("UPSTREAM_INVALID_RESPONSE");
    expect(JSON.stringify(response.body)).not.toContain("Different pipeline output");
  });

  it.each([
    ["draft generation time", "draft", { generatedAt: "2026-08-20T12:00:00.000Z" }],
    ["rendered generation time", "rendered", { generatedAt: null }],
  ])("rejects an inconsistent %s", async (_label, lifecycleStatus, change) => {
    const { agentic, app } = harness();
    const renderingStatus =
      lifecycleStatus === "rendered" ? "rendered" : "pending";
    vi.mocked(agentic.createHandoverDraft).mockResolvedValue({
      replayed: lifecycleStatus === "rendered",
      lifecycleStatus,
      handover: {
        ...handoverResponse(renderingStatus),
        ...change,
      },
    });

    await request(app)
      .post("/api/patients/synthetic-karen/handovers")
      .set("authorization", `Bearer ${integrationApiBearerToken}`)
      .set("x-actor-id", "clinician:karen")
      .send({ idempotencyKey: "handover-karen-001", reason: "on_demand" })
      .expect(502);
  });

  it.each([
    ["activity", { hiddenReasoning: "private chain of thought" }],
    [
      "payload",
      {
        payload: {
          ...requestedActivity().payload,
          token: "secret-upstream-token",
        },
      },
    ],
    [
      "actor",
      {
        actor: {
          ...requestedActivity().actor,
          credential: "secret-upstream-token",
        },
      },
    ],
  ])("rejects a hidden field in handover %s without leaking it", async (_label, extra) => {
    const { agentic, pipeline, app } = harness();
    vi.mocked(agentic.createHandoverDraft).mockResolvedValue({
      replayed: false,
      lifecycleStatus: "draft",
      handover: {
        ...handoverResponse("pending"),
        activity: [{ ...requestedActivity(), ...extra }],
      },
    });

    const response = await request(app)
      .post("/api/patients/synthetic-karen/handovers")
      .set("authorization", `Bearer ${integrationApiBearerToken}`)
      .set("x-actor-id", "clinician:karen")
      .send({ idempotencyKey: "handover-karen-001", reason: "on_demand" })
      .expect(502);

    expect(response.body.error.code).toBe("UPSTREAM_INVALID_RESPONSE");
    expect(JSON.stringify(response.body)).not.toMatch(
      /private chain of thought|secret-upstream-token/,
    );
    expect(pipeline.renderHandover).not.toHaveBeenCalled();
  });

  it("rejects evidence scoped to a different interaction", async () => {
    const { agentic, app } = harness();

    const response = await request(app)
      .post("/api/candidates/investigate")
      .send({
        candidateId: "candidate-karen-1",
        interactionId: "interaction-karen-1",
        patientId: "synthetic-karen",
        category: "symptom",
        summary: "Dizziness needs follow-through",
        evidence: [
          {
            interactionId: "interaction-other",
            sourceQuote: "I am dizzy.",
            startSeconds: 2,
            endSeconds: 3,
          },
        ],
        status: "candidate",
      })
      .expect(400);

    expect(response.body.error.code).toBe("CANDIDATE_SCOPE_MISMATCH");
    expect(agentic.submitSignal).not.toHaveBeenCalled();
  });

  it("returns one authoritative patient overview", async () => {
    const { app } = harness();

    const response = await request(app)
      .get("/api/patients/synthetic-karen/overview")
      .expect(200);

    expect(response.body).toEqual({
      patientId: "synthetic-karen",
      threads: [{ threadId: "thread-1" }],
      tasks: [{ taskId: "task-1", state: "draft" }],
      observedAt: "2026-08-20T12:00:00.000Z",
    });
  });

  it("exposes the QR audience flow without forwarding server credentials to the browser", async () => {
    const { agentic, app } = harness();

    const created = await request(app)
      .post("/api/demo/sessions")
      .set("x-actor-id", "clinician:demo-host")
      .set("x-correlation-id", "corr-demo-create")
      .send({
        title: "Audience discharge coordination",
        scenario: "discharge_coordination",
        groupSize: 2,
        targetTeamId: "district-nursing",
        idempotencyKey: "demo-session-create-001",
      })
      .expect(201);
    expect(created.body).toEqual({
      sessionId: "session-1",
      joinCode: "JOINCODE",
    });
    expect(agentic.createDemoSession).toHaveBeenCalledWith(
      {
        title: "Audience discharge coordination",
        scenario: "discharge_coordination",
        groupSize: 2,
        targetTeamId: "district-nursing",
        idempotencyKey: "demo-session-create-001",
      },
      {
        actorId: "clinician:demo-host",
        correlationId: "corr-demo-create",
      },
    );

    await request(app)
      .post("/api/demo/join/JOINCODE")
      .set("x-correlation-id", "corr-demo-join")
      .send({ displayName: "Alex", joinKey: "browser-key-alex" })
      .expect(201);
    expect(agentic.joinDemoSession).toHaveBeenCalledWith(
      "JOINCODE",
      { displayName: "Alex", joinKey: "browser-key-alex" },
      { correlationId: "corr-demo-join" },
    );

    await request(app)
      .post("/api/demo/sessions/session-1/assign")
      .set("x-actor-id", "clinician:demo-host")
      .send({
        groupId: "group-1",
        taskId: "11111111-1111-4111-8111-111111111111",
        expectedVersion: 2,
        idempotencyKey: "demo-task-assign-001",
      })
      .expect(200);

    await request(app)
      .get("/api/demo/participants/me")
      .set(
        "authorization",
        "Bearer participant-token-value-with-enough-length",
      )
      .expect(200);
    expect(agentic.demoParticipantView).toHaveBeenCalledWith(
      "participant-token-value-with-enough-length",
      expect.objectContaining({ correlationId: expect.any(String) }),
    );

    const denied = await request(app)
      .get("/api/demo/participants/me")
      .expect(401);
    expect(denied.body.error.code).toBe("DEMO_PARTICIPANT_AUTH_REQUIRED");
    expect(JSON.stringify(created.body)).not.toContain("server-only-token");
  });

  it("returns the Ward Companion read model without exposing credentials", async () => {
    const { agentic, app } = harness();
    vi.mocked(agentic.listThreads).mockResolvedValue([
      {
        threadId: "thread-1",
        patientId: "synthetic-karen",
        interactionId: "interaction-1",
        summary: "Dizziness after a medication change",
        evidenceRefs: ["encounter:candidate-1.1"],
        state: "awaiting_review",
        version: 1,
        createdAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T10:00:00.000Z",
      },
    ]);
    vi.mocked(agentic.listTasks).mockResolvedValue([
      {
        taskId: "task-1",
        threadId: "thread-1",
        patientId: "synthetic-karen",
        summary: "Check blood pressure within 48 hours",
        targetTeamId: "district-nursing",
        dueBy: "2026-08-22T10:00:00.000Z",
        state: "draft",
        assignedMemberId: null,
        version: 1,
        createdAt: "2026-08-20T10:00:00.000Z",
        updatedAt: "2026-08-20T10:00:00.000Z",
      },
    ]);

    const response = await request(app)
      .get("/api/patients/synthetic-karen/companion")
      .expect(200);

    expect(response.body.schemaVersion).toBe("1");
    expect(response.body.threads[0]).toMatchObject({
      id: "task-1",
      patientId: "synthetic-karen",
      status: "pending",
      assignee: null,
      backend: {
        threadId: "thread-1",
        taskId: "task-1",
        taskVersion: 1,
        availableCommands: ["approve", "correct", "dismiss"],
      },
    });
    expect(JSON.stringify(response.body)).not.toContain(
      "server-only-app-token",
    );
  });

  it("validates and forwards clinician task commands", async () => {
    const { agentic, app } = harness();

    const response = await request(app)
      .post("/api/tasks/task-1/approve")
      .set("x-actor-id", "clinician-1")
      .set("x-correlation-id", "corr-approve-1")
      .send({
        expectedVersion: 2,
        approvalChannel: "app_one_tap",
        idempotencyKey: "approve-karen-001",
      })
      .expect(200);

    expect(response.body.state).toBe("offered_to_team");
    expect(agentic.taskCommand).toHaveBeenCalledWith(
      "task-1",
      "approve",
      {
        expectedVersion: 2,
        approvalChannel: "app_one_tap",
        idempotencyKey: "approve-karen-001",
      },
      { actorId: "clinician-1", correlationId: "corr-approve-1" },
    );
  });

  it("requires actor attribution for task commands", async () => {
    const { agentic, app } = harness();

    const response = await request(app)
      .post("/api/tasks/task-1/dismiss")
      .send({
        expectedVersion: 1,
        reason: "Already covered",
        idempotencyKey: "dismiss-karen-001",
      })
      .expect(400);

    expect(response.body.error.code).toBe("ACTOR_REQUIRED");
    expect(agentic.taskCommand).not.toHaveBeenCalled();
  });

  it("proxies the agentic event stream and resumes from Last-Event-ID", async () => {
    const { agentic, app } = harness();

    const response = await request(app)
      .get("/api/events/stream")
      .set("last-event-id", "41")
      .set("x-correlation-id", "corr-stream-1")
      .expect(200);

    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.text).toContain("event: thread.state_changed");
    expect(response.text).toContain('data: {"sequence":42}');
    expect(agentic.eventStream).toHaveBeenCalledWith(
      "41",
      { correlationId: "corr-stream-1" },
      expect.any(AbortSignal),
    );
  });

  it("rejects an invalid Last-Event-ID before opening an upstream stream", async () => {
    const { agentic, app } = harness();

    const response = await request(app)
      .get("/api/events/stream")
      .set("last-event-id", "not-a-sequence")
      .expect(400);

    expect(response.body.error.code).toBe("INVALID_EVENT_SEQUENCE");
    expect(agentic.eventStream).not.toHaveBeenCalled();
  });

  it("allows CORS only for configured UI origins", async () => {
    const { app } = harness();

    const allowed = await request(app)
      .get("/healthz")
      .set("origin", "http://127.0.0.1:5173")
      .expect(200);
    const denied = await request(app)
      .get("/healthz")
      .set("origin", "https://evil.example")
      .expect(200);

    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "http://127.0.0.1:5173",
    );
    expect(allowed.headers["access-control-allow-headers"]).toContain(
      "authorization",
    );
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
