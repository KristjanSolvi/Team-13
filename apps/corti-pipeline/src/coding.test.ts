import { describe, expect, it } from "vitest";

import { normalizeCodingResult } from "./coding.js";

describe("normalizeCodingResult", () => {
  it("preserves API ordering and drops invalid evidence spans", () => {
    const result = normalizeCodingResult({
      system: "icd10int-outpatient",
      approvedClinicalText: "Patient reports dizziness.",
      response: {
        codes: [
          {
            system: "icd10int-outpatient",
            code: "R42",
            display: "Dizziness and giddiness",
            evidences: [
              { contextIndex: 0, text: "dizziness", start: 16, end: 25 },
            ],
          },
        ],
        candidates: [
          {
            system: "icd10int-outpatient",
            code: "Z00",
            display: "Candidate",
            evidences: [
              { contextIndex: 0, text: "not present", start: 0, end: 7 },
            ],
          },
        ],
        usageInfo: { creditsConsumed: 0.0345 },
      },
    });

    expect(result.codes[0]).toMatchObject({
      code: "R42",
      evidenceStatus: "validated",
      evidences: [{ text: "dizziness", start: 16, end: 25 }],
    });
    expect(result.candidates[0]).toMatchObject({
      code: "Z00",
      evidenceStatus: "unavailable",
      evidences: [],
    });
    expect(result.creditsConsumed).toBe(0.0345);
  });
});
