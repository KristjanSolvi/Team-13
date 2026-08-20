import { describe, expect, it } from "vitest";

import type { FollowThroughCandidate, TaskRevisionDraft } from "./contracts.js";
import {
  buildIntegrationCandidateRequest,
  buildTaskCorrectionCommand,
} from "./integration-handoff.js";

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
      speakerId: 1,
      audioQuality: "clear",
    },
  ],
  status: "candidate",
};

describe("integration API handoff", () => {
  it("keeps rich evidence and correlation around the normalized candidate", () => {
    expect(buildIntegrationCandidateRequest(candidate)).toEqual({
      schemaVersion: "1",
      correlationId: "corr-karen-1",
      body: candidate,
    });
  });

  it("refuses evidence sourced from uncertain audio", () => {
    expect(() =>
      buildIntegrationCandidateRequest({
        ...candidate,
        evidence: [{ ...candidate.evidence[0]!, audioQuality: "uncertain" }],
      }),
    ).toThrow("Uncertain audio evidence cannot be investigated.");
  });

  it("flattens a confirmed revision into the integration correction body", () => {
    const draft: TaskRevisionDraft = {
      taskId: "task-karen-bp",
      expectedVersion: 2,
      idempotencyKey: "correct-karen-001",
      inputMethod: "dictated",
      transcript: "Route to district nursing within 48 hours.",
      patch: {
        targetTeamId: "district-nursing",
        dueInMs: 172_800_000,
      },
    };

    expect(buildTaskCorrectionCommand(draft)).toEqual({
      expectedVersion: 2,
      targetTeamId: "district-nursing",
      dueInMs: 172_800_000,
      idempotencyKey: "correct-karen-001",
    });
  });

  it("refuses to submit a revision preview with no recognized changes", () => {
    expect(() =>
      buildTaskCorrectionCommand({
        taskId: "task-karen-bp",
        expectedVersion: 2,
        idempotencyKey: "correct-karen-empty",
        inputMethod: "dictated",
        transcript: "Owner is Dr Larsen.",
        patch: {},
      }),
    ).toThrow("A confirmed correction needs at least one changed field.");
  });
});
