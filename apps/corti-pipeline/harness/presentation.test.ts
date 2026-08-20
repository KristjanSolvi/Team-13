import { describe, expect, it } from "vitest";

import { appendFinalTranscript, presentRevisionPatch } from "./presentation.js";

describe("microphone harness presentation", () => {
  it("joins final dictation fragments without adding empty text", () => {
    expect(appendFinalTranscript("Route to district nursing.", "Within 48 hours.")).toBe(
      "Route to district nursing. Within 48 hours.",
    );
    expect(appendFinalTranscript("", "  Mark urgent.  ")).toBe("Mark urgent.");
  });

  it("renders only fields present in a constrained revision patch", () => {
    expect(
      presentRevisionPatch({
        recipientTeamId: "district-nursing",
        ownerUserId: null,
        priority: "urgent",
      }),
    ).toEqual([
      { label: "Receiving team", value: "district-nursing" },
      { label: "Accountable owner", value: "Unassigned until acceptance" },
      { label: "Priority", value: "urgent" },
    ]);
  });
});
