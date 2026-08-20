import type { DatabaseSync } from "node:sqlite";

import type {
  Delivery,
  DeliveryEvent,
  ProviderReadback,
  ProviderReceipt,
  ProviderStatus,
} from "./contracts.js";
import { DownstreamError } from "./errors.js";

export class DownstreamStore {
  constructor(private readonly database: DatabaseSync) {}

  close(): void {
    this.database.close();
  }

  ensureDeliveryIntent(
    delivery: Delivery,
    idempotencyKey: string,
    requestHash: string,
  ): Delivery {
    return this.transaction(() => {
      const replay = this.database
        .prepare(`
          SELECT * FROM downstream_deliveries WHERE idempotency_key = ?
        `)
        .get(idempotencyKey);
      if (replay) {
        if (rowText(replay, "request_hash") !== requestHash) {
          throw new DownstreamError(
            "IDEMPOTENCY_CONFLICT",
            "Idempotency key was already used for a different delivery",
            409,
          );
        }
        return deliveryFromRow(replay);
      }

      const duplicate = this.database
        .prepare(`
          SELECT delivery_id
          FROM downstream_deliveries
          WHERE source_task_id = ? AND target_system = ? AND kind = ?
        `)
        .get(delivery.sourceTaskId, delivery.targetSystem, delivery.kind);
      if (duplicate) {
        throw new DownstreamError(
          "DELIVERY_ALREADY_EXISTS",
          "This task was already delivered to the target system",
          409,
        );
      }

      this.database
        .prepare(`
          INSERT INTO downstream_deliveries
            (delivery_id, idempotency_key, request_hash, source_task_id,
             patient_id, target_system, kind, summary, instructions, due_at,
             referral_snapshot_id, status, external_reference,
             outcome_reference, source_acknowledged_at, status_reason, created_at, updated_at,
             created_by, correlation_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          delivery.deliveryId,
          idempotencyKey,
          requestHash,
          delivery.sourceTaskId,
          delivery.patientId,
          delivery.targetSystem,
          delivery.kind,
          delivery.summary,
          delivery.instructions,
          delivery.dueAt,
          delivery.referralSnapshotId,
          delivery.status,
          delivery.externalReference,
          delivery.outcomeReference,
          delivery.sourceAcknowledgedAt,
          delivery.statusReason,
          delivery.createdAt,
          delivery.updatedAt,
          delivery.createdBy,
          delivery.correlationId,
        );
      this.appendEvent(delivery, "delivery.intent_recorded", delivery.createdBy, {
        targetSystem: delivery.targetSystem,
        kind: delivery.kind,
      });
      return delivery;
    });
  }

  getDelivery(deliveryId: string): Delivery | null {
    const row = this.database
      .prepare(`SELECT * FROM downstream_deliveries WHERE delivery_id = ?`)
      .get(deliveryId);
    return row ? deliveryFromRow(row) : null;
  }

  listTaskDeliveries(sourceTaskId: string): Delivery[] {
    return this.database
      .prepare(`
        SELECT * FROM downstream_deliveries
        WHERE source_task_id = ?
        ORDER BY created_at DESC, delivery_id DESC
      `)
      .all(sourceTaskId)
      .map(deliveryFromRow);
  }

  listPendingReadbacks(): Delivery[] {
    return this.database
      .prepare(`
        SELECT * FROM downstream_deliveries
        WHERE external_reference IS NOT NULL
          AND (
            status IN ('submitted', 'accepted')
            OR (status = 'completed' AND source_acknowledged_at IS NULL)
          )
        ORDER BY updated_at, delivery_id
      `)
      .all()
      .map(deliveryFromRow);
  }

  acknowledgeReadback(
    deliveryId: string,
    outcomeReference: string,
    actorId: string,
    occurredAt: string,
  ): Delivery {
    return this.transaction(() => {
      const current = this.requireDelivery(deliveryId);
      if (
        current.status !== "completed" ||
        current.outcomeReference !== outcomeReference
      ) {
        throw new DownstreamError(
          "READBACK_NOT_VERIFIABLE",
          "Only the exact completed provider outcome can be acknowledged",
          409,
        );
      }
      if (current.sourceAcknowledgedAt !== null) return current;

      this.database
        .prepare(`
          UPDATE downstream_deliveries
          SET source_acknowledged_at = ?, updated_at = ?
          WHERE delivery_id = ? AND source_acknowledged_at IS NULL
        `)
        .run(occurredAt, occurredAt, deliveryId);
      const updated = this.requireDelivery(deliveryId);
      this.appendEvent(
        updated,
        "delivery.source_acknowledged",
        actorId,
        { outcomeReference },
      );
      return updated;
    });
  }

  recordProviderState(
    deliveryId: string,
    readback: ProviderReadback | ProviderReceipt,
    actorId: string,
    observedAt: string,
  ): Delivery {
    return this.transaction(() => {
      const current = this.requireDelivery(deliveryId);
      const outcomeReference =
        "outcomeReference" in readback
          ? readback.outcomeReference
          : current.outcomeReference;
      const statusReason =
        "reason" in readback ? readback.reason : null;
      const changed =
        current.status !== readback.status ||
        current.externalReference !== readback.externalReference ||
        current.outcomeReference !== outcomeReference ||
        current.statusReason !== statusReason;
      if (!changed) return current;

      this.database
        .prepare(`
          UPDATE downstream_deliveries
          SET status = ?, external_reference = ?, outcome_reference = ?,
              status_reason = ?, updated_at = ?
          WHERE delivery_id = ?
        `)
        .run(
          readback.status,
          readback.externalReference,
          outcomeReference,
          statusReason,
          observedAt,
          deliveryId,
        );
      const updated = this.requireDelivery(deliveryId);
      this.appendEvent(updated, "delivery.provider_status_observed", actorId, {
        externalReference: readback.externalReference,
        providerUpdatedAt: readback.providerUpdatedAt,
      });
      return updated;
    });
  }

  recordSubmissionFailure(
    deliveryId: string,
    safeReason: string,
    occurredAt: string,
  ): Delivery {
    return this.transaction(() => {
      const current = this.requireDelivery(deliveryId);
      this.database
        .prepare(`
          UPDATE downstream_deliveries
          SET status = 'submission_failed', status_reason = ?, updated_at = ?
          WHERE delivery_id = ?
        `)
        .run(safeReason, occurredAt, deliveryId);
      const updated = this.requireDelivery(deliveryId);
      this.appendEvent(updated, "delivery.submission_failed", "system:gateway", {
        retryable: true,
      });
      return updated;
    });
  }

  listEvents(deliveryId: string): DeliveryEvent[] {
    this.requireDelivery(deliveryId);
    return this.database
      .prepare(`
        SELECT sequence, delivery_id, event_type, occurred_at, actor_id, status,
               details_json
        FROM downstream_delivery_events
        WHERE delivery_id = ?
        ORDER BY sequence
      `)
      .all(deliveryId)
      .map((row) => ({
        sequence: rowNumber(row, "sequence"),
        deliveryId: rowText(row, "delivery_id"),
        eventType: rowText(row, "event_type"),
        occurredAt: rowText(row, "occurred_at"),
        actorId: rowText(row, "actor_id"),
        status: rowText(row, "status") as Delivery["status"],
        details: parseJson(rowText(row, "details_json")) as Record<
          string,
          unknown
        >,
      }));
  }

  createProviderItem(
    deliveryId: string,
    targetSystem: string,
    externalReference: string,
    occurredAt: string,
  ): ProviderReceipt {
    return this.transaction(() => {
      const existing = this.database
        .prepare(`
          SELECT * FROM simulated_provider_items WHERE delivery_id = ?
        `)
        .get(deliveryId);
      if (existing) return providerReadbackFromRow(existing);

      this.database
        .prepare(`
          INSERT INTO simulated_provider_items
            (external_reference, delivery_id, target_system, status,
             outcome_reference, status_reason, created_at, updated_at)
          VALUES (?, ?, ?, 'submitted', NULL, NULL, ?, ?)
        `)
        .run(
          externalReference,
          deliveryId,
          targetSystem,
          occurredAt,
          occurredAt,
        );
      return {
        externalReference,
        status: "submitted",
        providerUpdatedAt: occurredAt,
      };
    });
  }

  readProviderItem(externalReference: string): ProviderReadback | null {
    const row = this.database
      .prepare(`
        SELECT * FROM simulated_provider_items WHERE external_reference = ?
      `)
      .get(externalReference);
    return row ? providerReadbackFromRow(row) : null;
  }

  transitionProviderItem(
    externalReference: string,
    idempotencyKey: string,
    requestHash: string,
    status: ProviderStatus,
    outcomeReference: string | null,
    reason: string | null,
    occurredAt: string,
  ): ProviderReadback {
    return this.transaction(() => {
      const replay = this.database
        .prepare(`
          SELECT request_hash, result_json
          FROM simulated_provider_commands
          WHERE external_reference = ? AND idempotency_key = ?
        `)
        .get(externalReference, idempotencyKey);
      if (replay) {
        if (rowText(replay, "request_hash") !== requestHash) {
          throw new DownstreamError(
            "IDEMPOTENCY_CONFLICT",
            "Idempotency key was already used for a different provider update",
            409,
          );
        }
        return parseJson(rowText(replay, "result_json")) as ProviderReadback;
      }

      const current = this.readProviderItem(externalReference);
      if (!current) {
        throw new DownstreamError(
          "PROVIDER_ITEM_NOT_FOUND",
          "Provider work item not found",
          404,
        );
      }
      assertProviderTransition(current.status, status);
      this.database
        .prepare(`
          UPDATE simulated_provider_items
          SET status = ?, outcome_reference = ?, status_reason = ?, updated_at = ?
          WHERE external_reference = ?
        `)
        .run(status, outcomeReference, reason, occurredAt, externalReference);
      const result = this.readProviderItem(externalReference);
      if (!result) throw new Error("Provider item disappeared after update");
      this.database
        .prepare(`
          INSERT INTO simulated_provider_commands
            (external_reference, idempotency_key, request_hash, result_json,
             created_at)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(
          externalReference,
          idempotencyKey,
          requestHash,
          JSON.stringify(result),
          occurredAt,
        );
      return result;
    });
  }

  private requireDelivery(deliveryId: string): Delivery {
    const delivery = this.getDelivery(deliveryId);
    if (!delivery) {
      throw new DownstreamError(
        "DELIVERY_NOT_FOUND",
        "Downstream delivery not found",
        404,
      );
    }
    return delivery;
  }

  private appendEvent(
    delivery: Delivery,
    eventType: string,
    actorId: string,
    details: Record<string, unknown>,
  ): void {
    this.database
      .prepare(`
        INSERT INTO downstream_delivery_events
          (delivery_id, event_type, occurred_at, actor_id, status, details_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        delivery.deliveryId,
        eventType,
        delivery.updatedAt,
        actorId,
        delivery.status,
        JSON.stringify(details),
      );
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function assertProviderTransition(
  current: ProviderStatus,
  next: ProviderStatus,
): void {
  const allowed: Record<ProviderStatus, ProviderStatus[]> = {
    submitted: ["accepted", "completed", "rejected"],
    accepted: ["completed", "rejected"],
    completed: [],
    rejected: [],
  };
  if (!allowed[current].includes(next)) {
    throw new DownstreamError(
      "INVALID_PROVIDER_TRANSITION",
      `Provider status cannot change from ${current} to ${next}`,
      409,
    );
  }
}

function deliveryFromRow(row: object): Delivery {
  return {
    schemaVersion: "1",
    deliveryId: rowText(row, "delivery_id"),
    sourceTaskId: rowText(row, "source_task_id"),
    patientId: rowText(row, "patient_id"),
    targetSystem: rowText(row, "target_system"),
    kind: rowText(row, "kind") as Delivery["kind"],
    summary: rowText(row, "summary"),
    instructions: rowNullableText(row, "instructions"),
    dueAt: rowText(row, "due_at"),
    referralSnapshotId: rowNullableText(row, "referral_snapshot_id"),
    status: rowText(row, "status") as Delivery["status"],
    externalReference: rowNullableText(row, "external_reference"),
    outcomeReference: rowNullableText(row, "outcome_reference"),
    sourceAcknowledgedAt: rowNullableText(row, "source_acknowledged_at"),
    statusReason: rowNullableText(row, "status_reason"),
    createdAt: rowText(row, "created_at"),
    updatedAt: rowText(row, "updated_at"),
    createdBy: rowText(row, "created_by"),
    correlationId: rowText(row, "correlation_id"),
  };
}

function providerReadbackFromRow(row: object): ProviderReadback {
  return {
    externalReference: rowText(row, "external_reference"),
    status: rowText(row, "status") as ProviderStatus,
    providerUpdatedAt: rowText(row, "updated_at"),
    outcomeReference: rowNullableText(row, "outcome_reference"),
    reason: rowNullableText(row, "status_reason"),
  };
}

function rowValue(row: object, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

function rowText(row: object, key: string): string {
  const value = rowValue(row, key);
  if (typeof value !== "string") throw new Error(`Expected text column: ${key}`);
  return value;
}

function rowNullableText(row: object, key: string): string | null {
  const value = rowValue(row, key);
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`Expected text column: ${key}`);
  return value;
}

function rowNumber(row: object, key: string): number {
  const value = rowValue(row, key);
  if (typeof value !== "number") throw new Error(`Expected number column: ${key}`);
  return value;
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}
