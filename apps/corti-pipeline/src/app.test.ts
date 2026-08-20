import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createPipelineApp } from "./app.js";
import type { CortiGateway } from "./gateway.js";

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
    generateCandidates: vi.fn(async () => ({
      candidates: [],
      rejectedEvidenceCount: 0,
      creditsConsumed: 0.01,
    })),
    generateSupportingDocument: vi.fn(async (input) => ({
      documentType: input.documentType,
      name: "Draft",
      sections: [],
      creditsConsumed: 0.02,
      status: "draft" as const,
    })),
    predictCodes: vi.fn(async (input) => ({
      system: input.system ?? "icd10int-outpatient",
      codes: [],
      candidates: [],
      creditsConsumed: 0.03,
    })),
  };
}

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
      now: () => new Date("2026-08-20T10:00:00.000Z"),
    });
    const response = await request(app)
      .post("/api/corti/dictation/revision-preview")
      .send({
        taskId: "task-karen-bp",
        transcript: "Route to district nursing within 48 hours and mark urgent.",
        recipientTeams: [
          {
            id: "district-nursing",
            label: "District Nursing Team",
            aliases: ["district nursing"],
          },
        ],
        owners: [],
      })
      .expect(200);

    expect(response.body).toMatchObject({
      requiresConfirmation: true,
      draft: {
        inputMethod: "dictated",
        patch: {
          recipientTeamId: "district-nursing",
          dueAt: "2026-08-22T10:00:00.000Z",
          priority: "urgent",
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
});
