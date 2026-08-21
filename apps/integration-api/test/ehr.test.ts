import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createIntegrationApp } from "../src/app.js";
import type {
  AgenticGateway,
  MockEhrGateway,
  PipelineGateway,
  ProfileGateway,
} from "../src/gateways.js";
import { IntegrationService } from "../src/service.js";

function harness() {
  const agentic: AgenticGateway = {
    health: vi.fn(async () => ({ ok: true })),
    submitSignal: vi.fn(async () => ({})),
    listThreads: vi.fn(async () => []),
    listTasks: vi.fn(async () => []),
    taskCommand: vi.fn(async () => ({})),
    verifyExternal: vi.fn(async () => ({})),
    createDemoSession: vi.fn(async () => ({})),
    getDemoSession: vi.fn(async () => ({})),
    joinDemoSession: vi.fn(async () => ({})),
    assignDemoTask: vi.fn(async () => ({})),
    demoParticipantView: vi.fn(async () => ({})),
    eventStream: vi.fn(async () => new ReadableStream<Uint8Array>()),
  };
  const pipeline: PipelineGateway = {
    health: vi.fn(async () => ({
      status: "ok",
      cortiConfigured: true,
      missingCortiVariables: [],
    })),
    request: vi.fn(async () => ({ status: 200, body: {} })),
  };
  const profile: ProfileGateway = {
    health: vi.fn(async () => ({ status: "ok" })),
    getProfile: vi.fn(async (patientId) => ({
      schemaVersion: "1",
      patientId,
      profile: {
        displayName: "Arthur M. Pender",
        location: { bed: "04", bay: "Bay A" },
        flow: { homeTomorrow: false },
      },
      version: 2,
    })),
    updateProfile: vi.fn(async (patientId, body) => ({
      schemaVersion: "1",
      patientId,
      profile: {
        displayName: "Arthur M. Pender",
        location: { bed: "04", bay: "Bay A" },
        flow: { homeTomorrow: true },
      },
      version: (body.expectedVersion as number) + 1,
    })),
    createReferralSnapshot: vi.fn(async (patientId, body) => ({
      schemaVersion: "1",
      referralId: "referral-1",
      patientId,
      ...body,
      profileVersion: 2,
    })),
    listReferralSnapshots: vi.fn(async () => []),
    getReferralSnapshot: vi.fn(async (referralId) => ({
      schemaVersion: "1",
      referralId,
      patientId: "synthetic-karen",
      profileVersion: 2,
      currentProfileVersion: 2,
      profileChanged: false,
    })),
  };
  const mockEhr: MockEhrGateway = {
    health: vi.fn(async () => ({ status: "ok" })),
    listDocuments: vi.fn(async () => [
      {
        documentId: "document-1",
        category: "medical",
        status: "filed",
        version: 2,
      },
    ]),
    createDocument: vi.fn(async (patientId, body) => ({
      documentId: "document-2",
      patientId,
      ...body,
      status: "draft",
      version: 1,
    })),
    reviseDocument: vi.fn(async (documentId, body) => ({
      documentId,
      content: (body.changes as { content: string }).content,
      version: 2,
      status: "draft",
    })),
    fileDocument: vi.fn(async (documentId) => ({
      documentId,
      version: 3,
      status: "filed",
    })),
    documentHistory: vi.fn(async () => [{ version: 3 }, { version: 2 }, { version: 1 }]),
  };
  const service = new IntegrationService(
    agentic,
    pipeline,
    () => new Date("2026-08-20T12:00:00.000Z"),
    { profile, mockEhr },
  );
  return {
    profile,
    mockEhr,
    app: createIntegrationApp({
      service,
      integrationApiBearerToken: "integration-public-token",
    }),
  };
}

