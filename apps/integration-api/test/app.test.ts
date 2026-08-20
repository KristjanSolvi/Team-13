import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createIntegrationApp } from "../src/app.js";
import type {
  AgenticGateway,
  PipelineGateway,
} from "../src/gateways.js";
import { IntegrationService } from "../src/service.js";

function harness() {
  const agentic: AgenticGateway = {
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
  const pipeline: PipelineGateway = {
    health: vi.fn(async () => ({
      status: "ok",
      cortiConfigured: true,
      missingCortiVariables: [],
    })),
    request: vi.fn(async () => ({ status: 200, body: { candidates: [] } })),
  };
  const service = new IntegrationService(agentic, pipeline, () =>
    new Date("2026-08-20T12:00:00.000Z"),
  );
  const app = createIntegrationApp({
    service,
    allowedOrigins: ["http://127.0.0.1:5173"],
  });
  return { agentic, pipeline, app };
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
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
