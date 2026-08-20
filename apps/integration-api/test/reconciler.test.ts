import { describe, expect, it, vi } from "vitest";

import type { AgenticGateway, DownstreamGateway } from "../src/gateways.js";
import { DownstreamReadbackReconciler } from "../src/reconciler.js";

const delivery = {
  deliveryId: "delivery-1",
  sourceTaskId: "task-1",
  patientId: "synthetic-karen",
};

function harness(status: "accepted" | "completed" = "completed") {
  const agentic: Pick<AgenticGateway, "listTasks" | "verifyExternal"> = {
    listTasks: vi.fn(async () => [
      { taskId: "task-1", state: "offered_to_team", version: 2 },
    ]),
    verifyExternal: vi.fn(async () => ({
      taskId: "task-1",
      state: "verified",
      version: 3,
    })),
  };
  const downstream: Pick<
    DownstreamGateway,
    | "listPendingReadbacks"
    | "readback"
    | "acknowledgeReadback"
  > = {
    listPendingReadbacks: vi.fn(async () => [delivery]),
    readback: vi.fn(async () => ({
      ...delivery,
      status,
      outcomeReference: status === "completed" ? "ehr:result-44" : null,
      verifierActorId: "downstream:district-nursing",
      independentlyVerifiable: status === "completed",
    })),
    acknowledgeReadback: vi.fn(async () => ({})),
  };
  const errors: unknown[] = [];
  const reconciler = new DownstreamReadbackReconciler(
    agentic as AgenticGateway,
    downstream as DownstreamGateway,
    (error) => errors.push(error),
  );
  return { agentic, downstream, errors, reconciler };
}

describe("downstream readback reconciliation", () => {
  it("verifies an Agentic task before acknowledging independent completion", async () => {
    const { agentic, downstream, errors, reconciler } = harness();

    await expect(reconciler.runOnce()).resolves.toEqual({
      checked: 1,
      acknowledged: 1,
      pending: 0,
      failed: 0,
    });
    expect(agentic.verifyExternal).toHaveBeenCalledWith(
      "task-1",
      {
        expectedVersion: 2,
        outcomeRef: "ehr:result-44",
        deliveryId: "delivery-1",
        idempotencyKey: "external-verify:delivery-1",
      },
      expect.objectContaining({ actorId: "downstream:district-nursing" }),
    );
    expect(downstream.acknowledgeReadback).toHaveBeenCalledWith(
      "delivery-1",
      { outcomeReference: "ehr:result-44" },
      expect.objectContaining({ actorId: "system:integration-reconciler" }),
    );
    expect(errors).toEqual([]);
  });

  it("leaves accepted work pending without fabricating completion", async () => {
    const { agentic, downstream, reconciler } = harness("accepted");

    await expect(reconciler.runOnce()).resolves.toEqual({
      checked: 1,
      acknowledged: 0,
      pending: 1,
      failed: 0,
    });
    expect(agentic.listTasks).not.toHaveBeenCalled();
    expect(agentic.verifyExternal).not.toHaveBeenCalled();
    expect(downstream.acknowledgeReadback).not.toHaveBeenCalled();
  });

  it("retries the same verification key if acknowledgement fails after verification", async () => {
    const { agentic, downstream, reconciler } = harness();
    vi.mocked(downstream.acknowledgeReadback)
      .mockRejectedValueOnce(new Error("temporary acknowledgement failure"))
      .mockResolvedValueOnce({});

    await expect(reconciler.runOnce()).resolves.toMatchObject({ failed: 1 });
    await expect(reconciler.runOnce()).resolves.toMatchObject({ acknowledged: 1 });

    expect(agentic.verifyExternal).toHaveBeenCalledTimes(2);
    const firstBody = vi.mocked(agentic.verifyExternal).mock.calls[0]?.[1];
    const secondBody = vi.mocked(agentic.verifyExternal).mock.calls[1]?.[1];
    expect(secondBody).toEqual(firstBody);
  });
});
