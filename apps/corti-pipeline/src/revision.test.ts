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
  owners: [{ id: "user-larsen", label: "Dr Larsen" }],
};

describe("parseDictatedRevision", () => {
  it("creates a preview from allow-listed terms without committing anything", () => {
    const preview = parseDictatedRevision({
      taskId: "task-karen-bp",
      transcript:
        "Route to district nursing, owner is Dr Larsen, within 48 hours and mark urgent.",
      now: new Date("2026-08-20T10:00:00.000Z"),
      ...directory,
    });

    expect(preview).toEqual({
      draft: {
        taskId: "task-karen-bp",
        inputMethod: "dictated",
        transcript:
          "Route to district nursing, owner is Dr Larsen, within 48 hours and mark urgent.",
        patch: {
          recipientTeamId: "district-nursing",
          ownerUserId: "user-larsen",
          dueAt: "2026-08-22T10:00:00.000Z",
          priority: "urgent",
        },
      },
      warnings: [],
      requiresConfirmation: true,
    });
  });

  it("does not invent an unknown owner", () => {
    const preview = parseDictatedRevision({
      taskId: "task-1",
      transcript: "Owner is Doctor Unknown.",
      ...directory,
    });

    expect(preview.draft.patch).toEqual({});
    expect(preview.warnings).toContain(
      "The owner was not found in the allowed directory.",
    );
  });
});
