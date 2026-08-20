import { z } from "zod";

const identifier = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9:._-]+$/);
const nullableText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).nullable();

export const deliveryIdSchema = identifier;
export const targetSystemSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z][a-z0-9-]+$/);
export const deliveryKindSchema = z.enum(["team-task", "referral", "callback"]);
export const providerStatusSchema = z.enum([
  "submitted",
  "accepted",
  "completed",
  "rejected",
]);
export const deliveryStatusSchema = z.enum([
  "pending_submission",
  "submission_failed",
  ...providerStatusSchema.options,
]);

export const createDeliverySchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(200),
    sourceTaskId: identifier,
    patientId: identifier,
    targetSystem: targetSystemSchema,
    kind: deliveryKindSchema,
    summary: z.string().trim().min(5).max(1_000),
    instructions: nullableText(4_000),
    dueAt: z.iso.datetime({ offset: true }),
    referralSnapshotId: identifier.nullable(),
  })
  .strict();

export const simulateProviderStatusSchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(200),
    status: z.enum(["accepted", "completed", "rejected"]),
    outcomeReference: nullableText(240),
    reason: nullableText(500),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "completed" && value.outcomeReference === null) {
      context.addIssue({
        code: "custom",
        path: ["outcomeReference"],
        message: "Completed provider work requires an outcome reference",
      });
    }
    if (value.status === "rejected" && value.reason === null) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Rejected provider work requires a reason",
      });
    }
  });

export type DeliveryKind = z.infer<typeof deliveryKindSchema>;
export type ProviderStatus = z.infer<typeof providerStatusSchema>;
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;
export type CreateDeliveryInput = z.infer<typeof createDeliverySchema>;
export type SimulateProviderStatusInput = z.infer<
  typeof simulateProviderStatusSchema
>;

export interface Delivery {
  schemaVersion: "1";
  deliveryId: string;
  sourceTaskId: string;
  patientId: string;
  targetSystem: string;
  kind: DeliveryKind;
  summary: string;
  instructions: string | null;
  dueAt: string;
  referralSnapshotId: string | null;
  status: DeliveryStatus;
  externalReference: string | null;
  outcomeReference: string | null;
  statusReason: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  correlationId: string;
}

export interface DeliveryEvent {
  sequence: number;
  deliveryId: string;
  eventType: string;
  occurredAt: string;
  actorId: string;
  status: DeliveryStatus;
  details: Record<string, unknown>;
}

export interface ProviderSubmission {
  deliveryId: string;
  idempotencyKey: string;
  targetSystem: string;
  kind: DeliveryKind;
  summary: string;
  instructions: string | null;
  dueAt: string;
}

export interface ProviderReceipt {
  externalReference: string;
  status: ProviderStatus;
  providerUpdatedAt: string;
}

export interface ProviderReadback extends ProviderReceipt {
  outcomeReference: string | null;
  reason: string | null;
}

export interface IndependentReadback extends ProviderReadback {
  schemaVersion: "1";
  deliveryId: string;
  sourceTaskId: string;
  observedAt: string;
  verifierActorId: string;
  independentlyVerifiable: boolean;
}
