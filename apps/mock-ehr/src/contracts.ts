import { z } from "zod";

export const ehrIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9:._-]+$/);

const codingSystemSchema = z.enum([
  "icd10int-outpatient",
  "icd10int-inpatient",
  "icd10cm-outpatient",
  "icd10cm-inpatient",
]);

const codingSuggestionSnapshotSchema = z
  .object({
    suggestionKind: z.enum(["supported", "candidate"]),
    code: z.string().trim().min(1).max(80),
    display: z.string().trim().min(1).max(500),
    evidenceStatus: z.enum(["validated", "unavailable"]),
    evidences: z
      .array(
        z
          .object({
            text: z.string().max(4_000),
            start: z.number().int().nonnegative(),
            end: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

export const codingReviewInputSchema = z
  .object({
    outcome: z.enum(["accepted", "rejected", "no-suggestions", "unavailable"]),
    approvalId: z.string().trim().min(1).max(200),
    system: codingSystemSchema,
    selectedCode: codingSuggestionSnapshotSchema.nullable(),
  })
  .strict()
  .superRefine((review, context) => {
    if (review.outcome === "accepted" && review.selectedCode === null) {
      context.addIssue({
        code: "custom",
        path: ["selectedCode"],
        message: "An accepted coding review requires a selected code",
      });
    }
    if (review.outcome !== "accepted" && review.selectedCode !== null) {
      context.addIssue({
        code: "custom",
        path: ["selectedCode"],
        message: "Only an accepted coding review may include a selected code",
      });
    }
  });

const documentChangesSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    content: z.string().trim().min(1).max(40_000).optional(),
    codingReview: codingReviewInputSchema.nullable().optional(),
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
    codingReview: codingReviewInputSchema.nullable().default(null),
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

export type CreateDocumentInput = z.input<typeof createDocumentSchema>;
export type ReviseDocumentInput = z.infer<typeof reviseDocumentSchema>;
export type FileDocumentInput = z.infer<typeof fileDocumentSchema>;
export type CodingReviewInput = z.infer<typeof codingReviewInputSchema>;

export interface ClinicalCodingReview extends CodingReviewInput {
  reviewedAt: string;
  reviewedBy: string;
}

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
  codingReview: ClinicalCodingReview | null;
}

export interface ClinicalDocumentVersion extends ClinicalDocument {
  changeReason: string;
}
