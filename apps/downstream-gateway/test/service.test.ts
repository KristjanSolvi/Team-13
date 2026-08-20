import { describe, expect, it } from "vitest";

import type {
  ProviderReadback,
  ProviderReceipt,
  ProviderSubmission,
} from "../src/contracts.js";
import type { DownstreamProvider } from "../src/provider.js";
import { DownstreamGatewayService } from "../src/service.js";
import { createHarness, deliveryInput } from "./helpers.js";

describe("downstream gateway service", () => {
  it("persists an intent and records the provider receipt", async () => {
    const { service } = createHarness();

    const delivery = await service.createDelivery(
      deliveryInput,
      "clinician-1",
      "corr-delivery-1",
    );

    expect(delivery).toMatchObject({
      schemaVersion: "1",
      deliveryId: "delivery-1",
      sourceTaskId: "task-karen-bp-1",
      patientId: "synthetic-karen",
      targetSystem: "district-nursing",
      status: "submitted",
      externalReference: "sim:district-nursing:delivery-1",
      createdBy: "clinician-1",
      correlationId: "corr-delivery-1",
    });
    expect(service.listPendingReadbacks()).toEqual([delivery]);
    expect(service.listEvents(delivery.deliveryId).map((event) => event.eventType)).toEqual([
      "delivery.intent_recorded",
      "delivery.provider_status_observed",
    ]);
  });

  it("replays a submission without creating another provider item", async () => {
    const { service } = createHarness();
    const first = await service.createDelivery(
      deliveryInput,
      "clinician-1",
      "corr-delivery-1",
    );
    const replay = await service.createDelivery(
      deliveryInput,
      "clinician-1",
      "corr-retry",
    );

    expect(replay).toEqual(first);
    expect(service.listTaskDeliveries(deliveryInput.sourceTaskId)).toEqual([
      first,
    ]);
  });

  it("rejects idempotency reuse with changed input or actor", async () => {
    const { service } = createHarness();
    await service.createDelivery(
      deliveryInput,
      "clinician-1",
      "corr-delivery-1",
    );

    await expect(
      service.createDelivery(
        { ...deliveryInput, summary: "Different request" },
        "clinician-1",
        "corr-delivery-2",
      ),
    ).rejects.toThrow(/different delivery/i);
    await expect(
      service.createDelivery(
        deliveryInput,
        "clinician-2",
        "corr-delivery-3",
      ),
    ).rejects.toThrow(/different delivery/i);
  });

  it("prevents duplicate delivery when a caller accidentally changes the key", async () => {
    const { service } = createHarness();
    await service.createDelivery(
      deliveryInput,
      "clinician-1",
      "corr-delivery-1",
    );

    await expect(
      service.createDelivery(
        { ...deliveryInput, idempotencyKey: "deliver-task-002" },
        "clinician-1",
        "corr-delivery-2",
      ),
    ).rejects.toThrow(/already delivered/i);
  });

  it("recovers safely when the provider fails after the intent is stored", async () => {
    const { store, provider } = createHarness();
    let attempts = 0;
    const flaky: DownstreamProvider = {
      async submit(input: ProviderSubmission): Promise<ProviderReceipt> {
        attempts += 1;
        if (attempts === 1) throw new Error("connection reset");
        return provider.submit(input);
      },
      async read(externalReference: string): Promise<ProviderReadback> {
        return provider.read(externalReference);
      },
    };
    let tick = 0;
    const service = new DownstreamGatewayService(
      store,
      flaky,
      provider,
      () => new Date(`2026-08-20T13:00:0${tick++}.000Z`),
      () => "delivery-retry-1",
    );

    await expect(
      service.createDelivery(deliveryInput, "clinician-1", "corr-first"),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });
    expect(service.getDelivery("delivery-retry-1").status).toBe(
      "submission_failed",
    );

    const recovered = await service.createDelivery(
      deliveryInput,
      "clinician-1",
      "corr-retry",
    );
    expect(recovered.status).toBe("submitted");
    expect(recovered.statusReason).toBeNull();
    expect(attempts).toBe(2);
    expect(service.listTaskDeliveries(deliveryInput.sourceTaskId)).toHaveLength(1);
  });

  it("reports unexpected provider read failures as retryable upstream errors", async () => {
    const { store, provider } = createHarness();
    const unreadable: DownstreamProvider = {
      async submit(input: ProviderSubmission): Promise<ProviderReceipt> {
        return provider.submit(input);
      },
      async read(_externalReference: string): Promise<ProviderReadback> {
        throw new Error("provider timed out");
      },
    };
    const service = new DownstreamGatewayService(
      store,
      unreadable,
      provider,
      () => new Date("2026-08-20T12:00:00.000Z"),
      () => "delivery-1",
    );
    const delivery = await service.createDelivery(
      deliveryInput,
      "clinician-1",
      "corr-delivery-1",
    );

    await expect(service.readback(delivery.deliveryId)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      status: 502,
      retryable: true,
    });
  });

  it("returns independently verifiable readback only after provider completion", async () => {
    const { service } = createHarness();
    const delivery = await service.createDelivery(
      deliveryInput,
      "clinician-1",
      "corr-delivery-1",
    );
    const pending = await service.readback(delivery.deliveryId);
    expect(pending).toMatchObject({
      status: "submitted",
      outcomeReference: null,
      independentlyVerifiable: false,
    });

    await service.simulateProviderStatus(
      delivery.deliveryId,
      {
        idempotencyKey: "provider-accept-001",
        status: "accepted",
        outcomeReference: null,
        reason: null,
      },
      "downstream:district-nursing",
    );
    const completed = await service.simulateProviderStatus(
      delivery.deliveryId,
      {
        idempotencyKey: "provider-complete-001",
        status: "completed",
        outcomeReference: "record:bp-result-1",
        reason: null,
      },
      "downstream:district-nursing",
    );

    expect(completed).toMatchObject({
      sourceTaskId: deliveryInput.sourceTaskId,
      status: "completed",
      outcomeReference: "record:bp-result-1",
      verifierActorId: "downstream:district-nursing",
      independentlyVerifiable: true,
    });
    expect(service.listPendingReadbacks()).toEqual([]);
    expect(await service.readback(delivery.deliveryId)).toMatchObject({
      independentlyVerifiable: true,
    });
  });

  it("enforces provider transitions and simulation attribution", async () => {
    const { service } = createHarness();
    const delivery = await service.createDelivery(
      deliveryInput,
      "clinician-1",
      "corr-delivery-1",
    );
    const update = {
      idempotencyKey: "provider-complete-001",
      status: "completed" as const,
      outcomeReference: "record:bp-result-1",
      reason: null,
    };

    await expect(
      service.simulateProviderStatus(delivery.deliveryId, update, "clinician-1"),
    ).rejects.toThrow(/downstream actor/i);
    await service.simulateProviderStatus(
      delivery.deliveryId,
      update,
      "downstream:district-nursing",
    );
    await expect(
      service.simulateProviderStatus(
        delivery.deliveryId,
        {
          idempotencyKey: "provider-accept-002",
          status: "accepted",
          outcomeReference: null,
          reason: null,
        },
        "downstream:district-nursing",
      ),
    ).rejects.toThrow(/cannot change/i);
  });

  it("can disable all provider simulation mutations", async () => {
    const { store, provider } = createHarness();
    const service = new DownstreamGatewayService(
      store,
      provider,
      null,
      () => new Date("2026-08-20T12:00:00.000Z"),
      () => "delivery-1",
    );
    const delivery = await service.createDelivery(
      deliveryInput,
      "clinician-1",
      "corr-delivery-1",
    );

    await expect(
      service.simulateProviderStatus(
        delivery.deliveryId,
        {
          idempotencyKey: "provider-accept-001",
          status: "accepted",
          outcomeReference: null,
          reason: null,
        },
        "downstream:district-nursing",
      ),
    ).rejects.toMatchObject({ code: "SIMULATION_DISABLED", status: 403 });
  });
});
