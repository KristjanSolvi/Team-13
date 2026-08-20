import { describe, expect, it } from "vitest";

import type { GeneratedSupportingDocument } from "./contracts.js";
import {
  evaluateSupportingDocumentSafety,
  findUnsupportedLifecycleClaims,
} from "./document-safety.js";

describe("supporting-document safety", () => {
  it("rejects a generated lifecycle claim absent from approved input", () => {
    expect(
      findUnsupportedLifecycleClaims(
        "Approved action: District Nursing Team to check blood pressure.",
        "Task created for the District Nursing Team to check blood pressure.",
      ),
    ).toEqual([{ id: "created", text: "Task created" }]);
  });

  it("allows a lifecycle claim already present in approved input", () => {
    expect(
      findUnsupportedLifecycleClaims(
        "Task created in the simulated downstream system.",
        "Task was created in the simulated downstream system.",
      ),
    ).toEqual([]);
  });

  it("checks every generated section", () => {
    const document: GeneratedSupportingDocument = {
      documentType: "receiving-team-handoff",
      name: "Draft",
      sections: [
        {
          sectionId: "safe",
          heading: "Request",
          text: "Please check blood pressure within 48 hours.",
        },
        {
          sectionId: "unsafe",
          heading: "Status",
          text: "The action has been accepted.",
        },
      ],
      creditsConsumed: 0.01,
      status: "draft",
    };

    expect(
      evaluateSupportingDocumentSafety(
        document,
        "Approved action: check blood pressure within 48 hours.",
      ),
    ).toMatchObject({ safe: false, unsupportedClaims: [{ id: "accepted" }] });
  });
});
