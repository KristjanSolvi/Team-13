import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createPipelineApp } from "./app.js";
import type { CortiGateway } from "./gateway.js";
import { renderGroundedHandover } from "./handover.js";

function gateway(): CortiGateway {
  return {
    createAmbientSession: vi.fn(async () => ({
      interactionId: "interaction-1",
      accessToken: "scoped-token",
      expiresIn: 300,
      tenantName: "tenant",
      environment: "eu",
      primaryLanguage: "en",
      outputLanguage: "en",
    })),
    mintAmbientToken: vi.fn(async () => ({
      accessToken: "ambient-token",
      expiresIn: 300,
    })),
    mintDictationToken: vi.fn(async () => ({
      accessToken: "dictation-token",
      expiresIn: 300,
    })),
    reviewTranscript: vi.fn(async () => ({
      status: "reviewed" as const,
      suggestions: [],
      rejectedSuggestionCount: 0,
      creditsConsumed: 0.005,
      originalTranscriptPreserved: true as const,
    })),
    generateCandidates: vi.fn(async () => ({
      candidates: [],
      rejectedEvidenceCount: 0,
      rejectedAudioQualityCount: 0,
      creditsConsumed: 0.01,
    })),
    generateSupportingDocument: vi.fn(async (input) => ({
      documentType: input.documentType,
      name: "Draft",
      sections: [],
      creditsConsumed: 0.02,
      status: "draft" as const,
    })),
    renderHandover: vi.fn(async () => ({
      title: "Current patient handover",
      sections: [],
      creditsConsumed: 0,
    })),
    predictCodes: vi.fn(async (input) => ({
      system: input.system ?? "icd10int-outpatient",
      codes: [],
      candidates: [],
      creditsConsumed: 0.03,
    })),
  };
}

const handoverRequest = {
  handoverId: "33333333-3333-4333-8333-333333333333",
  patientId: "synthetic-karen",
  sourceSnapshotHash:
    "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  packet: {
    situation: [
      {
        statement: "Karen reports dizziness.",
        sourceRefs: ["encounter:sentence-42"],
      },
    ],
    background: [],
    currentConcerns: [],
    outstandingTasks: [],
    awaitingVerification: [],
    escalations: [],
    unknowns: [],
  },
};

