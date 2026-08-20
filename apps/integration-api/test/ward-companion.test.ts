import { describe, expect, it } from "vitest";

import { projectWardCompanionOverview } from "../src/ward-companion.js";

const patientId = "synthetic-karen";
const thread = {
  threadId: "thread-karen-bp",
  patientId,
  interactionId: "interaction-karen-1",
  contextId: "ctx-karen",
  summary: "Dizziness following a medication change",
  evidenceRefs: ["encounter:candidate-karen.1"],
  state: "awaiting_review",
  version: 1,
  createdAt: "2026-08-20T10:00:00.000Z",
  updatedAt: "2026-08-20T10:00:00.000Z",
};
const task = {
  taskId: "task-karen-bp",
  threadId: thread.threadId,
  patientId,
  summary: "Check blood pressure within 48 hours",
  targetTeamId: "district-nursing",
  dueBy: "2026-08-22T10:00:00.000Z",
  state: "draft",
  assignedMemberId: null,
  version: 1,
  createdAt: "2026-08-20T10:00:00.000Z",
  updatedAt: "2026-08-20T10:00:00.000Z",
};

describe("Ward Companion projection", () => {
  it("maps authoritative Agentic records into the existing UI thread shape", () => {
    const result = projectWardCompanionOverview({
      patientId,
      threads: [thread],
      tasks: [task],
      observedAt: "2026-08-20T12:00:00.000Z",
    });

    expect(result).toEqual({
      schemaVersion: "1",
      patientId,
      observedAt: "2026-08-20T12:00:00.000Z",
      changeImpacts: [],
      threads: [
        {
          id: "task-karen-bp",
          patientId,
          title: "Check blood pressure within 48 hours",
          status: "pending",
          heard: "Dizziness following a medication change",
          matters:
            "Retained from the clinical interaction with linked evidence.",
          suggestion: "Review and approve this suggested action.",
          assignee: null,
          candidates: [],
          due: "2026-08-22T10:00:00.000Z",
          activity: [
            {
              id: "thread-karen-bp:captured",
              at: "2026-08-20T10:00:00.000Z",
              actor: "Follow-through agent",
              text: "Captured from the clinical interaction.",
              kind: "system",
            },
            {
              id: "task-karen-bp:state:1",
              at: "2026-08-20T10:00:00.000Z",
              actor: "Follow-through service",
              text: "Suggested action is awaiting clinical review.",
              kind: "system",
            },
          ],
          backend: {
            threadId: "thread-karen-bp",
            taskId: "task-karen-bp",
            threadVersion: 1,
            taskVersion: 1,
            threadState: "awaiting_review",
            taskState: "draft",
            targetTeamId: "district-nursing",
            evidenceRefs: ["encounter:candidate-karen.1"],
            availableCommands: ["approve", "correct", "dismiss"],
          },
        },
      ],
    });
  });

  it("maps the lifecycle without claiming completed work is verified", () => {
    const states = [
      ["offered_to_team", "tracking", ["accept"]],
      ["assigned_to_member", "tracking", ["accept", "decline"]],
      ["accepted", "tracking", ["complete"]],
      ["completed", "tracking", ["verify"]],
      ["verified", "verified", []],
      ["escalated", "escalated", ["reopen"]],
    ] as const;

    for (const [state, status, availableCommands] of states) {
      const result = projectWardCompanionOverview({
        patientId,
        threads: [
          {
            ...thread,
            state:
              state === "verified"
                ? "verified"
                : state === "escalated"
                  ? "escalated"
                  : "tracking",
          },
        ],
        tasks: [{ ...task, state }],
        observedAt: "2026-08-20T12:00:00.000Z",
      });

      expect(result.threads[0]?.status).toBe(status);
      expect(result.threads[0]?.backend.availableCommands).toEqual(
        availableCommands,
      );
    }
  });

  it("keeps a retained thread visible before an Agentic task exists", () => {
    const result = projectWardCompanionOverview({
      patientId,
      threads: [thread],
      tasks: [],
      observedAt: "2026-08-20T12:00:00.000Z",
    });

    expect(result.threads).toHaveLength(1);
    expect(result.threads[0]).toMatchObject({
      id: thread.threadId,
      title: thread.summary,
      status: "pending",
      due: "Awaiting clinical review",
      backend: {
        taskId: null,
        taskVersion: null,
        taskState: null,
        targetTeamId: null,
        availableCommands: [],
      },
    });
  });

  it("projects the auditable source-to-task impact without changing task state", () => {
    const impact = {
      impactId: "11111111-1111-4111-8111-111111111111",
      revisionId: "22222222-2222-4222-8222-222222222222",
      dependencyId: "33333333-3333-4333-8333-333333333333",
      patientId,
      sourceItemId: "karen-dizziness-signal",
      sourceRef: "encounter:sentence-42",
      artifactKind: "task",
      artifactId: task.taskId,
      artifactVersion: 1,
      status: "review_required",
      summary:
        "Linked evidence changed after this task was created. Review the task against the latest source; tracked work is unchanged.",
      detectedAt: "2026-08-20T12:01:00.000Z",
      changedAt: "2026-08-20T12:01:00.000Z",
      changedBy: "clinician-1",
      reason: "clinical_note_revision",
    } as const;
    const result = projectWardCompanionOverview({
      patientId,
      threads: [thread],
      tasks: [task],
      changeImpacts: [impact],
      observedAt: "2026-08-20T12:02:00.000Z",
    });

    expect(result.changeImpacts).toEqual([impact]);
    expect(result.threads[0]?.backend.taskState).toBe("draft");
    expect(result.threads[0]?.status).toBe("pending");
  });

  it("does not expose dismissed records as verified work", () => {
    const dismissedThread = { ...thread, state: "dismissed" };
    const result = projectWardCompanionOverview({
      patientId,
      threads: [dismissedThread],
      tasks: [{ ...task, state: "dismissed" }],
      observedAt: "2026-08-20T12:00:00.000Z",
    });

    expect(result.threads).toEqual([]);
  });

  it("rejects cross-patient and orphaned upstream records", () => {
    expect(() =>
      projectWardCompanionOverview({
        patientId,
        threads: [{ ...thread, patientId: "another-patient" }],
        tasks: [],
        observedAt: "2026-08-20T12:00:00.000Z",
      }),
    ).toThrow(/invalid response/i);

    expect(() =>
      projectWardCompanionOverview({
        patientId,
        threads: [thread],
        tasks: [{ ...task, threadId: "missing-thread" }],
        observedAt: "2026-08-20T12:00:00.000Z",
      }),
    ).toThrow(/invalid response/i);
  });
});
