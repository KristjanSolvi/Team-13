import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createDownstreamApp } from "../src/app.js";
import { createHarness, deliveryInput } from "./helpers.js";

const token = "private-gateway-token";

describe("downstream gateway HTTP API", () => {
  let app: ReturnType<typeof createDownstreamApp>;

  beforeEach(() => {
    app = createDownstreamApp({
      service: createHarness().service,
      bearerToken: token,
    });
  });

  it("keeps health and contract public while delivery data stays private", async () => {
    await request(app).get("/healthz").expect(200, { status: "ok" });
    const contract = await request(app).get("/openapi.json").expect(200);
    const unauthorized = await request(app).get("/api/deliveries/delivery-1").expect(401);

    expect(contract.body.paths).toHaveProperty(
      "/api/deliveries/{deliveryId}/readback",
    );
    expect(JSON.stringify(contract.body)).not.toContain(token);
    expect(unauthorized.body.error.code).toBe("UNAUTHORIZED");
  });

  it("creates a correlated delivery and exposes its audit trail", async () => {
    const created = await authorized(request(app).post("/api/deliveries"))
      .set("x-actor-id", "clinician-1")
      .set("x-correlation-id", "corr-http-delivery")
      .send(deliveryInput)
      .expect(201);
    const events = await authorized(
      request(app).get(`/api/deliveries/${created.body.deliveryId}/events`),
    ).expect(200);

    expect(created.body).toMatchObject({
      status: "submitted",
      correlationId: "corr-http-delivery",
    });
    expect(created.headers["cache-control"]).toBe("no-store");
    expect(events.body.events).toHaveLength(2);
  });

  it("requires attribution and rejects invalid JSON safely", async () => {
    const missingActor = await authorized(request(app).post("/api/deliveries"))
      .send(deliveryInput)
      .expect(400);
    const invalidJson = await authorized(request(app).post("/api/deliveries"))
      .set("x-actor-id", "clinician-1")
      .set("content-type", "application/json")
      .send('{"broken"')
      .expect(400);

    expect(missingActor.body.error.code).toBe("ACTOR_REQUIRED");
    expect(invalidJson.body.error).toMatchObject({
      code: "INVALID_JSON",
      message: "Request body is not valid JSON",
    });
  });

  it("labels simulated completion and returns provider readback", async () => {
    const created = await authorized(request(app).post("/api/deliveries"))
      .set("x-actor-id", "clinician-1")
      .send(deliveryInput)
      .expect(201);
    const completed = await authorized(
      request(app).post(
        `/api/simulation/deliveries/${created.body.deliveryId}/status`,
      ),
    )
      .set("x-actor-id", "downstream:district-nursing")
      .send({
        idempotencyKey: "provider-complete-001",
        status: "completed",
        outcomeReference: "record:bp-result-1",
        reason: null,
      })
      .expect(200);
    const readback = await authorized(
      request(app).post(`/api/deliveries/${created.body.deliveryId}/readback`),
    ).expect(200);

    expect(completed.body).toMatchObject({
      status: "completed",
      independentlyVerifiable: true,
    });
    expect(readback.body).toMatchObject({
      outcomeReference: "record:bp-result-1",
      verifierActorId: "downstream:district-nursing",
    });
  });

  it("validates that completed work has an outcome reference", async () => {
    const created = await authorized(request(app).post("/api/deliveries"))
      .set("x-actor-id", "clinician-1")
      .send(deliveryInput)
      .expect(201);
    const response = await authorized(
      request(app).post(
        `/api/simulation/deliveries/${created.body.deliveryId}/status`,
      ),
    )
      .set("x-actor-id", "downstream:district-nursing")
      .send({
        idempotencyKey: "provider-complete-001",
        status: "completed",
        outcomeReference: null,
        reason: null,
      })
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.message).toMatch(/outcome reference/i);
  });
});

function authorized(value: request.Test): request.Test {
  return value.set("authorization", `Bearer ${token}`);
}