describe("pipeline HTTP contract", () => {
  it("reports contract-only mode without leaking credential values", async () => {
    const app = createPipelineApp({
      gateway: null,
      missingCortiVariables: ["CORTI_CLIENT_SECRET"],
    });

    await request(app)
      .get("/health")
      .expect(200, {
        status: "ok",
        cortiConfigured: false,
        missingCortiVariables: ["CORTI_CLIENT_SECRET"],
      });

    const response = await request(app)
      .post("/api/corti/dictation/token")
      .expect(503);
    expect(response.body).toMatchObject({
      error: {
        code: "CORTI_NOT_CONFIGURED",
        retryable: false,
      },
    });
    expect(response.text).not.toContain("secret");
  });

  it("returns the dedicated Ambient session contract", async () => {
    const app = createPipelineApp({ gateway: gateway() });
    const response = await request(app)
      .post("/api/corti/ambient/session")
      .set("x-correlation-id", "demo-karen")
      .send({ encounterIdentifier: "karen-demo" })
      .expect(201);

    expect(response.headers["x-correlation-id"]).toBe("demo-karen");
    expect(response.body).toEqual({
      interactionId: "interaction-1",
      accessToken: "scoped-token",
      expiresIn: 300,
      tenantName: "tenant",
      environment: "eu",
      primaryLanguage: "en",
      outputLanguage: "en",
    });
  });

  it("previews an allow-listed dictated change without committing it", async () => {
    const app = createPipelineApp({
      gateway: gateway(),
    });
    const response = await request(app)
      .post("/api/corti/dictation/revision-preview")
      .send({
        taskId: "task-karen-bp",
        expectedVersion: 1,
        idempotencyKey: "correct-karen-001",
        transcript: "Route to district nursing within 48 hours and mark medium.",
        recipientTeams: [
          {
            id: "district-nursing",
            label: "District Nursing Team",
            aliases: ["district nursing"],
          },
        ],
      })
      .expect(200);

    expect(response.body).toMatchObject({
      requiresConfirmation: true,
      draft: {
        inputMethod: "dictated",
        expectedVersion: 1,
        idempotencyKey: "correct-karen-001",
        patch: {
          targetTeamId: "district-nursing",
          dueInMs: 172_800_000,
          clinicalUrgency: "medium",
        },
      },
    });
  });

  it("rejects malformed evidence before invoking Corti", async () => {
    const mockGateway = gateway();
    const app = createPipelineApp({ gateway: mockGateway });
    const response = await request(app)
      .post("/api/corti/candidates/generate")
      .send({ patientId: "karen", interactionId: "interaction-1", segments: [] })
      .expect(400);

    expect(response.body.error.code).toBe("INVALID_REQUEST");
    expect(mockGateway.generateCandidates).not.toHaveBeenCalled();
  });

  it("reviews only validated final transcript input and preserves correlation", async () => {
    const mockGateway = gateway();
    const app = createPipelineApp({ gateway: mockGateway });

    const response = await request(app)
      .post("/api/corti/transcripts/review")
      .set("x-correlation-id", "corr-review-1")
      .send({
        interactionId: "interaction-1",
        contextTerms: ["paracetamol"],
        protectedTerms: ["Karen Jensen"],
        segments: [
          {
            interactionId: "interaction-1",
            segmentKey: "interaction-1:12",
            text: "The patient has been taking parachutes.",
            startSeconds: 12,
            endSeconds: 16,
            isFinal: true,
            audioQuality: "clear",
          },
        ],
      })
      .expect(200);

    expect(response.body).toMatchObject({
      status: "reviewed",
      suggestions: [],
      originalTranscriptPreserved: true,
    });
    expect(mockGateway.reviewTranscript).toHaveBeenCalledWith({
      interactionId: "interaction-1",
      correlationId: "corr-review-1",
      contextTerms: ["paracetamol"],
      protectedTerms: ["Karen Jensen"],
      segments: [
        expect.objectContaining({
          segmentKey: "interaction-1:12",
          text: "The patient has been taking parachutes.",
          isFinal: true,
        }),
      ],
    });
  });

  it("rejects an invalid transcript review before invoking Corti", async () => {
    const mockGateway = gateway();
    const app = createPipelineApp({ gateway: mockGateway });

    await request(app)
      .post("/api/corti/transcripts/review")
      .send({
        interactionId: "interaction-1",
        contextTerms: [""],
        segments: [],
      })
      .expect(400);

    expect(mockGateway.reviewTranscript).not.toHaveBeenCalled();
  });

  it("rejects a transcript segment whose end precedes its start", async () => {
    const mockGateway = gateway();
    const app = createPipelineApp({ gateway: mockGateway });

    await request(app)
      .post("/api/corti/candidates/generate")
      .send({
        patientId: "karen",
        interactionId: "interaction-1",
        segments: [
          {
            interactionId: "interaction-1",
            segmentKey: "interaction-1:16",
            text: "Reversed timing.",
            startSeconds: 16,
            endSeconds: 12,
            isFinal: true,
          },
        ],
      })
      .expect(400);

    expect(mockGateway.generateCandidates).not.toHaveBeenCalled();
  });

  it("preserves the caller correlation ID at the candidate boundary", async () => {
    const mockGateway = gateway();
    const app = createPipelineApp({ gateway: mockGateway });

    await request(app)
      .post("/api/corti/candidates/generate")
      .set("x-correlation-id", "corr-karen-1")
      .send({
        patientId: "synthetic-karen",
        interactionId: "interaction-1",
        segments: [
          {
            interactionId: "interaction-1",
            segmentKey: "interaction-1:12",
            text: "I have been dizzy since my medication changed.",
            startSeconds: 12,
            endSeconds: 16,
            isFinal: true,
            audioQuality: "clear",
          },
        ],
      })
      .expect(200);

    expect(mockGateway.generateCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: "corr-karen-1" }),
    );
  });

  it("validates and forwards the complete grounded handover packet", async () => {
    const renderHandover = vi.fn(async () => ({
      title: "Current patient handover",
      sections: [],
      creditsConsumed: 0.01,
    }));
    const app = createPipelineApp({ gateway: { ...gateway(), renderHandover } });

    await request(app)
      .post("/api/corti/handovers/render")
      .send(handoverRequest)
      .expect(200, {
        title: "Current patient handover",
        sections: [],
        creditsConsumed: 0.01,
      });

    expect(renderHandover).toHaveBeenCalledWith(handoverRequest);
  });

  it.each([121, 160])(
    "accepts a canonical patient ID with %i characters",
    async (length) => {
      const renderHandover = vi.fn(async () => ({
        title: "Current patient handover",
        sections: [],
        creditsConsumed: 0,
      }));
      const app = createPipelineApp({ gateway: { ...gateway(), renderHandover } });
      const patientId = "p".repeat(length);

      await request(app)
        .post("/api/corti/handovers/render")
        .send({ ...handoverRequest, patientId })
        .expect(200);

      expect(renderHandover).toHaveBeenCalledWith({
        ...handoverRequest,
        patientId,
      });
    },
  );

  it("preserves the patient identity exactly at the renderer boundary", async () => {
    const renderHandover = vi.fn(async () => ({
      title: "Current patient handover",
      sections: [],
      creditsConsumed: 0,
    }));
    const app = createPipelineApp({ gateway: { ...gateway(), renderHandover } });
    const patientId = " patient-identity ";

    await request(app)
      .post("/api/corti/handovers/render")
      .send({ ...handoverRequest, patientId })
      .expect(200);

    expect(renderHandover).toHaveBeenCalledWith({
      ...handoverRequest,
      patientId,
    });
  });

  it("rejects a 161-character patient identity before any normalization", async () => {
    const renderHandover = vi.fn();
    const app = createPipelineApp({ gateway: { ...gateway(), renderHandover } });
    const patientId = ` ${"p".repeat(160)}`;

    const response = await request(app)
      .post("/api/corti/handovers/render")
      .send({ ...handoverRequest, patientId })
      .expect(400);

    expect(response.body.error.code).toBe("INVALID_REQUEST");
    expect(renderHandover).not.toHaveBeenCalled();
  });

  it("preserves authoritative task whitespace in deterministic rendering", async () => {
    const noTextGeneration = vi.fn();
    const renderHandover = vi.fn((input) =>
      renderGroundedHandover(input, noTextGeneration),
    );
    const app = createPipelineApp({ gateway: { ...gateway(), renderHandover } });

    const response = await request(app)
      .post("/api/corti/handovers/render")
      .send({
        ...handoverRequest,
        packet: {
          situation: [],
          background: [],
          currentConcerns: [],
          outstandingTasks: [
            {
              taskId: "11111111-1111-4111-8111-111111111111",
              threadId: "22222222-2222-4222-8222-222222222222",
              summary: "  Check blood pressure  ",
              state: "accepted",
              targetTeamId: " district-nursing ",
              assignedMemberId: " nurse-7 ",
              clinicalUrgency: "medium",
              acceptBy: "2026-08-20T12:00:00.000Z",
              dueBy: "2026-08-22T10:00:00.000Z",
              version: 7,
              sourceRefs: [
                "task:11111111-1111-4111-8111-111111111111@7",
                "thread:22222222-2222-4222-8222-222222222222@3",
              ],
            },
          ],
          awaitingVerification: [],
          escalations: [],
          unknowns: [],
        },
      })
      .expect(200);

    expect(noTextGeneration).not.toHaveBeenCalled();
    expect(response.body.sections[0].statements[0].statement).toBe(
      "  Check blood pressure   — state: accepted; team:  district-nursing ; owner:  nurse-7 ; urgency: medium; accept by: 2026-08-20T12:00:00.000Z; due by: 2026-08-22T10:00:00.000Z.",
    );
  });

  it.each([
    ["handoverId", "not-a-uuid"],
    ["patientId", ""],
    ["sourceSnapshotHash", "sha256:not-a-hash"],
  ])("rejects malformed handover %s before invoking Corti", async (field, value) => {
    const renderHandover = vi.fn();
    const app = createPipelineApp({ gateway: { ...gateway(), renderHandover } });

    const response = await request(app)
      .post("/api/corti/handovers/render")
      .send({ ...handoverRequest, [field]: value })
      .expect(400);

    expect(response.body.error.code).toBe("INVALID_REQUEST");
    expect(renderHandover).not.toHaveBeenCalled();
  });

  it("rejects malformed nested handover task data before invoking Corti", async () => {
    const renderHandover = vi.fn();
    const app = createPipelineApp({ gateway: { ...gateway(), renderHandover } });

    await request(app)
      .post("/api/corti/handovers/render")
      .send({
        ...handoverRequest,
        packet: {
          ...handoverRequest.packet,
          outstandingTasks: [{ taskId: "not-a-uuid" }],
        },
      })
      .expect(400);

    expect(renderHandover).not.toHaveBeenCalled();
  });

  it("rejects undocumented handover fields before invoking Corti", async () => {
    const renderHandover = vi.fn();
    const app = createPipelineApp({ gateway: { ...gateway(), renderHandover } });

    await request(app)
      .post("/api/corti/handovers/render")
      .send({ ...handoverRequest, unexpected: "field" })
      .expect(400);

    expect(renderHandover).not.toHaveBeenCalled();
  });
});
