import { describe, expect, it } from "vitest";

import { appendFinalTranscript, presentRevisionPatch } from "./presentation.js";

describe("microphone harness presentation", () => {
  it("joins final dictation fragments without adding empty text", () => {
    expect(appendFinalTranscript("Route to district nursing.", "Within 48 hours.")).toBe(
      "Route to district nursing. Within 48 hours.",
    );
    expect(appendFinalTranscript("", "  Mark medium.  ")).toBe("Mark medium.");
  });

  it("renders only fields present in a constrained revision patch", () => {
    expect(
      presentRevisionPatch({
        targetTeamId: "district-nursing",
        dueInMs: 172_800_000,
        clinicalUrgency: "medium",
      }),
    ).toEqual([
      { label: "Receiving team", value: "district-nursing" },
      { label: "Deadline", value: "48 hours from approval" },
      { label: "Clinical urgency", value: "medium" },
    ]);
  });
});
