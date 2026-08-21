import { describe, expect, it } from "vitest";
import { buildReviewedTranscript } from "./transcript-interpretation.js";
import { transcriptReviewDemoForPatient } from "./demo-review-fixtures.js";

describe("transcriptReviewDemoForPatient", () => {
  it("replays Samir's post-scribe review and visibly corrects the interpretation", () => {
    const fixture = transcriptReviewDemoForPatient("synthetic-samir");

    expect(fixture).not.toBeNull();
    expect(fixture?.segments[1]?.text).toContain("parachutes");
    expect(fixture?.suggestions[0]).toMatchObject({
      originalText: "parachutes",
      suggestedText: "paracetamol",
    });

    const reviewed = buildReviewedTranscript(fixture!.segments, fixture!.suggestions, {
      "demo-samir-paracetamol": "use-suggestion",
    });

    expect(reviewed.segments[1]?.text).toContain("paracetamol");
    expect(fixture?.segments[1]?.text).toContain("parachutes");
    expect(reviewed.originalTranscriptPreserved).toBe(true);
  });

  it("does not seed the replay for other patients", () => {
    expect(transcriptReviewDemoForPatient("synthetic-sarah")).toBeNull();
  });
});
