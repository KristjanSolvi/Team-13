import { createHash, randomUUID } from "node:crypto";

import type {
  CreateDeliveryInput,
  Delivery,
  DeliveryEvent,
  IndependentReadback,
  ProviderReadback,
  SimulateProviderStatusInput,
} from "./contracts.js";
import { DownstreamError } from "./errors.js";
import type {
  DownstreamProvider,
  SimulatedDownstreamProvider,
} from "./provider.js";
import type { DownstreamStore } from "./store.js";

export class DownstreamGatewayService {
  constructor(
    private readonly store: DownstreamStore,
    private readonly provider: DownstreamProvider,
    private readonly simulationProvider: SimulatedDownstreamProvider | null,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  async createDelivery(
    input: CreateDeliveryInput,
    actorId: string,
    correlationId: string,
  ): Promise<Delivery> {
    const occurredAt = this.now().toISOString();
    const intended: Delivery = {
      schemaVersion: "1",
      deliveryId: this.newId(),
      sourceTaskId: input.sourceTaskId,
      patientId: input.patientId,
      targetSystem: input.targetSystem,
      kind: input.kind,
      summary: input.summary,
      instructions: input.instructions,
      dueAt: input.dueAt,
      referralSnapshotId: input.referralSnapshotId,
      status: "pending_submission",
      externalReference: null,
      outcomeReference: null,
      statusReason: null,
      createdAt: occurredAt,
      updatedAt: occurredAt,
      createdBy: actorId,
      correlationId,
    };
    const delivery = this.store.ensureDeliveryIntent(
      intended,
      input.idempotencyKey,
      requestHash({ input, actorId }),
    );
    if (delivery.externalReference !== null) return delivery;

    try {
      const receipt = await this.provider.submit({
        deliveryId: delivery.deliveryId,
        idempotencyKey: input.idempotencyKey,
        targetSystem: delivery.targetSystem,
        kind: delivery.kind,
        summary: delivery.summary,
        instructions: delivery.instructions,
        dueAt: delivery.dueAt,
      });
      return this.store.recordProviderState(
        delivery.deliveryId,
        receipt,
        `downstream:${delivery.targetSystem}`,
        this.now().toISOString(),
      );
    } catch (error) {
      this.store.recordSubmissionFailure(
        delivery.deliveryId,
        "Provider submission failed",
        this.now().toISOString(),
      );
      if (error instanceof DownstreamError) throw error;
      throw new DownstreamError(
        "PROVIDER_UNAVAILABLE",
        "Downstream provider is temporarily unavailable",
        502,
        true,
      );
    }
  }

  getDelivery(deliveryId: string): Delivery {
    return this.requireDelivery(deliveryId);
  }

  listTaskDeliveries(sourceTaskId: string): Delivery[] {
    return this.store.listTaskDeliveries(sourceTaskId);
  }

  listPendingReadbacks(): Delivery[] {
    return this.store.listPendingReadbacks();
  }

  listEvents(deliveryId: string): DeliveryEvent[] {
    return this.store.listEvents(deliveryId);
  }

  async readback(deliveryId: string): Promise<IndependentReadback> {
    const delivery = this.requireDelivery(deliveryId);
    if (delivery.externalReference === null) {
      throw new DownstreamError(
        "DELIVERY_NOT_SUBMITTED",
        "Delivery has no provider receipt yet",
        409,
        true,
      );
    }
    let readback: ProviderReadback;
    try {
      readback = await this.provider.read(delivery.externalReference);
    } catch (error) {
      if (error instanceof DownstreamError) throw error;
      throw new DownstreamError(
        "PROVIDER_UNAVAILABLE",
        "Downstream provider is temporarily unavailable",
        502,
        true,
      );
    }
    const observedAt = this.now().toISOString();
    const updated = this.store.recordProviderState(
      deliveryId,
      readback,
      `downstream:${delivery.targetSystem}`,
      observedAt,
    );
    return independentReadback(updated, readback, observedAt);
  }

  async simulateProviderStatus(
    deliveryId: string,
    input: SimulateProviderStatusInput,
    actorId: string,
  ): Promise<IndependentReadback> {
    if (this.simulationProvider === null) {
      throw new DownstreamError(
        "SIMULATION_DISABLED",
        "Provider simulation is disabled",
        403,
      );
    }
    if (!actorId.startsWith("downstream:")) {
      throw new DownstreamError(
        "DOWNSTREAM_ACTOR_REQUIRED",
        "Provider simulation requires an attributed downstream actor",
        403,
      );
    }
    const delivery = this.requireDelivery(deliveryId);
    if (delivery.externalReference === null) {
      throw new DownstreamError(
        "DELIVERY_NOT_SUBMITTED",
        "Delivery has no provider receipt yet",
        409,
      );
    }
    const readback = await this.simulationProvider.setStatus(
      delivery.externalReference,
      input,
      actorId,
    );
    const observedAt = this.now().toISOString();
    const updated = this.store.recordProviderState(
      deliveryId,
      readback,
      actorId,
      observedAt,
    );
    return independentReadback(updated, readback, observedAt);
  }

  private requireDelivery(deliveryId: string): Delivery {
    const delivery = this.store.getDelivery(deliveryId);
    if (!delivery) {
      throw new DownstreamError(
        "DELIVERY_NOT_FOUND",
        "Downstream delivery not found",
        404,
      );
    }
    return delivery;
  }
}

function independentReadback(
  delivery: Delivery,
  provider: ProviderReadback,
  observedAt: string,
): IndependentReadback {
  return {
    schemaVersion: "1",
    deliveryId: delivery.deliveryId,
    sourceTaskId: delivery.sourceTaskId,
    externalReference: provider.externalReference,
    status: provider.status,
    providerUpdatedAt: provider.providerUpdatedAt,
    outcomeReference: provider.outcomeReference,
    reason: provider.reason,
    observedAt,
    verifierActorId: `downstream:${delivery.targetSystem}`,
    independentlyVerifiable:
      provider.status === "completed" && provider.outcomeReference !== null,
  };
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
