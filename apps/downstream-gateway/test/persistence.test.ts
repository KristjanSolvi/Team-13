import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openDownstreamDatabase } from "../src/database.js";
import { DownstreamGatewayService } from "../src/service.js";
import { SqliteSimulatedProvider } from "../src/simulated-provider.js";
import { DownstreamStore } from "../src/store.js";
import { deliveryInput } from "./helpers.js";

describe("downstream gateway persistence", () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("retains the provider receipt, completion, and audit trail after restart", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "downstream-gateway-"));
    directories.push(directory);
    const databasePath = path.join(directory, "gateway.sqlite");
    const firstStore = new DownstreamStore(openDownstreamDatabase(databasePath));
    const firstProvider = new SqliteSimulatedProvider(
      firstStore,
      () => new Date("2026-08-20T12:00:01.000Z"),
    );
    const firstService = new DownstreamGatewayService(
      firstStore,
      firstProvider,
      firstProvider,
      () => new Date("2026-08-20T12:00:00.000Z"),
      () => "delivery-persisted-1",
    );
    const delivery = await firstService.createDelivery(
      deliveryInput,
      "clinician-1",
      "corr-persistence",
    );
    await firstService.simulateProviderStatus(
      delivery.deliveryId,
      {
        idempotencyKey: "provider-complete-001",
        status: "completed",
        outcomeReference: "record:bp-result-persisted",
        reason: null,
      },
      "downstream:district-nursing",
    );
    firstStore.close();

    const reopenedStore = new DownstreamStore(
      openDownstreamDatabase(databasePath),
    );
    const reopenedProvider = new SqliteSimulatedProvider(reopenedStore);
    const reopenedService = new DownstreamGatewayService(
      reopenedStore,
      reopenedProvider,
      reopenedProvider,
    );

    expect(reopenedService.getDelivery(delivery.deliveryId)).toMatchObject({
      status: "completed",
      outcomeReference: "record:bp-result-persisted",
      correlationId: "corr-persistence",
    });
    expect(await reopenedService.readback(delivery.deliveryId)).toMatchObject({
      independentlyVerifiable: true,
      outcomeReference: "record:bp-result-persisted",
    });
    expect(reopenedService.listEvents(delivery.deliveryId)).toHaveLength(3);
    reopenedStore.close();
  });
});
