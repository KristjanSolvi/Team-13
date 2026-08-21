import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createIntegrationApp } from "../src/app.js";
import type {
  AgenticGateway,
  DownstreamGateway,
  MockEhrGateway,
  PipelineGateway,
  ProfileGateway,
} from "../src/gateways.js";
import { IntegrationService } from "../src/service.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const REFERRAL_ID = "referral-snapshot-1";
const DELIVERY_ID = "delivery-1";
const PUBLIC_TOKEN = "integration-public-token";
const GENERATED_RECORD_TITLE = `Approved follow-through · Refer Karen for community mobility assessment · ${TASK_ID}`;

function harness() {
  const publishedTask = {
    taskId: TASK_ID,
    threadId: "22222222-2222-4222-8222-222222222222",
    patientId: "synthetic-karen",
    summary: "Refer Karen for community mobility assessment",
    taskType: "community-referral",
    targetTeamId: "district-nursing",
    dueBy: "2026-08-22T12:00:00.000Z",
    state: "offered_to_team",
    version: 2,
  };
  const agentic: AgenticGateway = {
    health: vi.fn(async () => ({ status: "ok" })),
    submitSignal: vi.fn(async () => ({})),
    listThreads: vi.fn(async () => []),
    listTasks: vi.fn(async () => [publishedTask]),
    taskCommand: vi.fn(async () => ({
      task: publishedTask,
      contextId: "context-1",
      cortiTaskId: "corti-task-1",
    })),
    verifyExternal: vi.fn(async () => ({ ...publishedTask, state: "verified" })),
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
    request: vi.fn(async (path) => ({
      status: 200,
      body:
        path === "/api/corti/documents/generate"
          ? {
              documentType: "clinical-note",
              name: "Approved Follow-Through Clinical Note",
              sections: [
                {
                  sectionId: "approved-action",
                  heading: "Approved follow-through note",
                  text: "Community mobility assessment was approved for district nursing.",
                },
              ],
              creditsConsumed: 0.02,
              status: "draft",
            }
          : {},
    })),
  };
  const profile: ProfileGateway = {
    health: vi.fn(async () => ({ status: "ok" })),
    getProfile: vi.fn(async () => ({})),
    updateProfile: vi.fn(async () => ({})),
    createReferralSnapshot: vi.fn(async (patientId, body) => ({
      schemaVersion: "1",
      referralId: REFERRAL_ID,
      patientId,
      ...body,
      profileVersion: 3,
    })),
    listReferralSnapshots: vi.fn(async () => [
      { referralId: REFERRAL_ID, patientId: "synthetic-karen" },
    ]),
    getReferralSnapshot: vi.fn(async (referralId) => ({
      referralId,
      patientId: "synthetic-karen",
      profileVersion: 3,
      currentProfileVersion: 3,
      profileChanged: false,
    })),
  };
  const mockEhr: MockEhrGateway = {
    health: vi.fn(async () => ({ status: "ok" })),
    listDocuments: vi.fn(async () => []),
    createDocument: vi.fn(async (patientId, body) => ({
      schemaVersion: "1",
      documentId: "document-approved-task-1",
      patientId,
      ...body,
      status: "draft",
      version: 1,
    })),
    reviseDocument: vi.fn(async () => ({})),
    fileDocument: vi.fn(async () => ({})),
    documentHistory: vi.fn(async () => []),
  };
  const downstream: DownstreamGateway = {
    health: vi.fn(async () => ({ status: "ok" })),
    createDelivery: vi.fn(async (body) => ({
      deliveryId: DELIVERY_ID,
      status: "submitted",
      ...body,
    })),
    listTaskDeliveries: vi.fn(async () => [
      { deliveryId: DELIVERY_ID, status: "submitted" },
    ]),
    listPendingReadbacks: vi.fn(async () => []),
    readback: vi.fn(async () => ({})),
    acknowledgeReadback: vi.fn(async () => ({})),
    simulateStatus: vi.fn(async (_deliveryId, body) => ({
      deliveryId: DELIVERY_ID,
      ...body,
      independentlyVerifiable: body.status === "completed",
    })),
  };
  const service = new IntegrationService(
    agentic,
    pipeline,
    () => new Date("2026-08-21T12:00:00.000Z"),
    { profile, mockEhr },
    downstream,
  );
  return {
    agentic,
    profile,
    downstream,
    pipeline,
    mockEhr,
    app: createIntegrationApp({
      service,
      integrationApiBearerToken: PUBLIC_TOKEN,
    }),
  };
}

