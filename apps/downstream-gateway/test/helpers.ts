import type { CreateDeliveryInput } from "../src/contracts.js";
import { openDownstreamDatabase } from "../src/database.js";
import { DownstreamGatewayService } from "../src/service.js";
import { SqliteSimulatedProvider } from "../src/simulated-provider.js";
import { DownstreamStore } from "../src/store.js";

export const deliveryInput: CreateDeliveryInput = {
  idempotencyKey: "deliver-task-001",
  sourceTaskId: "task-karen-bp-1",
  patientId: "synthetic-karen",
  targetSystem: "district-nursing",
  kind: "team-task",
  summary: "Check seated and standing blood pressure",
  instructions: "Complete within 48 hours and record the result.",
  dueAt: "2026-08-22T12:00:00.000Z",
  referralSnapshotId: null,
};

export function createHarness(simulationEnabled = true) {
  let tick = 0;
  const now = () => new Date(`2026-08-20T12:00:${String(tick++).padStart(2, "0")}.000Z`);
  const store = new DownstreamStore(openDownstreamDatabase(":memory:"));
  const provider = new SqliteSimulatedProvider(store, now);
  const service = new DownstreamGatewayService(
    store,
    provider,
    simulationEnabled ? provider : null,
    now,
    () => "delivery-1",
  );
  return { store, provider, service };
}
