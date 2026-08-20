import { z } from "zod";

const evidenceSchema = z.object({
  interactionId: z.string().min(1).max(160),
  sourceQuote: z.string().min(1).max(4_000),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
  speakerId: z.number().int().optional(),
}).refine((value) => value.endSeconds >= value.startSeconds, {
  message: "Evidence endSeconds must not precede startSeconds",
});

export const candidateSchema = z.object({
  candidateId: z.string().min(1).max(160),
  interactionId: z.string().min(1).max(160),
  patientId: z.string().min(1).max(160),
  category: z.enum([
    "symptom",
    "medication-concern",
    "investigation",
    "referral",
    "follow-up",
    "social-barrier",
  ]),
  summary: z.string().min(5).max(1_000),
  evidence: z.array(evidenceSchema).min(1).max(20),
  status: z.literal("candidate"),
});

export type FollowThroughCandidate = z.infer<typeof candidateSchema>;

export const pipelineProxyPaths = [
  "/api/corti/ambient/session",
  "/api/corti/ambient/token",
  "/api/corti/dictation/token",
  "/api/corti/candidates/generate",
  "/api/corti/dictation/revision-preview",
  "/api/corti/documents/generate",
  "/api/corti/coding/predict",
] as const;

export type PipelineProxyPath = (typeof pipelineProxyPaths)[number];

export const handoverRequestSchema = z
  .object({
    idempotencyKey: z.string().min(8).max(200),
    reason: z.enum(["assignment", "on_demand"]),
    focus: z.string().trim().min(1).max(500).nullable().default(null),
  })
  .strict();

export type HandoverRequest = z.infer<typeof handoverRequestSchema>;

const commandBase = {
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(200),
};

export const taskCommandSchemas = {
  approve: z.object({
    ...commandBase,
    approvalChannel: z
      .enum(["app_one_tap", "dictation_confirmation"])
      .default("app_one_tap"),
  }),
  correct: z
    .object({
      ...commandBase,
      summary: z.string().min(5).max(240).optional(),
      targetTeamId: z.string().min(1).max(160).optional(),
      requiredCapabilities: z.array(z.string().min(1)).min(1).optional(),
      clinicalUrgency: z.enum(["high", "medium", "routine"]).optional(),
      dueInMs: z.number().int().positive().optional(),
    })
    .refine(
      (value) =>
        value.summary !== undefined ||
        value.targetTeamId !== undefined ||
        value.requiredCapabilities !== undefined ||
        value.clinicalUrgency !== undefined ||
        value.dueInMs !== undefined,
      "At least one corrected field is required",
    ),
  dismiss: z.object({
    ...commandBase,
    reason: z.string().min(3).max(500),
  }),
  reopen: z.object({
    ...commandBase,
    dueInMs: z.number().int().positive(),
  }),
  accept: z.object(commandBase),
  decline: z.object(commandBase),
  complete: z.object({
    ...commandBase,
    outcomeRef: z.string().min(1).max(240),
  }),
  verify: z.object({
    ...commandBase,
    outcomeRef: z.string().min(1).max(240),
  }),
} as const;

export type TaskCommand = keyof typeof taskCommandSchemas;

export function isTaskCommand(value: string): value is TaskCommand {
  return Object.hasOwn(taskCommandSchemas, value);
}

export const demoSessionCreateSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    scenario: z.enum([
      "meeting",
      "discharge_coordination",
      "ward_consultation",
    ]),
    groupSize: z.union([z.literal(1), z.literal(2)]),
    targetTeamId: z.string().min(1).max(160),
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict();

export const demoJoinSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    joinKey: z.string().min(8).max(200),
  })
  .strict();

export const demoAssignmentSchema = z
  .object({
    groupId: z.string().regex(/^group-[1-9]\d*$/),
    taskId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().min(8).max(200),
  })
  .strict();

const nullableText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).nullable();

const profileChangesSchema = z
  .object({
    displayName: z.string().trim().min(1).max(160).optional(),
    identifiers: z
      .object({
        medicalRecordNumber: nullableText(120).optional(),
        nationalHealthId: nullableText(120).optional(),
      })
      .strict()
      .optional(),
    demographics: z
      .object({
        dateOfBirth: z.iso.date().nullable().optional(),
        pronouns: nullableText(80).optional(),
      })
      .strict()
      .optional(),
    location: z
      .object({
        bed: nullableText(40).optional(),
        bay: nullableText(120).optional(),
      })
      .strict()
      .optional(),
    flow: z
      .object({
        todaySchedule: nullableText(500).optional(),
        waitingFor: nullableText(500).optional(),
        homeTomorrow: z.boolean().optional(),
      })
      .strict()
      .optional(),
    contact: z
      .object({
        phone: nullableText(80).optional(),
        email: z.email().max(320).nullable().optional(),
        address: nullableText(1_000).optional(),
      })
      .strict()
      .optional(),
    referralDetails: z
      .object({
        preferredLanguage: nullableText(120).optional(),
        interpreterRequired: z.boolean().optional(),
        mobilityNeeds: nullableText(1_000).optional(),
        transportNeeds: nullableText(1_000).optional(),
        homeSupport: nullableText(1_000).optional(),
        additionalDetails: nullableText(4_000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((changes) => Object.keys(changes).length > 0, {
    message: "At least one profile field must change",
  });

export const ehrProfileUpdateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(8).max(200),
    reason: z.string().trim().min(3).max(500),
    changes: profileChangesSchema,
  })
  .strict();

export const ehrCreateDocumentSchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(200),
    category: z.enum(["medical", "discharge"]),
    title: z.string().trim().min(1).max(240),
    content: z.string().trim().min(1).max(40_000),
    source: z.enum(["clinician", "agent", "scribe"]),
  })
  .strict();

export const ehrReviseDocumentSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(8).max(200),
    reason: z.string().trim().min(3).max(500),
    changes: z
      .object({
        title: z.string().trim().min(1).max(240).optional(),
        content: z.string().trim().min(1).max(40_000).optional(),
      })
      .strict()
      .refine((changes) => Object.keys(changes).length > 0, {
        message: "At least one document field must change",
      }),
  })
  .strict();

export const ehrFileDocumentSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(8).max(200),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
