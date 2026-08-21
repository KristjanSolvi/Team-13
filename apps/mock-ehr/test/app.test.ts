import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createMockEhrApp } from "../src/app.js";
import { openMockEhrDatabase } from "../src/database.js";
import { MockEhrService } from "../src/service.js";
import { MockEhrStore } from "../src/store.js";

const token = "private-mock-ehr-token";

describe("mock EHR HTTP API", () => {
  let app: ReturnType<typeof createMockEhrApp>;

  beforeEach(() => {
    let tick = 0;
    app = createMockEhrApp({
      service: new MockEhrService(
        new MockEhrStore(openMockEhrDatabase(":memory:")),
        () => new Date(`2026-08-20T12:00:0${tick++}.000Z`),
        () => "document-http-1",
      ),
      bearerToken: token,
    });
  });

  it("keeps health and the contract public while protecting document data", async () => {
    await request(app).get("/healthz").expect(200, { status: "ok" });
    const contract = await request(app).get("/openapi.json").expect(200);
    const unauthorized = await request(app)
      .get("/api/patients/synthetic-karen/documents")
      .expect(401);

    expect(unauthorized.body.error.code).toBe("UNAUTHORIZED");
    expect(contract.body.paths).toHaveProperty(
      "/api/patients/{patientId}/documents",
    );
    expect(JSON.stringify(contract.body)).not.toContain(token);
  });

  it("creates, revises, files, and reads document history", async () => {
    const created = await authorized(
      request(app).post("/api/patients/synthetic-karen/documents"),
    )
      .set("x-actor-id", "clinician:marriott")
      .set("x-correlation-id", "corr-http-create")
      .send({
        idempotencyKey: "document-create-001",
        category: "medical",
        title: "Ward round note",
        content: "Initial draft.",
        source: "scribe",
      })
      .expect(201);
    const revised = await authorized(
      request(app).patch(`/api/documents/${created.body.documentId}`),
    )
      .set("x-actor-id", "clinician:marriott")
      .send({
        expectedVersion: 1,
        idempotencyKey: "document-revise-001",
        reason: "Clinician corrected wording",
        changes: { content: "Reviewed draft." },
      })
      .expect(200);
    const filed = await authorized(
      request(app).post(`/api/documents/${created.body.documentId}/file`),
    )
      .set("x-actor-id", "clinician:marriott")
      .send({
        expectedVersion: 2,
        idempotencyKey: "document-file-001",
        reason: "Clinician approved for the record",
      })
      .expect(200);
    const history = await authorized(
      request(app).get(`/api/documents/${created.body.documentId}/history`),
    ).expect(200);
    const listed = await authorized(
      request(app).get("/api/patients/synthetic-karen/documents"),
    ).expect(200);

    expect(created.body.correlationId).toBe("corr-http-create");
    expect(revised.body).toMatchObject({ version: 2, content: "Reviewed draft." });
    expect(filed.body).toMatchObject({ version: 3, status: "filed" });
    expect(history.body.versions.map((entry: { version: number }) => entry.version)).toEqual([
      3, 2, 1,
    ]);
    expect(listed.body.documents).toEqual([filed.body]);
    expect(listed.headers["cache-control"]).toBe("no-store");
  });

  it("attributes a persisted medical-coding decision to the clinician", async () => {
    const created = await authorized(
      request(app).post("/api/patients/synthetic-karen/documents"),
    )
      .set("x-actor-id", "clinician:marriott")
      .send({
        idempotencyKey: "document-create-coding-001",
        category: "medical",
        title: "Ward round note",
        content: "Paracetamol continued for pain.",
        source: "agent",
        codingReview: {
          outcome: "accepted",
          approvalId: "record-review-001",
          system: "icd10int-outpatient",
          selectedCode: {
            suggestionKind: "candidate",
            code: "R52",
            display: "Pain, unspecified",
            evidenceStatus: "validated",
            evidences: [{ text: "pain", start: 27, end: 31 }],
          },
        },
      })
      .expect(201);

    expect(created.body.codingReview).toMatchObject({
      outcome: "accepted",
      selectedCode: { code: "R52", suggestionKind: "candidate" },
      reviewedBy: "clinician:marriott",
    });
  });

  it("requires actor attribution for writes and validates identifiers and content", async () => {
    const missingActor = await authorized(
      request(app).post("/api/patients/synthetic-karen/documents"),
    )
      .send({
        idempotencyKey: "document-create-001",
        category: "medical",
        title: "Ward round note",
        content: "Initial draft.",
        source: "scribe",
      })
      .expect(400);
    const invalidPatient = await authorized(
      request(app).get("/api/patients/not%20safe/documents"),
    ).expect(400);
    const invalidContent = await authorized(
      request(app).post("/api/patients/synthetic-karen/documents"),
    )
      .set("x-actor-id", "clinician:marriott")
      .send({
        idempotencyKey: "document-create-001",
        category: "medical",
        title: "Ward round note",
        content: "",
        source: "scribe",
      })
      .expect(400);

    expect(missingActor.body.error.code).toBe("ACTOR_REQUIRED");
    expect(invalidPatient.body.error.code).toBe("VALIDATION_ERROR");
    expect(invalidContent.body.error.code).toBe("VALIDATION_ERROR");
  });
});

function authorized(value: request.Test): request.Test {
  return value.set("authorization", `Bearer ${token}`);
}