describe("referral and downstream UI boundary", () => {
  it("exposes referral snapshots without exposing the profile-service bearer", async () => {
    const { profile, app } = harness();
    const body = {
      idempotencyKey: "referral-create-001",
      referralType: "Community care",
      destination: "District nursing",
      clinicalReason: "Mobility support is needed after discharge",
      additionalInstructions: null,
    };

    const created = await request(app)
      .post("/api/ehr/patients/synthetic-karen/referral-snapshots")
      .set("x-actor-id", "clinician:evelyn")
      .set("x-correlation-id", "corr-referral-create")
      .send(body)
      .expect(201);
    expect(created.body.referralId).toBe(REFERRAL_ID);
    expect(profile.createReferralSnapshot).toHaveBeenCalledWith(
      "synthetic-karen",
      body,
      {
        actorId: "clinician:evelyn",
        correlationId: "corr-referral-create",
      },
    );

    await request(app)
      .get("/api/ehr/patients/synthetic-karen/referral-snapshots")
      .expect(200)
      .expect({
        referrals: [
          { referralId: REFERRAL_ID, patientId: "synthetic-karen" },
        ],
      });
    await request(app)
      .get(`/api/ehr/referral-snapshots/${REFERRAL_ID}`)
      .expect(200);
  });

  it("publishes an approved referral to downstream with its immutable profile snapshot", async () => {
    const { agentic, profile, downstream, pipeline, mockEhr, app } = harness();
    const response = await request(app)
      .post(`/api/tasks/${TASK_ID}/approve`)
      .set("x-actor-id", "clinician:evelyn")
      .set("x-correlation-id", "corr-approve-referral")
      .send({
        expectedVersion: 1,
        idempotencyKey: "approve-referral-001",
        approvalChannel: "app_one_tap",
        referralSnapshotId: REFERRAL_ID,
      })
      .expect(200);

    expect(response.body.contextId).toBe("context-1");
    expect(response.body.task.threadId).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(response.body.delivery.deliveryId).toBe(DELIVERY_ID);
    expect(response.body.recordDraft).toMatchObject({
      status: "created",
      creditsConsumed: 0.02,
      document: {
        documentId: "document-approved-task-1",
        patientId: "synthetic-karen",
        status: "draft",
      },
    });
    expect(agentic.taskCommand).toHaveBeenCalledWith(
      TASK_ID,
      "approve",
      {
        expectedVersion: 1,
        idempotencyKey: "approve-referral-001",
        approvalChannel: "app_one_tap",
      },
      {
        actorId: "clinician:evelyn",
        correlationId: "corr-approve-referral",
      },
    );
    expect(profile.getReferralSnapshot).toHaveBeenCalledWith(REFERRAL_ID, {
      actorId: "clinician:evelyn",
      correlationId: "corr-approve-referral",
    });
    expect(downstream.createDelivery).toHaveBeenCalledWith(
      {
        idempotencyKey: `delivery:${TASK_ID}`,
        sourceTaskId: TASK_ID,
        patientId: "synthetic-karen",
        targetSystem: "district-nursing",
        kind: "referral",
        summary: "Refer Karen for community mobility assessment",
        instructions: null,
        dueAt: "2026-08-22T12:00:00.000Z",
        referralSnapshotId: REFERRAL_ID,
      },
      {
        actorId: "system:integration-delivery",
        correlationId: "corr-approve-referral",
      },
    );
    expect(pipeline.request).toHaveBeenCalledWith(
      "/api/corti/documents/generate",
      expect.objectContaining({
        approvalId: `task-approval:${TASK_ID}:2`,
        documentType: "clinical-note",
        approvedClinicalText: expect.stringContaining(
          "community mobility assessment",
        ),
      }),
      {
        actorId: "clinician:evelyn",
        correlationId: "corr-approve-referral",
      },
    );
    expect(mockEhr.createDocument).toHaveBeenCalledWith(
      "synthetic-karen",
      expect.objectContaining({
        idempotencyKey: `approved-task-record:${TASK_ID}:2`,
        category: "medical",
        source: "agent",
      }),
      {
        actorId: "system:corti-text-generation",
        correlationId: "corr-approve-referral",
      },
    );
  });

  it("keeps approval and delivery successful when the additive EHR draft is unavailable", async () => {
    const { pipeline, mockEhr, app } = harness();
    vi.mocked(pipeline.request).mockRejectedValueOnce(new Error("Text Generation unavailable"));

    const response = await request(app)
      .post(`/api/tasks/${TASK_ID}/approve`)
      .set("x-actor-id", "clinician:evelyn")
      .set("x-correlation-id", "corr-approve-without-record-draft")
      .send({
        expectedVersion: 1,
        idempotencyKey: "approve-without-record-draft-001",
        approvalChannel: "app_one_tap",
      })
      .expect(200);

    expect(response.body.delivery.deliveryId).toBe(DELIVERY_ID);
    expect(response.body.recordDraft).toEqual({ status: "unavailable", retryable: true });
    expect(mockEhr.createDocument).not.toHaveBeenCalled();
  });

  it("reuses an existing approved-task EHR draft without another Text Generation call", async () => {
    const { pipeline, mockEhr, app } = harness();
    vi.mocked(mockEhr.listDocuments).mockResolvedValueOnce([
      {
        documentId: "existing-approved-task-document",
        patientId: "synthetic-karen",
        title: GENERATED_RECORD_TITLE,
        status: "draft",
        version: 1,
      },
    ]);

    const response = await request(app)
      .post(`/api/tasks/${TASK_ID}/approve`)
      .set("x-actor-id", "clinician:evelyn")
      .set("x-correlation-id", "corr-approve-existing-record-draft")
      .send({
        expectedVersion: 1,
        idempotencyKey: "approve-existing-record-draft-001",
        approvalChannel: "app_one_tap",
      })
      .expect(200);

    expect(response.body.recordDraft).toMatchObject({
      status: "existing",
      creditsConsumed: 0,
      document: { documentId: "existing-approved-task-document" },
    });
    expect(pipeline.request).not.toHaveBeenCalled();
    expect(mockEhr.createDocument).not.toHaveBeenCalled();
  });

  it("keeps delivery state readable and protects synthetic provider mutation", async () => {
    const { downstream, app } = harness();

    await request(app)
      .get(`/api/tasks/${TASK_ID}/deliveries`)
      .expect(200)
      .expect({ deliveries: [{ deliveryId: DELIVERY_ID, status: "submitted" }] });

    const body = {
      idempotencyKey: "provider-complete-001",
      status: "completed",
      outcomeReference: "ehr:result-44",
      reason: null,
    };
    await request(app)
      .post(`/api/demo/downstream/deliveries/${DELIVERY_ID}/status`)
      .send(body)
      .expect(401);
    await request(app)
      .post(`/api/demo/downstream/deliveries/${DELIVERY_ID}/status`)
      .set("authorization", `Bearer ${PUBLIC_TOKEN}`)
      .set("x-correlation-id", "corr-provider-complete")
      .send(body)
      .expect(200);
    expect(downstream.simulateStatus).toHaveBeenCalledWith(
      DELIVERY_ID,
      body,
      {
        actorId: "downstream:demo-provider",
        correlationId: "corr-provider-complete",
      },
    );
  });

  it("includes downstream health and the new routes in the published contract", async () => {
    const { app } = harness();
    const readiness = await request(app).get("/readyz").expect(200);
    expect(readiness.body.services.downstream.reachable).toBe(true);

    const contract = await request(app).get("/openapi.json").expect(200);
    expect(contract.body.paths).toHaveProperty(
      "/api/ehr/patients/{patientId}/referral-snapshots",
    );
    expect(contract.body.paths).toHaveProperty(
      "/api/tasks/{taskId}/deliveries",
    );
    expect(contract.body.paths).toHaveProperty(
      "/api/demo/downstream/deliveries/{deliveryId}/status",
    );
  });
});
