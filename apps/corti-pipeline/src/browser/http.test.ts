import { afterEach, describe, expect, it, vi } from "vitest";

import type { FollowThroughCandidate, TaskRevisionDraft } from "../contracts.js";
import {
  investigateCandidate,
  submitConfirmedTaskCorrection,
} from "./http.js";

afterEach(() => vi.unstubAllGlobals());

describe("integration API browser calls", () => {
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
