import { z } from "zod";

export const ehrIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9:._-]+$/);

const documentChangesSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    content: z.string().trim().min(1).max(40_000).optional(),
  })
  .strict()
  .refine((changes) => Object.keys(changes).length > 0, {
    message: "At least one document field must change",
  });

export const createDocumentSchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(200),
    category: z.enum(["medical", "discharge"]),
    title: z.string().trim().min(1).max(240),
    content: z.string().trim().min(1).max(40_000),
    source: z.enum(["clinician", "agent", "scribe"]),
  })
  .strict();

export const reviseDocumentSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(8).max(200),
    reason: z.string().trim().min(3).max(500),
    changes: documentChangesSchema,
  })
  .strict();

export const fileDocumentSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(8).max(200),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type ReviseDocumentInput = z.infer<typeof reviseDocumentSchema>;
export type FileDocumentInput = z.infer<typeof fileDocumentSchema>;

export interface ClinicalDocument {
  schemaVersion: "1";
  documentId: string;
  patientId: string;
  category: "medical" | "discharge";
  title: string;
  content: string;
  source: "clinician" | "agent" | "scribe";
  status: "draft" | "filed";
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  filedAt: string | null;
  filedBy: string | null;
  correlationId: string;
}

export interface ClinicalDocumentVersion extends ClinicalDocument {
  changeReason: string;
}
