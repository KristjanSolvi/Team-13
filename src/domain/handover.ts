import { createHash } from "node:crypto";
import { z } from "zod";

import type { Task } from "./types.js";

export const handoverReasons = ["assignment", "on_demand"] as const;
export type HandoverReason = (typeof handoverReasons)[number];

export const groundedStatementSchema = z.object({
  statement: z.string().trim().min(1).max(1_000),
  sourceRefs: z.array(z.string().min(1).max(240)).min(1).max(20),
});

export const handoverTaskItemSchema = z.object({
  taskId: z.string().uuid(),
  threadId: z.string().uuid(),
  summary: z.string().min(1).max(240),
  state: z.enum([
    "draft",
    "offered_to_team",
    "assigned_to_member",
    "accepted",
    "completed",
    "escalated",
  ]),
  targetTeamId: z.string().min(1).max(160),
  assignedMemberId: z.string().min(1).max(160).nullable(),
  clinicalUrgency: z.enum(["high", "medium", "routine"]),
  acceptBy: z.string().datetime(),
  dueBy: z.string().datetime(),
  version: z.number().int().positive(),
  sourceRefs: z.array(z.string().min(1).max(240)).min(1).max(20),
});

export const handoverPacketSchema = z.object({
  situation: z.array(groundedStatementSchema).max(20),
  background: z.array(groundedStatementSchema).max(20),
  currentConcerns: z.array(groundedStatementSchema).max(20),
  outstandingTasks: z.array(handoverTaskItemSchema).max(50),
  awaitingVerification: z.array(handoverTaskItemSchema).max(50),
  escalations: z.array(handoverTaskItemSchema).max(50),
  unknowns: z.array(z.string().trim().min(1).max(500)).max(20),
});

export const renderedHandoverSchema = z.object({
  title: z.string().trim().min(1).max(160),
  sections: z
    .array(
      z.object({
        sectionId: z.string().trim().min(1).max(80),
        heading: z.string().trim().min(1).max(160),
        statements: z.array(groundedStatementSchema).max(50),
      }),
    )
    .max(10),
  creditsConsumed: z.number().nonnegative(),
});

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const snapshotReferenceSchema = z.string().min(1).max(240);
const snapshotVersionSchema = z.number().int().positive();

export const handoverSourceSnapshotSchema = z
  .object({
    recordItems: z.array(
      z.object({
        itemId: snapshotReferenceSchema,
        sourceRef: snapshotReferenceSchema,
        contentHash: sha256Schema,
      }),
    ),
    threads: z.array(
      z.object({
        threadId: snapshotReferenceSchema,
        version: snapshotVersionSchema,
      }),
    ),
    tasks: z.array(
      z.object({
        taskId: snapshotReferenceSchema,
        version: snapshotVersionSchema,
      }),
    ),
  })
  .superRefine((value, context) => {
    const duplicateRecordItem = findDuplicateIdentifier(
      value.recordItems,
      ({ itemId }) => itemId,
    );
    if (duplicateRecordItem) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate record item ID: ${duplicateRecordItem.id}`,
        path: ["recordItems", duplicateRecordItem.index, "itemId"],
      });
    }

    const duplicateThread = findDuplicateIdentifier(
      value.threads,
      ({ threadId }) => threadId,
    );
    if (duplicateThread) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate thread ID: ${duplicateThread.id}`,
        path: ["threads", duplicateThread.index, "threadId"],
      });
    }

    const duplicateTask = findDuplicateIdentifier(
      value.tasks,
      ({ taskId }) => taskId,
    );
    if (duplicateTask) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate task ID: ${duplicateTask.id}`,
        path: ["tasks", duplicateTask.index, "taskId"],
      });
    }
  });

export type GroundedStatement = z.infer<typeof groundedStatementSchema>;
export type HandoverTaskItem = z.infer<typeof handoverTaskItemSchema>;
export type HandoverPacket = z.infer<typeof handoverPacketSchema>;
export type RenderedHandover = z.infer<typeof renderedHandoverSchema>;
export type HandoverSourceSnapshot = z.infer<
  typeof handoverSourceSnapshotSchema
>;

export type HandoverStatus = "requested" | "draft" | "rendered" | "failed";

export interface HandoverRecord {
  handoverId: string;
  patientId: string;
  interactionId: string;
  contextId: string | null;
  requestedBy: string;
  reason: HandoverReason;
  focus: string | null;
  correlationId: string;
  idempotencyKey: string;
  requestHash: string;
  status: HandoverStatus;
  version: number;
  packet: HandoverPacket | null;
  rendered: RenderedHandover | null;
  sourceSnapshot: HandoverSourceSnapshot | null;
  sourceSnapshotHash: string | null;
  createdAt: string;
  updatedAt: string;
  generatedAt: string | null;
}

function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function requireUniqueIdentifiers<T>(
  values: readonly T[],
  identifier: (value: T) => string,
  label: string,
): void {
  const duplicate = findDuplicateIdentifier(values, identifier);
  if (duplicate) {
    throw new TypeError(`Duplicate ${label} ID: ${duplicate.id}`);
  }
}

function findDuplicateIdentifier<T>(
  values: readonly T[],
  identifier: (value: T) => string,
): { id: string; index: number } | null {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    const id = identifier(value);
    if (seen.has(id)) {
      return { id, index };
    }
    seen.add(id);
  }
  return null;
}

export function isHandoverTaskActive(value: Task): boolean {
  return value.state !== "verified" && value.state !== "dismissed";
}

export function buildHandoverSourceSnapshot(
  recordItems: Array<{ itemId: string; sourceRef: string; text: string }>,
  threads: Array<{ threadId: string; version: number }>,
  tasks: Task[],
): HandoverSourceSnapshot {
  requireUniqueIdentifiers(recordItems, ({ itemId }) => itemId, "record item");
  requireUniqueIdentifiers(threads, ({ threadId }) => threadId, "thread");
  requireUniqueIdentifiers(tasks, ({ taskId }) => taskId, "task");

  return {
    recordItems: recordItems
      .map(({ itemId, sourceRef, text }) => ({
        itemId,
        sourceRef,
        contentHash: sha256(text),
      }))
      .toSorted((left, right) => compareCodePoints(left.itemId, right.itemId)),
    threads: threads
      .map(({ threadId, version }) => ({ threadId, version }))
      .toSorted((left, right) =>
        compareCodePoints(left.threadId, right.threadId),
      ),
    tasks: tasks
      .filter(isHandoverTaskActive)
      .map(({ taskId, version }) => ({ taskId, version }))
      .toSorted((left, right) => compareCodePoints(left.taskId, right.taskId)),
  };
}

export function handoverSourceSnapshotHash(
  value: HandoverSourceSnapshot,
): string {
  return sha256(JSON.stringify(value));
}

export function handoverRequestHash(value: {
  patientId: string;
  requestedBy: string;
  reason: HandoverReason;
  focus: string | null;
}): string {
  return sha256(
    JSON.stringify({
      patientId: value.patientId,
      requestedBy: value.requestedBy,
      reason: value.reason,
      focus: value.focus,
    }),
  );
}
