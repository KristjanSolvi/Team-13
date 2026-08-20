import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createPatientProfileApp } from "../src/app.js";
import { openProfileDatabase } from "../src/database.js";
import { PatientProfileService } from "../src/service.js";
import { PatientProfileStore } from "../src/store.js";
import { profile } from "./helpers.js";

const token = "private-profile-token";

describe("patient profile HTTP API", () => {
  let app: ReturnType<typeof createPatientProfileApp>;

  beforeEach(() => {
    const store = new PatientProfileStore(openProfileDatabase(":memory:"));
    app = createPatientProfileApp({
      service: new PatientProfileService(
        store,
        () => new Date("2026-08-20T12:00:00.000Z"),
        () => "referral-http-1",
      ),
      bearerToken: token,
    });
  });

  it("keeps health public and patient data private", async () => {
    await request(app).get("/healthz").expect(200, { status: "ok" });
    const contract = await request(app).get("/openapi.json").expect(200);
    const unauthorized = await request(app)
      .get("/api/patients/p1/profile")
      .expect(401);
    expect(unauthorized.body.error.code).toBe("UNAUTHORIZED");
    expect(contract.body.paths).toHaveProperty(
      "/api/patients/{patientId}/referral-snapshots",
    );
    expect(JSON.stringify(contract.body)).not.toContain(token);
  });

  it("creates, reads, and updates an attributed profile", async () => {
    const created = await authorized(
      request(app).post("/api/patients/p1/profile"),
    )
      .set("x-actor-id", "clinician-1")
      .send({ idempotencyKey: "create-p1-001", profile })
      .expect(201);
    const updated = await authorized(
      request(app).patch("/api/patients/p1/profile"),
    )
      .set("x-actor-id", "clinician-2")
      .send({
        expectedVersion: 1,
        idempotencyKey: "update-p1-001",
        reason: "Patient corrected preferred language",
        changes: { referralDetails: { preferredLanguage: "Danish" } },
      })
      .expect(200);
    const read = await authorized(
      request(app).get("/api/patients/p1/profile"),
    ).expect(200);

    expect(created.body.version).toBe(1);
    expect(updated.body.version).toBe(2);
    expect(read.body.profile.referralDetails.preferredLanguage).toBe("Danish");
    expect(read.headers["cache-control"]).toBe("no-store");
  });

  it("requires actor attribution and validates manual fields", async () => {
    const missingActor = await authorized(
      request(app).post("/api/patients/p1/profile"),
    )
      .send({ idempotencyKey: "create-p1-001", profile })
      .expect(400);
    const invalidEmail = await authorized(
      request(app).post("/api/patients/p1/profile"),
    )
      .set("x-actor-id", "clinician-1")
      .send({
        idempotencyKey: "create-p1-001",
        profile: { ...profile, contact: { ...profile.contact, email: "bad" } },
      })
      .expect(400);

    expect(missingActor.body.error.code).toBe("ACTOR_REQUIRED");
    expect(invalidEmail.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("creates immutable referral snapshots with correlation metadata", async () => {
    await authorized(request(app).post("/api/patients/p1/profile"))
      .set("x-actor-id", "clinician-1")
      .send({ idempotencyKey: "create-p1-001", profile })
      .expect(201);
    const referral = await authorized(
      request(app).post("/api/patients/p1/referral-snapshots"),
    )
      .set("x-actor-id", "clinician-1")
      .set("x-correlation-id", "corr-referral-http")
      .send({
        idempotencyKey: "referral-p1-001",
        referralType: "physiotherapy",
        destination: "Community physiotherapy",
        clinicalReason: "Stairs assessment before discharge",
        additionalInstructions: null,
      })
      .expect(201);

    expect(referral.body).toMatchObject({
      referralId: "referral-http-1",
      profileVersion: 1,
      currentProfileVersion: 1,
      profileChanged: false,
      correlationId: "corr-referral-http",
    });
  });
});

function authorized(value: request.Test): request.Test {
  return value.set("authorization", `Bearer ${token}`);
}
