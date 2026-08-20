import { afterEach, describe, expect, it, vi } from "vitest";

import type { FollowThroughCandidate, TaskRevisionDraft } from "../contracts.js";
import {
  generateCandidates,
  generateSupportingDocument,
  investigateCandidate,
  predictMedicalCodes,
  submitConfirmedTaskCorrection,
} from "./http.js";

afterEach(() => vi.unstubAllGlobals());

describe("integration API browser calls", () => {
  it("preserves the correlation ID across candidate Text Generation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [],
          rejectedEvidenceCount: 0,
          rejectedAudioQualityCount: 0,
          creditsConsumed: 0.01,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const segments = [
      {
        interactionId: "interaction-karen-1",
        segmentKey: "interaction-karen-1:6",
        text: "I have felt dizzy since my medication changed.",
        startSeconds: 6,
        endSeconds: 10,
        isFinal: true,
        audioQuality: "clear" as const,
      },
    ];

    await generateCandidates(
      "http://127.0.0.1:8787",
      {
        patientId: "synthetic-karen",
        interactionId: "interaction-karen-1",
        segments,
      },
      "corr-karen-textgen",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:8787/api/corti/candidates/generate"),
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-karen-textgen",
        },
        body: JSON.stringify({
          patientId: "synthetic-karen",
          interactionId: "interaction-karen-1",
          segments,
        }),
      }),
    );
  });

  it("sends only explicitly approved text to document generation and coding", async () => {
    const approvedInput = {
      approvalId: "approval-karen-1",
      approvedClinicalText:
        "Patient reports dizziness. District Nursing Team to check blood pressure within 48 hours.",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            documentType: "receiving-team-handoff",
            name: "Draft",
            sections: [],
            creditsConsumed: 0.01,
            status: "draft",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            system: "icd10int-outpatient",
            codes: [],
            candidates: [],
            creditsConsumed: 0.01,
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await generateSupportingDocument(
      "http://127.0.0.1:8787",
      { ...approvedInput, documentType: "receiving-team-handoff" },
      "corr-approved-output",
    );
    await predictMedicalCodes(
      "http://127.0.0.1:8787",
      { ...approvedInput, system: "icd10int-outpatient" },
      "corr-approved-output",
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      new URL("http://127.0.0.1:8787/api/corti/documents/generate"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          ...approvedInput,
          documentType: "receiving-team-handoff",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL("http://127.0.0.1:8787/api/corti/coding/predict"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          ...approvedInput,
          system: "icd10int-outpatient",
        }),
      }),
    );
  });

  it("sends a normalized candidate with its correlation ID", async () => {
    const candidate: FollowThroughCandidate = {
      schemaVersion: "1",
      candidateId: "candidate-karen-1",
      correlationId: "corr-karen-1",
      interactionId: "interaction-karen-1",
      patientId: "synthetic-karen",
      category: "medication-concern",
      summary: "Karen reports dizziness after a medication change.",
      evidence: [
        {
          interactionId: "interaction-karen-1",
          segmentKey: "interaction-karen-1:12",
          sourceQuote: "I have been dizzy since my medication changed.",
          startSeconds: 12,
          endSeconds: 16,
          audioQuality: "clear",
        },
      ],
      status: "candidate",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidateId: candidate.candidateId, handoff: {} }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await investigateCandidate("http://127.0.0.1:8788", candidate);

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:8788/api/candidates/investigate"),
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-karen-1",
        },
        body: JSON.stringify(candidate),
      }),
    );
  });

  it("sends the confirmed correction with actor and version metadata", async () => {
    const draft: TaskRevisionDraft = {
      taskId: "task/karen-bp",
      expectedVersion: 3,
      idempotencyKey: "correct-karen-001",
      inputMethod: "dictated",
      patch: { targetTeamId: "district-nursing", dueInMs: 172_800_000 },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await submitConfirmedTaskCorrection(
      "http://127.0.0.1:8788",
      draft,
      "clinician:demo",
      "corr-karen-1",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:8788/api/tasks/task%2Fkaren-bp/correct"),
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-actor-id": "clinician:demo",
          "x-correlation-id": "corr-karen-1",
        },
        body: JSON.stringify({
          expectedVersion: 3,
          targetTeamId: "district-nursing",
          dueInMs: 172_800_000,
          idempotencyKey: "correct-karen-001",
        }),
      }),
    );
  });
});
