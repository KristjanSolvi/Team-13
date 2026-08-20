import type {
  ProviderReadback,
  ProviderReceipt,
  ProviderSubmission,
  SimulateProviderStatusInput,
} from "./contracts.js";
import { DownstreamError } from "./errors.js";

export interface DownstreamProvider {
  submit(input: ProviderSubmission): Promise<ProviderReceipt>;
  read(externalReference: string): Promise<ProviderReadback>;
}

export interface SimulatedDownstreamProvider extends DownstreamProvider {
  setStatus(
    externalReference: string,
    input: SimulateProviderStatusInput,
    actorId: string,
  ): Promise<ProviderReadback>;
}

export class UnconfiguredDownstreamProvider implements DownstreamProvider {
  async submit(_input: ProviderSubmission): Promise<ProviderReceipt> {
    throw new DownstreamError(
      "PROVIDER_NOT_CONFIGURED",
      "No downstream provider adapter is configured",
      503,
      true,
    );
  }

  async read(_externalReference: string): Promise<ProviderReadback> {
    throw new DownstreamError(
      "PROVIDER_NOT_CONFIGURED",
      "No downstream provider adapter is configured",
      503,
      true,
    );
  }
}
