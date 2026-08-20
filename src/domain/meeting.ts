import { z } from "zod";

const identifier = z.string().min(1).max(200);
const sha256 = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const taskReference = z.string().regex(/^task:[0-9a-f-]{36}@[1-9][0-9]*$/);

export const meetingStatuses = ["recording", "completed", "failed"] as const;
export const patientSegmentStatuses = [
  "recording",
  "closed",
  "reconciling",
  "reconciled",
  "failed",
] as const;
export const reconciliationStatuses = ["requested", "saved", "failed"] as const;
export const carryForwardReasons = [
  "unresolved",
  "not_discussed",
  "overdue",
] as const;

export const wardMeetingSchema = z
  .object({
    meetingId: z.string().uuid(),
    wardId: identifier,
    interactionId: identifier,
    status: z.enum(meetingStatuses),
    startedBy: identifier,
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    version: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "recording" && value.completedAt !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "A recording meeting cannot be completed",
      });
    }
    if (value.status === "completed" && value.completedAt === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "A completed meeting requires completedAt",
      });
    }
  });

export const patientMeetingSegmentSchema = z
  .object({
    segmentId: z.string().uuid(),
    meetingId: z.string().uuid(),
    patientId: identifier,
    status: z.enum(patientSegmentStatuses),
    openedBy: identifier,
    openedAt: z.string().datetime(),
    closedAt: z.string().datetime().nullable(),
    version: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "recording" && value.closedAt !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["closedAt"],
        message: "A recording segment cannot be closed",
      });
    }
    if (value.status !== "recording" && value.closedAt === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["closedAt"],
        message: "A non-recording segment requires closedAt",
      });
    }
  });

export const meetingTranscriptEvidenceSchema = z
  .object({
    evidenceId: z.string().uuid(),
    meetingId: z.string().uuid(),
    patientSegmentId: z.string().uuid().nullable(),
    interactionId: identifier,
    segmentKey: identifier,
    text: z.string().min(1).max(4_000),
    startSeconds: z.number().nonnegative(),
    endSeconds: z.number().nonnegative(),
    speakerId: z.number().int().optional(),
    isFinal: z.boolean(),
    audioQuality: z.enum(["clear", "uncertain"]),
    eligible: z.boolean(),
    sourceRef: z
      .string()
      .regex(/^encounter:[A-Za-z0-9._-]+$/)
      .nullable(),
    recordedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.endSeconds < value.startSeconds) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endSeconds"],
        message: "Transcript end cannot precede its start",
      });
    }
    const mayBeEligible =
      value.isFinal &&
      value.audioQuality === "clear" &&
      value.patientSegmentId !== null &&
      value.sourceRef !== null;
    if (value.eligible !== mayBeEligible) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["eligible"],
        message: "Only final clear patient-scoped transcript is eligible",
      });
    }
    if (!value.eligible && value.sourceRef !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceRef"],
        message:
          "Ineligible transcript cannot have a patient evidence reference",
      });
    }
  });

export const meetingReconciliationSchema = z
  .object({
    reconciliationId: z.string().uuid(),
    meetingId: z.string().uuid(),
    patientSegmentId: z.string().uuid(),
    patientId: identifier,
    interactionId: identifier,
    contextId: identifier.nullable(),
    idempotencyKey: z.string().min(8).max(200),
    sourceSnapshotHash: sha256,
    status: z.enum(reconciliationStatuses),
    newDraftTaskIds: z.array(z.string().uuid()).max(50),
    carryForwardTaskRefs: z.array(taskReference).max(50),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    version: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    const newTasks = new Set(value.newDraftTaskIds);
    for (const reference of value.carryForwardTaskRefs) {
      const taskId = reference.slice(
        "task:".length,
        reference.lastIndexOf("@"),
      );
      if (newTasks.has(taskId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["carryForwardTaskRefs"],
          message: "A task cannot be both new and carry-forward",
        });
      }
    }
  });

export const carryForwardWarningSchema = z
  .object({
    warningId: z.string().uuid(),
    reconciliationId: z.string().uuid(),
    patientId: identifier,
    taskRef: taskReference,
    reason: z.enum(carryForwardReasons),
    sourceRefs: z
      .array(z.string().min(1).max(240))
      .max(20)
      .refine((refs) => new Set(refs).size === refs.length),
    createdAt: z.string().datetime(),
  })
  .strict();

export type WardMeeting = z.infer<typeof wardMeetingSchema>;
export type PatientMeetingSegment = z.infer<typeof patientMeetingSegmentSchema>;
export type MeetingTranscriptEvidence = z.infer<
  typeof meetingTranscriptEvidenceSchema
>;
export type MeetingReconciliation = z.infer<typeof meetingReconciliationSchema>;
export type CarryForwardWarning = z.infer<typeof carryForwardWarningSchema>;
