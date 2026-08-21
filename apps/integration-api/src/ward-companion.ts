import { z } from "zod";

import { IntegrationError } from "./errors.js";

const threadStateSchema = z.enum([
  "awaiting_review",
  "tracking",
  "verified",
  "escalated",
  "dismissed",
]);

const taskStateSchema = z.enum([
  "draft",
  "offered_to_team",
  "assigned_to_member",
  "accepted",
  "completed",
  "verified",
  "escalated",
  "dismissed",
]);

const agenticThreadSchema = z.object({
  threadId: z.string().min(1),
  patientId: z.string().min(1),
  interactionId: z.string().min(1),
  summary: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)),
  state: threadStateSchema,
  version: z.number().int().positive(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const agenticTaskSchema = z.object({
  taskId: z.string().min(1),
  threadId: z.string().min(1),
  patientId: z.string().min(1),
  summary: z.string().min(1),
  targetTeamId: z.string().min(1),
  dueBy: z.string().min(1),
  state: taskStateSchema,
  assignedMemberId: z.string().min(1).nullable(),
  version: z.number().int().positive(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const changeImpactSchema = z.object({
  impactId: z.string().uuid(),
  revisionId: z.string().uuid(),
  dependencyId: z.string().uuid(),
  patientId: z.string().min(1),
  sourceItemId: z.string().min(1),
  sourceRef: z.string().min(1),
  artifactKind: z.enum(["task", "handover"]),
  artifactId: z.string().min(1),
  artifactVersion: z.number().int().positive(),
  status: z.literal("review_required"),
  summary: z.string().min(1),
  detectedAt: z.string().min(1),
  changedAt: z.string().min(1),
  changedBy: z.string().min(1),
  reason: z.enum([
    "new_result",
    "medication_update",
    "clinical_note_revision",
    "other",
  ]),
});

type AgenticThread = z.infer<typeof agenticThreadSchema>;
type AgenticTask = z.infer<typeof agenticTaskSchema>;
export type ChangeImpact = z.infer<typeof changeImpactSchema>;
type ThreadState = z.infer<typeof threadStateSchema>;
type TaskState = z.infer<typeof taskStateSchema>;

export type WardCompanionStatus =
  | "pending"
  | "tracking"
  | "verified"
  | "escalated";

export type WardCompanionCommand =
  | "approve"
  | "correct"
  | "dismiss"
  | "reopen"
  | "accept"
  | "decline"
  | "complete"
  | "verify";

export interface WardCompanionThread {
  id: string;
  patientId: string;
  title: string;
  status: WardCompanionStatus;
  heard: string;
  matters: string;
  suggestion: string;
  assignee: string | null;
  candidates: Array<{ name: string; role: string; free: boolean }>;
  due: string;
  activity: Array<{
    id: string;
    at: string;
    actor: string;
    text: string;
    kind: "note" | "system" | "action";
  }>;
  backend: {
    threadId: string;
    taskId: string | null;
    threadVersion: number;
    taskVersion: number | null;
    threadState: ThreadState;
    taskState: TaskState | null;
    targetTeamId: string | null;
    evidenceRefs: string[];
    availableCommands: WardCompanionCommand[];
  };
}

export interface WardCompanionOverview {
  schemaVersion: "1";
  patientId: string;
  observedAt: string;
  threads: WardCompanionThread[];
  changeImpacts: ChangeImpact[];
}

interface ProjectionInput {
  patientId: string;
  threads: unknown[];
  tasks: unknown[];
  changeImpacts?: unknown[];
  observedAt: string;
}

export function projectWardCompanionOverview(
  input: ProjectionInput,
): WardCompanionOverview {
  const threads = parseRecords(agenticThreadSchema, input.threads);
  const tasks = parseRecords(agenticTaskSchema, input.tasks);
  const changeImpacts = parseRecords(
    changeImpactSchema,
    input.changeImpacts ?? [],
  );
  const threadById = new Map<string, AgenticThread>();
  const tasksByThread = new Map<string, AgenticTask[]>();
  const taskIds = new Set<string>();
  const impactIds = new Set<string>();

  for (const thread of threads) {
    if (
      thread.patientId !== input.patientId ||
      threadById.has(thread.threadId)
    ) {
      throw invalidUpstreamResponse();
    }
    threadById.set(thread.threadId, thread);
  }

  for (const task of tasks) {
    if (
      task.patientId !== input.patientId ||
      !threadById.has(task.threadId) ||
      taskIds.has(task.taskId)
    ) {
      throw invalidUpstreamResponse();
    }
    taskIds.add(task.taskId);
    const related = tasksByThread.get(task.threadId) ?? [];
    related.push(task);
    tasksByThread.set(task.threadId, related);
  }

  for (const impact of changeImpacts) {
    if (
      impact.patientId !== input.patientId ||
      impactIds.has(impact.impactId) ||
      (impact.artifactKind === "task" && !taskIds.has(impact.artifactId))
    ) {
      throw invalidUpstreamResponse();
    }
    impactIds.add(impact.impactId);
  }

  const projected: WardCompanionThread[] = [];
  for (const thread of threads) {
    if (thread.state === "dismissed") continue;

    const relatedTasks = tasksByThread.get(thread.threadId) ?? [];
    const visibleTasks = relatedTasks.filter(
      (task) => task.state !== "dismissed",
    );
    if (visibleTasks.length === 0 && relatedTasks.length > 0) continue;

    if (visibleTasks.length === 0) {
      projected.push(projectThread(thread, null));
      continue;
    }
    for (const task of visibleTasks) {
      projected.push(projectThread(thread, task));
    }
  }

  return {
    schemaVersion: "1",
    patientId: input.patientId,
    observedAt: input.observedAt,
    threads: projected,
    changeImpacts,
  };
}

function parseRecords<T>(schema: z.ZodType<T>, records: unknown[]): T[] {
  const parsed = z.array(schema).safeParse(records);
  if (!parsed.success) throw invalidUpstreamResponse();
  return parsed.data;
}

function projectThread(
  thread: AgenticThread,
  task: AgenticTask | null,
): WardCompanionThread {
  const activity: WardCompanionThread["activity"] = [
    {
      id: `${thread.threadId}:captured`,
      at: thread.createdAt,
      actor: "Fluence agent",
      text: "Captured from the clinical interaction.",
      kind: "system",
    },
  ];
  if (task !== null) {
    activity.push({
      id: `${task.taskId}:state:${task.version}`,
      at: task.updatedAt,
      actor: "Fluence service",
      text: stateActivity(task.state),
      kind: stateActivityKind(task.state),
    });
  }

  return {
    id: task?.taskId ?? thread.threadId,
    patientId: thread.patientId,
    title: task?.summary ?? thread.summary,
    status: companionStatus(thread.state, task?.state ?? null),
    heard: thread.summary,
    matters: "Retained from the clinical interaction with linked evidence.",
    suggestion:
      task === null
        ? "Review the captured follow-through item."
        : stateSuggestion(task),
    assignee: task?.assignedMemberId ?? null,
    candidates: [],
    due: task?.dueBy ?? "Awaiting clinical review",
    activity,
    backend: {
      threadId: thread.threadId,
      taskId: task?.taskId ?? null,
      threadVersion: thread.version,
      taskVersion: task?.version ?? null,
      threadState: thread.state,
      taskState: task?.state ?? null,
      targetTeamId: task?.targetTeamId ?? null,
      evidenceRefs: [...thread.evidenceRefs],
      availableCommands:
        task === null ? [] : availableCommands(task.state),
    },
  };
}

function companionStatus(
  threadState: ThreadState,
  taskState: TaskState | null,
): WardCompanionStatus {
  if (threadState === "escalated" || taskState === "escalated") {
    return "escalated";
  }
  if (threadState === "verified" || taskState === "verified") {
    return "verified";
  }
  if (threadState === "awaiting_review" || taskState === "draft") {
    return "pending";
  }
  return "tracking";
}

function availableCommands(state: TaskState): WardCompanionCommand[] {
  switch (state) {
    case "draft":
      return ["approve", "correct", "dismiss"];
    case "offered_to_team":
      return ["accept"];
    case "assigned_to_member":
      return ["accept", "decline"];
    case "accepted":
      return ["complete"];
    case "completed":
      return ["verify"];
    case "escalated":
      return ["reopen"];
    case "verified":
    case "dismissed":
      return [];
  }
}

function stateActivity(state: TaskState): string {
  switch (state) {
    case "draft":
      return "Suggested action is awaiting clinical review.";
    case "offered_to_team":
      return "Approved action was offered to the target team.";
    case "assigned_to_member":
      return "Action was assigned to a team member.";
    case "accepted":
      return "Assigned team member accepted the action.";
    case "completed":
      return "Completion was reported and is awaiting verification.";
    case "verified":
      return "Completion was independently verified.";
    case "escalated":
      return "Deadline passed while the action remained unresolved.";
    case "dismissed":
      return "Suggested action was dismissed.";
  }
}

function stateActivityKind(
  state: TaskState,
): WardCompanionThread["activity"][number]["kind"] {
  if (state === "accepted" || state === "completed" || state === "verified") {
    return "action";
  }
  return "system";
}

function stateSuggestion(task: AgenticTask): string {
  switch (task.state) {
    case "draft":
      return "Review and approve this suggested action.";
    case "offered_to_team":
      return `Awaiting acceptance from ${task.targetTeamId}.`;
    case "assigned_to_member":
      return task.assignedMemberId === null
        ? "Awaiting acceptance from the assigned team member."
        : `Awaiting acceptance from ${task.assignedMemberId}.`;
    case "accepted":
      return task.assignedMemberId === null
        ? "Work is accepted and in progress."
        : `In progress with ${task.assignedMemberId}.`;
    case "completed":
      return "Review the recorded outcome and verify completion.";
    case "verified":
      return "Nothing outstanding — completion is verified.";
    case "escalated":
      return "Reopen this action to the target team with a new deadline.";
    case "dismissed":
      return "No action is required.";
  }
}

function invalidUpstreamResponse(): IntegrationError {
  return new IntegrationError(
    "UPSTREAM_INVALID_RESPONSE",
    "An upstream service returned an invalid response",
    502,
    true,
  );
}
