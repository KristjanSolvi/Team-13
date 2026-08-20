import type { Server } from "node:http";

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createIntegrationApp } from "../src/app.js";
import {
  HttpAgenticGateway,
  HttpPipelineGateway,
} from "../src/gateways.js";
import { IntegrationService } from "../src/service.js";

interface CapturedRequest {
  authorization?: string;
  actorId?: string;
  correlationId?: string;
  lastEventId?: string;
  body?: unknown;
}

const handoverHash = `sha256:${"b".repeat(64)}`;
const handoverPacket = {
  situation: [],
  background: [],
  currentConcerns: [],
  outstandingTasks: [],
  awaitingVerification: [],
  escalations: [],
  unknowns: ["No further information available."],
};

function handover(rendered: boolean) {
  return {
    handoverId: "22222222-2222-4222-8222-222222222222",
    patientId: "synthetic-karen",
    status: "draft",
    renderingStatus: rendered ? "rendered" : "pending",
    reason: "assignment",
    requestedBy: "clinician:karen",
    generatedAt: rendered ? "2026-08-20T12:00:00.000Z" : null,
    version: rendered ? 3 : 2,
    sourceSnapshotHash: handoverHash,
    packet: handoverPacket,
    rendered: rendered
      ? { title: "Current handover", sections: [], creditsConsumed: 1 }
      : null,
    activity: [],
  };
}

