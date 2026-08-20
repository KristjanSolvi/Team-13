import { describe, expect, it, vi } from "vitest";

import type { HandoverPacket, RenderHandoverInput } from "./contracts.js";
import { PipelineError } from "./errors.js";
import {
  normalizeGeneratedHandover,
  renderGroundedHandover,
} from "./handover.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const THREAD_ID = "22222222-2222-4222-8222-222222222222";

function packet(): HandoverPacket {
  return {
    situation: [
      {
        statement: "Karen reports dizziness after the medication change.",
        sourceRefs: ["encounter:sentence-42"],
      },
    ],
    background: [
      {
        statement: "The medication was changed yesterday.",
        sourceRefs: ["record:medication-1"],
      },
    ],
    currentConcerns: [
      {
        statement: "The response to the medication change is not documented.",
        sourceRefs: ["record:observation-1"],
      },
    ],
    outstandingTasks: [
      {
        taskId: TASK_ID,
        threadId: THREAD_ID,
        summary: "Check blood pressure",
        state: "accepted",
        targetTeamId: "district-nursing",
        assignedMemberId: "nurse-7",
        clinicalUrgency: "medium",
        acceptBy: "2026-08-20T12:00:00.000Z",
        dueBy: "2026-08-22T10:00:00.000Z",
        version: 7,
        sourceRefs: [`task:${TASK_ID}@7`, `thread:${THREAD_ID}@3`],
      },
    ],
    awaitingVerification: [],
    escalations: [],
    unknowns: ["The current medication list is unavailable."],
  };
}

function input(value = packet()): RenderHandoverInput {
  return {
    handoverId: "33333333-3333-4333-8333-333333333333",
    patientId: "synthetic-karen",
    sourceSnapshotHash:
      "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    packet: value,
  };
}

function expectPipelineCode(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error("Expected the renderer to reject generated output");
  } catch (error) {
    expect(error).toBeInstanceOf(PipelineError);
    expect((error as PipelineError).code).toBe(code);
  }
}

