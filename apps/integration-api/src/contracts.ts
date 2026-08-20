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
