import { describe, expect, it } from "vitest";

import type { CodingResult, FollowThroughCandidate } from "./contracts.js";
import {
  KAREN_APPROVED_OUTPUT_INPUT,
  KAREN_PRELOADED_CANDIDATE,
  KAREN_PRELOADED_SEGMENTS,
} from "./demo/karen.js";
import {
  evaluateCandidateGrounding,
  evaluateCodingGrounding,
  evaluateDocumentGrounding,
} from "./evaluation.js";

describe("golden-path evaluation", () => {
  it("accepts the disclosed Karen fallback only while its quote is exact", () => {
    expect(
      evaluateCandidateGrounding(
        [KAREN_PRELOADED_CANDIDATE],
        KAREN_PRELOADED_SEGMENTS,
      ).every((check) => check.passed),
    ).toBe(true);

    expect(
      evaluateCandidateGrounding(
        [KAREN_PRELOADED_CANDIDATE, KAREN_PRELOADED_CANDIDATE],
        KAREN_PRELOADED_SEGMENTS,
      ),
    ).toContainEqual(
      expect.objectContaining({ id: "candidate-focused", passed: false }),
    );

    const changed: FollowThroughCandidate = {
      ...KAREN_PRELOADED_CANDIDATE,
      evidence: [
        {
          ...KAREN_PRELOADED_CANDIDATE.evidence[0]!,
          sourceQuote: "I became dizzy after the medication changed.",
        },
      ],
    };
    expect(
      evaluateCandidateGrounding([changed], KAREN_PRELOADED_SEGMENTS),
    ).toContainEqual(
      expect.objectContaining({ id: "candidate-evidence", passed: false }),
    );
  });

  it("fails a coding response whose offsets do not reproduce approved text", () => {
    const text = KAREN_APPROVED_OUTPUT_INPUT.approvedClinicalText;
    const start = text.indexOf("dizziness");
    const result: CodingResult = {
      system: "icd10int-outpatient",
      codes: [
        {
          system: "icd10int-outpatient",
          code: "R42",
          display: "Dizziness and giddiness",
          evidences: [
            {
              contextIndex: 0,
              text: "dizziness",
              start,
              end: start + "dizziness".length,
            },
          ],
          alternatives: [],
          evidenceStatus: "validated",
        },
      ],
      candidates: [],
      creditsConsumed: 0.01,
    };

    expect(
      evaluateCodingGrounding(result, text).every((check) => check.passed),
    ).toBe(true);

    result.codes[0]!.evidences[0]!.text = "vertigo";
    expect(evaluateCodingGrounding(result, text)).toContainEqual(
      expect.objectContaining({ id: "coding-evidence", passed: false }),
    );
  });

  it("fails a generated document that invents task creation", () => {
    expect(
      evaluateDocumentGrounding(
        {
          documentType: "receiving-team-handoff",
          name: "Draft",
          sections: [
            {
              sectionId: "handoff",
              heading: "Handoff",
              text: "Task created for dizziness follow-up.",
            },
          ],
          creditsConsumed: 0.01,
          status: "draft",
        },
        KAREN_APPROVED_OUTPUT_INPUT.approvedClinicalText,
      ),
    ).toContainEqual(
      expect.objectContaining({
        id: "document-lifecycle-grounded",
        passed: false,
      }),
    );
  });
});