describe("grounded handover rendering", () => {
  it("groups valid generated narrative into stable clinical sections", () => {
    const rendered = normalizeGeneratedHandover({
      input: input(),
      generatedValue: [
        {
          section: "currentConcerns",
          text: "The response to the medication change is not documented.",
          sourceRefs: ["record:observation-1"],
        },
        {
          section: "situation",
          text: "Karen reports dizziness after the medication change.",
          sourceRefs: ["encounter:sentence-42"],
        },
        {
          section: "background",
          text: "The medication was changed yesterday.",
          sourceRefs: ["record:medication-1"],
        },
      ],
      creditsConsumed: 0.04,
    });

    expect(rendered.title).toBe("Current patient handover");
    expect(rendered.sections.slice(0, 3).map(({ sectionId }) => sectionId)).toEqual([
      "situation",
      "background",
      "current-concerns",
    ]);
    expect(rendered.sections[0]?.statements).toEqual([
      {
        statement: "Karen reports dizziness after the medication change.",
        sourceRefs: ["encounter:sentence-42"],
      },
    ]);
    expect(rendered.creditsConsumed).toBe(0.04);
  });

  it("rejects a narrative source ref that is absent from the packet narrative", () => {
    expectPipelineCode(
      () =>
        normalizeGeneratedHandover({
          input: input(),
          generatedValue: [
            {
              section: "situation",
              text: "Karen reports dizziness.",
              sourceRefs: ["record:someone-else"],
            },
          ],
          creditsConsumed: 0.01,
        }),
      "HANDOVER_UNSUPPORTED_REFERENCE",
    );
  });

  it.each([
    `task:${TASK_ID}@7`,
    `thread:${THREAD_ID}@3`,
  ])("rejects operational ref %s as narrative evidence", (sourceRef) => {
    expectPipelineCode(
      () =>
        normalizeGeneratedHandover({
          input: input(),
          generatedValue: [
            {
              section: "situation",
              text: "Karen has a clinical concern.",
              sourceRefs: [sourceRef],
            },
          ],
          creditsConsumed: 0.01,
        }),
      "HANDOVER_UNSUPPORTED_REFERENCE",
    );
  });

  it("rejects a narrative ref moved across its supplied section boundary", () => {
    expectPipelineCode(
      () =>
        normalizeGeneratedHandover({
          input: input(),
          generatedValue: [
            {
              section: "background",
              text: "Karen reports dizziness.",
              sourceRefs: ["encounter:sentence-42"],
            },
          ],
          creditsConsumed: 0.01,
        }),
      "HANDOVER_UNSUPPORTED_REFERENCE",
    );
  });

  it("rejects a task ref even when a malformed packet puts it in narrative input", () => {
    const contaminated = packet();
    contaminated.situation[0] = {
      statement: "A task is present.",
      sourceRefs: [`task:${TASK_ID}@7`],
    };

    expectPipelineCode(
      () =>
        normalizeGeneratedHandover({
          input: input(contaminated),
          generatedValue: [
            {
              section: "situation",
              text: "A task is present.",
              sourceRefs: [`task:${TASK_ID}@7`],
            },
          ],
          creditsConsumed: 0.01,
        }),
      "HANDOVER_UNSUPPORTED_REFERENCE",
    );
  });

  it.each([
    "Karen was diagnosed with vertigo.",
    "A medication review is recommended.",
    "Karen is ready for discharge.",
  ])("rejects an unsupported generated clinical claim: %s", (text) => {
    expectPipelineCode(
      () =>
        normalizeGeneratedHandover({
          input: input(),
          generatedValue: [
            {
              section: "situation",
              text,
              sourceRefs: ["encounter:sentence-42"],
            },
          ],
          creditsConsumed: 0.01,
        }),
      "HANDOVER_UNSUPPORTED_CLAIM",
    );
  });

  it("rejects an unsupported generated lifecycle claim", () => {
    expectPipelineCode(
      () =>
        normalizeGeneratedHandover({
          input: input(),
          generatedValue: [
            {
              section: "situation",
              text: "The follow-up task has been completed.",
              sourceRefs: ["encounter:sentence-42"],
            },
          ],
          creditsConsumed: 0.01,
        }),
      "HANDOVER_UNSUPPORTED_LIFECYCLE_CLAIM",
    );
  });

  it("rejects an unsupported escalation lifecycle claim", () => {
    expectPipelineCode(
      () =>
        normalizeGeneratedHandover({
          input: input(),
          generatedValue: [
            {
              section: "situation",
              text: "The follow-up task has been escalated.",
              sourceRefs: ["encounter:sentence-42"],
            },
          ],
          creditsConsumed: 0.01,
        }),
      "HANDOVER_UNSUPPORTED_LIFECYCLE_CLAIM",
    );
  });

  it("renders task state and scheduling fields locally with the exact stable contract", () => {
    const rendered = normalizeGeneratedHandover({
      input: input(),
      generatedValue: [
        {
          section: "situation",
          text: "Karen reports dizziness after the medication change.",
          sourceRefs: ["encounter:sentence-42"],
        },
      ],
      creditsConsumed: 0.01,
    });

    expect(
      rendered.sections.find(({ sectionId }) => sectionId === "outstanding-tasks"),
    ).toEqual({
      sectionId: "outstanding-tasks",
      heading: "Outstanding tasks",
      statements: [
        {
          statement:
            "Check blood pressure — state: accepted; team: district-nursing; owner: nurse-7; urgency: medium; accept by: 2026-08-20T12:00:00.000Z; due by: 2026-08-22T10:00:00.000Z.",
          sourceRefs: [`task:${TASK_ID}@7`, `thread:${THREAD_ID}@3`],
        },
      ],
    });
  });

  it.each([undefined, {}, "not structured", []])(
    "fails closed for empty or malformed Guided Documents output: %j",
    (generatedValue) => {
      expectPipelineCode(
        () =>
          normalizeGeneratedHandover({
            input: input(),
            generatedValue,
            creditsConsumed: 0.01,
          }),
        "INVALID_HANDOVER_RENDER",
      );
    },
  );

  it("does not call Text Generation for an empty narrative and consumes zero credits", async () => {
    const emptyNarrative = packet();
    emptyNarrative.situation = [];
    emptyNarrative.background = [];
    emptyNarrative.currentConcerns = [];
    const generate = vi.fn();

    const rendered = await renderGroundedHandover(input(emptyNarrative), generate);

    expect(generate).not.toHaveBeenCalled();
    expect(rendered.creditsConsumed).toBe(0);
    expect(rendered.sections.some(({ sectionId }) => sectionId === "outstanding-tasks"))
      .toBe(true);
    expect(rendered.sections.find(({ sectionId }) => sectionId === "unknowns"))
      .toEqual({
        sectionId: "unknowns",
        heading: "Unknowns",
        statements: [
          {
            statement: "The current medication list is unavailable.",
            sourceRefs: [],
          },
        ],
      });
  });

  it("preserves unknowns locally and never sends them to Text Generation", async () => {
    const generate = vi.fn(async (context: unknown) => {
      expect(context).toEqual({
        situation: packet().situation,
        background: packet().background,
        currentConcerns: packet().currentConcerns,
      });
      expect(JSON.stringify(context)).not.toContain(
        "The current medication list is unavailable.",
      );
      return {
        generatedValue: [
          {
            section: "situation",
            text: "Karen reports dizziness after the medication change.",
            sourceRefs: ["encounter:sentence-42"],
          },
        ],
        creditsConsumed: 0.02,
      };
    });

    const rendered = await renderGroundedHandover(input(), generate);

    expect(generate).toHaveBeenCalledOnce();
    expect(rendered.sections.find(({ sectionId }) => sectionId === "unknowns"))
      .toEqual({
        sectionId: "unknowns",
        heading: "Unknowns",
        statements: [
          {
            statement: "The current medication list is unavailable.",
            sourceRefs: [],
          },
        ],
      });
  });
});