describe("UI-facing mock EHR boundary", () => {
  it("includes profile and mock-EHR dependencies in readiness", async () => {
    const { app } = harness();

    const response = await request(app).get("/readyz").expect(200);

    expect(response.body.services.profile).toEqual({
      reachable: true,
      detail: { status: "ok" },
    });
    expect(response.body.services.mockEhr).toEqual({
      reachable: true,
      detail: { status: "ok" },
    });
  });

  it("composes the live patient profile and mock-EHR documents into one record", async () => {
    const { profile, mockEhr, app } = harness();

    const response = await request(app)
      .get("/api/ehr/patients/synthetic-karen")
      .set("x-correlation-id", "corr-ehr-read")
      .expect(200);

    expect(response.body).toEqual({
      schemaVersion: "1",
      patientId: "synthetic-karen",
      profile: {
        schemaVersion: "1",
        patientId: "synthetic-karen",
        profile: {
          displayName: "Arthur M. Pender",
          location: { bed: "04", bay: "Bay A" },
          flow: { homeTomorrow: false },
        },
        version: 2,
      },
      documents: [
        {
          documentId: "document-1",
          category: "medical",
          status: "filed",
          version: 2,
        },
      ],
      observedAt: "2026-08-20T12:00:00.000Z",
    });
    expect(profile.getProfile).toHaveBeenCalledWith("synthetic-karen", {
      correlationId: "corr-ehr-read",
    });
    expect(mockEhr.listDocuments).toHaveBeenCalledWith("synthetic-karen", {
      correlationId: "corr-ehr-read",
    });
  });

  it("uses the existing versioned profile as the patient write model", async () => {
    const { profile, app } = harness();
    const body = {
      expectedVersion: 2,
      idempotencyKey: "profile-ehr-update-001",
      reason: "Discharge plan confirmed in Nervecentre",
      changes: { flow: { homeTomorrow: true } },
    };

    const response = await request(app)
      .patch("/api/ehr/patients/synthetic-karen/profile")
      .set("x-actor-id", "clinician:marriott")
      .set("x-correlation-id", "corr-ehr-profile")
      .send(body)
      .expect(200);

    expect(response.body.profile.version).toBe(3);
    expect(profile.updateProfile).toHaveBeenCalledWith(
      "synthetic-karen",
      body,
      {
        actorId: "clinician:marriott",
        correlationId: "corr-ehr-profile",
      },
    );
  });

  it("forwards document draft, revision, filing, and history operations", async () => {
    const { mockEhr, app } = harness();
    const codingReview = {
      outcome: "accepted" as const,
      approvalId: "record-review-001",
      system: "icd10int-outpatient" as const,
      selectedCode: {
        suggestionKind: "supported" as const,
        code: "R52",
        display: "Pain, unspecified",
        evidenceStatus: "validated" as const,
        evidences: [{ text: "pain", start: 0, end: 4 }],
      },
    };
    const created = await request(app)
      .post("/api/ehr/patients/synthetic-karen/documents")
      .set("x-actor-id", "clinician:marriott")
      .send({
        idempotencyKey: "document-create-001",
        category: "medical",
        title: "Ward round note",
        content: "Initial draft.",
        source: "scribe",
        codingReview,
      })
      .expect(201);
    const revised = await request(app)
      .patch("/api/ehr/documents/document-2")
      .set("x-actor-id", "clinician:marriott")
      .send({
        expectedVersion: 1,
        idempotencyKey: "document-revise-001",
        reason: "Clinician corrected wording",
        changes: { content: "Reviewed draft." },
      })
      .expect(200);
    const filed = await request(app)
      .post("/api/ehr/documents/document-2/file")
      .set("x-actor-id", "clinician:marriott")
      .send({
        expectedVersion: 2,
        idempotencyKey: "document-file-001",
        reason: "Clinician approved for the record",
      })
      .expect(200);
    const history = await request(app)
      .get("/api/ehr/documents/document-2/history")
      .expect(200);

    expect(created.body).toMatchObject({ documentId: "document-2", status: "draft" });
    expect(revised.body).toMatchObject({ content: "Reviewed draft.", version: 2 });
    expect(filed.body).toMatchObject({ status: "filed", version: 3 });
    expect(history.body.versions).toHaveLength(3);
    expect(mockEhr.createDocument).toHaveBeenCalledOnce();
    expect(mockEhr.createDocument).toHaveBeenCalledWith(
      "synthetic-karen",
      expect.objectContaining({ codingReview }),
      expect.objectContaining({ actorId: "clinician:marriott" }),
    );
    expect(mockEhr.reviseDocument).toHaveBeenCalledOnce();
    expect(mockEhr.fileDocument).toHaveBeenCalledOnce();
  });

  it("requires actor attribution for all mock-EHR writes", async () => {
    const { profile, mockEhr, app } = harness();

    const response = await request(app)
      .patch("/api/ehr/patients/synthetic-karen/profile")
      .send({
        expectedVersion: 2,
        idempotencyKey: "profile-ehr-update-001",
        reason: "Discharge plan confirmed in Nervecentre",
        changes: { flow: { homeTomorrow: true } },
      })
      .expect(400);

    expect(response.body.error.code).toBe("ACTOR_REQUIRED");
    expect(profile.updateProfile).not.toHaveBeenCalled();
    expect(mockEhr.createDocument).not.toHaveBeenCalled();
  });
});
