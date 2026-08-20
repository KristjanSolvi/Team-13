import { createHash } from "node:crypto";

import { z } from "zod";

import type {
  AgenticGateway,
  DownstreamGateway,
  RequestMeta,
} from "./gateways.js";

const pendingDeliverySchema = z
  .object({
    deliveryId: z.string().min(1).max(160),
    sourceTaskId: z.string().min(1).max(160),
    patientId: z.string().min(1).max(160),
  })
  .strip();

const taskSchema = z
  .object({
    taskId: z.string().min(1).max(160),
    state: z.enum([
      "draft",
      "offered_to_team",
      "assigned_to_member",
      "accepted",
      "completed",
      "verified",
      "escalated",
      "dismissed",
    ]),
    version: z.number().int().positive(),
  })
  .strip();

const independentReadbackSchema = z
  .object({
    deliveryId: z.string().min(1).max(160),
    sourceTaskId: z.string().min(1).max(160),
    status: z.enum(["submitted", "accepted", "completed", "rejected"]),
    outcomeReference: z.string().min(1).max(240).nullable(),
    verifierActorId: z.string().startsWith("downstream:").max(120),
    independentlyVerifiable: z.boolean(),
  })
  .strip();

export interface ReconciliationResult {
  checked: number;
  acknowledged: number;
  pending: number;
  failed: number;
}

export class DownstreamReadbackReconciler {
  private active: Promise<ReconciliationResult> | null = null;

  constructor(
    private readonly agentic: AgenticGateway,
    private readonly downstream: DownstreamGateway,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  runOnce(): Promise<ReconciliationResult> {
    if (this.active !== null) return this.active;
    this.active = this.reconcile().finally(() => {
      this.active = null;
    });
    return this.active;
  }

  start(intervalMs: number): NodeJS.Timeout {
    void this.runOnce().catch(this.onError);
    const timer = setInterval(() => {
      void this.runOnce().catch(this.onError);
    }, intervalMs);
    timer.unref();
    return timer;
  }

  private async reconcile(): Promise<ReconciliationResult> {
    const raw = await this.downstream.listPendingReadbacks({
      correlationId: "downstream-reconcile-list",
      actorId: "system:integration-reconciler",
    });
    const deliveries = z.array(pendingDeliverySchema).parse(raw);
    const result: ReconciliationResult = {
      checked: deliveries.length,
      acknowledged: 0,
      pending: 0,
      failed: 0,
    };

    for (const delivery of deliveries) {
      try {
        const meta = reconciliationMeta(delivery.deliveryId);
        const readback = independentReadbackSchema.parse(
          await this.downstream.readback(delivery.deliveryId, meta),
        );
        if (
          readback.deliveryId !== delivery.deliveryId ||
          readback.sourceTaskId !== delivery.sourceTaskId
        ) {
          throw new Error("Downstream readback identity mismatch");
        }
        if (
          !readback.independentlyVerifiable ||
          readback.status !== "completed" ||
          readback.outcomeReference === null
        ) {
          result.pending += 1;
          continue;
        }

        const task = taskSchema.parse(
          (await this.agentic.listTasks(delivery.patientId, meta)).find(
            (candidate) =>
              typeof candidate === "object" &&
              candidate !== null &&
              "taskId" in candidate &&
              candidate.taskId === delivery.sourceTaskId,
          ),
        );
        await this.agentic.verifyExternal(
          delivery.sourceTaskId,
          {
            expectedVersion: task.version,
            outcomeRef: readback.outcomeReference,
            deliveryId: delivery.deliveryId,
            idempotencyKey: `external-verify:${delivery.deliveryId}`,
          },
          {
            ...meta,
            actorId: readback.verifierActorId,
          },
        );
        await this.downstream.acknowledgeReadback(
          delivery.deliveryId,
          { outcomeReference: readback.outcomeReference },
          {
            ...meta,
            actorId: "system:integration-reconciler",
          },
        );
        result.acknowledged += 1;
      } catch (error) {
        result.failed += 1;
        this.onError(error);
      }
    }
    return result;
  }
}

function reconciliationMeta(deliveryId: string): RequestMeta {
  const suffix = createHash("sha256").update(deliveryId).digest("hex").slice(0, 24);
  return {
    correlationId: `downstream-reconcile-${suffix}`,
    actorId: "system:integration-reconciler",
  };
}