describe("real HTTP service boundaries", () => {
  let agenticServer: Server;
  let pipelineServer: Server;
  let app: ReturnType<typeof createIntegrationApp>;
  const captured: Record<string, CapturedRequest> = {};

  beforeAll(async () => {
    const agentic = express();
    agentic.use(express.json());
    agentic.get("/healthz", (_request, response) => response.json({ ok: true }));
    agentic.post("/api/signals", (request, response) => {
      captured.signal = capture(request);
      response.status(202).json({ signalEventId: "event-http-1", status: "retained" });
    });
    agentic.get("/api/patients/:patientId/threads", (_request, response) => {
      response.json({
        threads: [
          {
            threadId: "thread-http-1",
            patientId: "synthetic-karen",
            interactionId: "interaction-karen-1",
            contextId: "context-karen-1",
            summary: "Dizziness after a medication change",
            evidenceRefs: ["encounter:candidate-http.1"],
            state: "awaiting_review",
            version: 1,
            createdAt: "2026-08-20T10:00:00.000Z",
            updatedAt: "2026-08-20T10:00:00.000Z",
          },
        ],
      });
    });
    agentic.get("/api/patients/:patientId/tasks", (_request, response) => {
      response.json({
        tasks: [
          {
            taskId: "task-http-1",
            threadId: "thread-http-1",
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
        ],
      });
    });
    agentic.post("/api/tasks/:taskId/approve", (request, response) => {
      captured.approve = capture(request);
      response.json({ taskId: request.params.taskId, state: "offered_to_team", version: 2 });
    });
    agentic.post(
      "/api/patients/:patientId/handover-drafts",
      (request, response) => {
        captured.handoverDraft = capture(request);
        response.status(201).json({
          replayed: false,
          lifecycleStatus: "draft",
          handover: handover(false),
        });
      },
    );
    agentic.post("/api/handovers/:handoverId/finalize", (request, response) => {
      captured.handoverFinalize = capture(request);
      response.json({
        replayed: false,
        lifecycleStatus: "rendered",
        handover: handover(true),
      });
    });
    agentic.get("/api/events/stream", (request, response) => {
      captured.stream = capture(request);
      response.status(200);
      response.setHeader("content-type", "text/event-stream");
      response.end(
        'id: 42\nevent: thread.state_changed\ndata: {"sequence":42,"state":"tracking"}\n\n',
      );
    });

    const pipeline = express();
    pipeline.use(express.json());
    pipeline.get("/health", (_request, response) => {
      response.json({
        status: "ok",
        cortiConfigured: true,
        missingCortiVariables: [],
      });
    });
    pipeline.post("/api/corti/candidates/generate", (request, response) => {
      captured.pipelineCandidates = capture(request);
      response.json({ candidates: [{ candidateId: "candidate-from-pipeline" }] });
    });
    pipeline.post("/api/corti/ambient/session", (request, response) => {
      captured.ambientSession = capture(request);
      response.status(201).json({
        interactionId: "interaction-karen-1",
        accessToken: "scoped-browser-token",
        expiresIn: 300,
      });
    });
    pipeline.post("/api/corti/handovers/render", (request, response) => {
      captured.handoverRender = capture(request);
      response.json({
        title: "Current handover",
        sections: [],
        creditsConsumed: 1,
      });
    });

    agenticServer = await listen(agentic);
    pipelineServer = await listen(pipeline);
    const service = new IntegrationService(
      new HttpAgenticGateway(
        baseUrl(agenticServer),
        1_000,
        "server-only-app-token",
      ),
      new HttpPipelineGateway(baseUrl(pipelineServer), 1_000),
      () => new Date("2026-08-20T12:00:00.000Z"),
    );
    app = createIntegrationApp({
      service,
      allowedOrigins: ["http://127.0.0.1:5173"],
    });
  });

  afterAll(async () => {
    await Promise.all([close(agenticServer), close(pipelineServer)]);
  });

  it("reports both actual upstream HTTP services ready", async () => {
    const response = await request(app).get("/readyz").expect(200);

    expect(response.body.status).toBe("ready");
    expect(response.body.liveCortiReady).toBe(true);
  });

  it("carries candidate and task commands across the real HTTP boundary", async () => {
    const candidate = await request(app)
      .post("/api/candidates/investigate")
      .set("x-correlation-id", "corr-http-candidate")
      .send({
        candidateId: "candidate-http-1",
        interactionId: "interaction-karen-1",
        patientId: "synthetic-karen",
        category: "symptom",
        summary: "Dizziness needs follow-through",
        evidence: [
          {
            interactionId: "interaction-karen-1",
            sourceQuote: "I feel dizzy.",
            startSeconds: 10,
            endSeconds: 12,
            speakerId: 2,
          },
          {
            interactionId: "interaction-karen-1",
            sourceQuote: "No blood pressure check has been arranged.",
            startSeconds: 13.5,
            endSeconds: 16.25,
          },
        ],
        status: "candidate",
      })
      .expect(202);
    const overview = await request(app)
      .get("/api/patients/synthetic-karen/overview")
      .expect(200);
    const companion = await request(app)
      .get("/api/patients/synthetic-karen/companion")
      .expect(200);
    const approved = await request(app)
      .post("/api/tasks/task-http-1/approve")
      .set("x-actor-id", "clinician-1")
      .set("x-correlation-id", "corr-http-approve")
      .send({ expectedVersion: 1, idempotencyKey: "approve-http-001" })
      .expect(200);

    expect(candidate.body.handoff.signalEventId).toBe("event-http-1");
    expect(overview.body.threads[0].state).toBe("awaiting_review");
    expect(companion.body.threads[0]).toMatchObject({
      id: "task-http-1",
      status: "pending",
      backend: {
        taskId: "task-http-1",
        taskVersion: 1,
        availableCommands: ["approve", "correct", "dismiss"],
      },
    });
    expect(approved.body.state).toBe("offered_to_team");
    expect(captured.signal).toMatchObject({
      authorization: "Bearer server-only-app-token",
      actorId: "pipeline:candidate-handoff",
      correlationId: "corr-http-candidate",
      body: {
        patientId: "synthetic-karen",
        interactionId: "interaction-karen-1",
        signalText: "Dizziness needs follow-through",
        evidenceRefs: [
          "encounter:candidate-565b228effba846822d49798.1",
          "encounter:candidate-565b228effba846822d49798.2",
        ],
        sourceEvidence: [
          {
            evidenceRef: "encounter:candidate-565b228effba846822d49798.1",
            sourceQuote: "I feel dizzy.",
            startSeconds: 10,
            endSeconds: 12,
            speakerId: 2,
          },
          {
            evidenceRef: "encounter:candidate-565b228effba846822d49798.2",
            sourceQuote: "No blood pressure check has been arranged.",
            startSeconds: 13.5,
            endSeconds: 16.25,
          },
        ],
        idempotencyKey: "candidate-565b228effba846822d49798",
      },
    });
    expect(JSON.stringify(candidate.body)).not.toContain(
      "server-only-app-token",
    );
    expect(captured.approve).toMatchObject({
      authorization: "Bearer server-only-app-token",
      actorId: "clinician-1",
      correlationId: "corr-http-approve",
    });
  });

  it("carries a Corti pipeline request across the real HTTP boundary", async () => {
    const response = await request(app)
      .post("/api/corti/candidates/generate")
      .set("x-correlation-id", "corr-http-pipeline")
      .send({
        patientId: "synthetic-karen",
        interactionId: "interaction-karen-1",
        segments: [{ text: "Synthetic transcript segment" }],
      })
      .expect(200);

    expect(response.body.candidates[0].candidateId).toBe(
      "candidate-from-pipeline",
    );
    expect(captured.pipelineCandidates).toMatchObject({
      correlationId: "corr-http-pipeline",
    });
    expect(captured.pipelineCandidates?.authorization).toBeUndefined();
  });

  it("orchestrates handover HTTP boundaries without leaking the agentic credential", async () => {
    const response = await request(app)
      .post("/api/patients/synthetic-karen/handovers")
      .set("x-actor-id", "clinician:karen")
      .set("x-correlation-id", "corr-http-handover")
      .send({
        reason: "assignment",
        focus: null,
        idempotencyKey: "handover-http-001",
      })
      .expect(201);

    expect(response.body).toEqual(handover(true));
    expect(captured.handoverDraft).toMatchObject({
      authorization: "Bearer server-only-app-token",
      actorId: "clinician:karen",
      correlationId: "corr-http-handover",
    });
    expect(captured.handoverRender).toMatchObject({
      actorId: "clinician:karen",
      correlationId: "corr-http-handover",
      body: {
        handoverId: "22222222-2222-4222-8222-222222222222",
        patientId: "synthetic-karen",
        sourceSnapshotHash: handoverHash,
        packet: handoverPacket,
      },
    });
    expect(captured.handoverRender?.authorization).toBeUndefined();
    expect(captured.handoverFinalize).toMatchObject({
      authorization: "Bearer server-only-app-token",
      actorId: "clinician:karen",
      correlationId: "corr-http-handover",
      body: {
        expectedVersion: 2,
        sourceSnapshotHash: handoverHash,
        rendered: {
          title: "Current handover",
          sections: [],
          creditsConsumed: 1,
        },
      },
    });
    expect(JSON.stringify(response.body)).not.toContain(
      "server-only-app-token",
    );
  });

  it("preserves successful pipeline status codes", async () => {
    const response = await request(app)
      .post("/api/corti/ambient/session")
      .send({ encounterIdentifier: "karen-demo" })
      .expect(201);

    expect(response.body.interactionId).toBe("interaction-karen-1");
    expect(captured.ambientSession?.body).toEqual({
      encounterIdentifier: "karen-demo",
    });
  });

  it("resumes a real upstream event stream without exposing credentials", async () => {
    const response = await request(app)
      .get("/api/events/stream")
      .set("last-event-id", "41")
      .set("x-correlation-id", "corr-http-stream")
      .expect(200);

    expect(response.text).toContain("id: 42");
    expect(response.text).toContain("state\":\"tracking");
    expect(response.text).not.toContain("server-only-app-token");
    expect(captured.stream).toMatchObject({
      authorization: "Bearer server-only-app-token",
      correlationId: "corr-http-stream",
      lastEventId: "41",
    });
  });
});

function capture(request: express.Request): CapturedRequest {
  return {
    ...(request.header("authorization")
      ? { authorization: request.header("authorization") }
      : {}),
    ...(request.header("x-actor-id")
      ? { actorId: request.header("x-actor-id") }
      : {}),
    ...(request.header("x-correlation-id")
      ? { correlationId: request.header("x-correlation-id") }
      : {}),
    ...(request.header("last-event-id")
      ? { lastEventId: request.header("last-event-id") }
      : {}),
    ...(request.body === undefined ? {} : { body: request.body }),
  };
}

function listen(app: express.Express): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function baseUrl(server: Server): string {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }
  return `http://127.0.0.1:${address.port}`;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
