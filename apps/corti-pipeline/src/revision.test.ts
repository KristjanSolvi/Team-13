import { describe, expect, it } from "vitest";

import { parseDictatedRevision } from "./revision.js";

const directory = {
  recipientTeams: [
    {
      id: "district-nursing",
      label: "District Nursing Team",
      aliases: ["district nursing"],
    },
  ],
};

describe("parseDictatedRevision", () => {
  it("creates a preview from allow-listed terms without committing anything", () => {
    const preview = parseDictatedRevision({
      taskId: "task-karen-bp",
      expectedVersion: 1,
      idempotencyKey: "correct-karen-001",
      transcript:
        "Route to district nursing within 48 hours and mark medium.",
      ...directory,
    });

    expect(preview).toEqual({
      draft: {
        taskId: "task-karen-bp",
        expectedVersion: 1,
        idempotencyKey: "correct-karen-001",
        inputMethod: "dictated",
        transcript:
          "Route to district nursing within 48 hours and mark medium.",
        patch: {
          targetTeamId: "district-nursing",
          dueInMs: 172_800_000,
          clinicalUrgency: "medium",
        },
      },
      warnings: [],
      requiresConfirmation: true,
    });
  });

  it("keeps named ownership at the receiving-team acceptance boundary", () => {
    const preview = parseDictatedRevision({
      taskId: "task-1",
      expectedVersion: 2,
      idempotencyKey: "correct-owner-001",
      transcript: "Owner is Dr Larsen.",
      ...directory,
    });

    expect(preview.draft.patch).toEqual({});
    expect(preview.warnings).toContain(
      "A named owner is selected only after the receiving team accepts the task; no owner was changed.",
    );
  });

  it("maps the natural word urgent onto the shared high urgency enum", () => {
    const preview = parseDictatedRevision({
      taskId: "task-1",
      expectedVersion: 2,
      idempotencyKey: "correct-urgent-001",
      transcript: "Mark urgent.",
      ...directory,
    });

    expect(preview.draft.patch).toEqual({ clinicalUrgency: "high" });
  });
});
