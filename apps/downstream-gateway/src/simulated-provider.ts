import { createHash } from "node:crypto";

import type {
  ProviderReadback,
  ProviderReceipt,
  ProviderSubmission,
  SimulateProviderStatusInput,
} from "./contracts.js";
import { DownstreamError } from "./errors.js";
import type { SimulatedDownstreamProvider } from "./provider.js";
import type { DownstreamStore } from "./store.js";

export class SqliteSimulatedProvider implements SimulatedDownstreamProvider {
  constructor(
    private readonly store: DownstreamStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async submit(input: ProviderSubmission): Promise<ProviderReceipt> {
    const externalReference = `sim:${input.targetSystem}:${input.deliveryId}`;
    return this.store.createProviderItem(
      input.deliveryId,
      input.targetSystem,
      externalReference,
      this.now().toISOString(),
    );
  }

  async read(externalReference: string): Promise<ProviderReadback> {
    const readback = this.store.readProviderItem(externalReference);
    if (!readback) {
      throw new DownstreamError(
        "PROVIDER_ITEM_NOT_FOUND",
        "Provider work item not found",
        404,
      );
    }
    return readback;
  }

  async setStatus(
    externalReference: string,
    input: SimulateProviderStatusInput,
    actorId: string,
  ): Promise<ProviderReadback> {
    return this.store.transitionProviderItem(
      externalReference,
      input.idempotencyKey,
      hash({ input, actorId }),
      input.status,
      input.outcomeReference,
      input.reason,
      this.now().toISOString(),
    );
  }
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
