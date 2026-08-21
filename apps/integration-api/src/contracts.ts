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

export const syntheticSourceRevisionSchema = z
  .object({ idempotencyKey: z.string().min(8).max(200) })
  .strict();

export const pipelineProxyPaths = [
  "/api/corti/ambient/session",
  "/api/corti/ambient/token",
  "/api/corti/dictation/token",
  "/api/corti/transcripts/review",
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

const meetingCommandKey = z.string().min(8).max(200);
const positiveVersion = z.number().int().positive();

export const wardMeetingStartSchema = z
  .object({
    wardId: z.string().min(1).max(200),
    encounterIdentifier: z.string().min(1).max(120).optional(),
    idempotencyKey: meetingCommandKey,
  })
  .strict();

export const meetingSegmentOpenSchema = z
  .object({
    patientId: z.string().min(1).max(160),
    expectedMeetingVersion: positiveVersion,
    idempotencyKey: meetingCommandKey,
  })
  .strict();

export const meetingTranscriptAppendSchema = z
  .object({
    patientSegmentId: z.string().uuid().nullable(),
    segments: z
      .array(
        z
          .object({
            segmentKey: z.string().min(1).max(200),
            text: z.string().min(1).max(4_000),
            startSeconds: z.number().nonnegative(),
            endSeconds: z.number().nonnegative(),
            speakerId: z.number().int().optional(),
            isFinal: z.boolean(),
            audioQuality: z.enum(["clear", "uncertain"]),
          })
          .strict()
          .refine((segment) => segment.endSeconds >= segment.startSeconds, {
            path: ["endSeconds"],
            message: "Transcript end cannot precede its start",
          }),
      )
      .min(1)
      .max(500),
    idempotencyKey: meetingCommandKey,
  })
  .strict();

export const meetingSegmentCloseSchema = z
  .object({
    expectedMeetingVersion: positiveVersion,
    expectedSegmentVersion: positiveVersion,
    idempotencyKey: meetingCommandKey,
  })
  .strict();

export const wardMeetingCompleteSchema = z
  .object({
    expectedMeetingVersion: positiveVersion,
    idempotencyKey: meetingCommandKey,
  })
  .strict();

export type WardMeetingStart = z.infer<typeof wardMeetingStartSchema>;
export type MeetingSegmentOpen = z.infer<typeof meetingSegmentOpenSchema>;
export type MeetingTranscriptAppend = z.infer<
  typeof meetingTranscriptAppendSchema
>;
export type MeetingSegmentClose = z.infer<typeof meetingSegmentCloseSchema>;
export type WardMeetingComplete = z.infer<typeof wardMeetingCompleteSchema>;

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
    referralSnapshotId: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[A-Za-z0-9:._-]+$/)
      .nullable()
      .default(null),
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

export const demoRouteNowSchema = z
  .object({ idempotencyKey: z.string().min(8).max(200) })
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

const ehrCodingReviewSchema = z
  .object({
    outcome: z.enum(["accepted", "rejected", "no-suggestions", "unavailable"]),
    approvalId: z.string().trim().min(1).max(200),
    system: z.enum([
      "icd10int-outpatient",
      "icd10int-inpatient",
      "icd10cm-outpatient",
      "icd10cm-inpatient",
    ]),
    selectedCode: z
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
      .strict()
      .nullable(),
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

export const ehrCreateDocumentSchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(200),
    category: z.enum(["medical", "discharge"]),
    title: z.string().trim().min(1).max(240),
    content: z.string().trim().min(1).max(40_000),
    source: z.enum(["clinician", "agent", "scribe"]),
    codingReview: ehrCodingReviewSchema.nullable().default(null),
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
        codingReview: ehrCodingReviewSchema.nullable().optional(),
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

export const ehrCreateReferralSnapshotSchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(200),
    referralType: z.string().trim().min(2).max(160),
    destination: z.string().trim().min(2).max(240),
    clinicalReason: z.string().trim().min(5).max(4_000),
    additionalInstructions: z
      .string()
      .trim()
      .min(1)
      .max(2_000)
      .nullable(),
  })
  .strict();

export const downstreamSimulationSchema = z
  .object({
    idempotencyKey: z.string().trim().min(8).max(200),
    status: z.enum(["accepted", "completed", "rejected"]),
    outcomeReference: z.string().trim().min(1).max(240).nullable(),
    reason: z.string().trim().min(1).max(500).nullable(),
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
