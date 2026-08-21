import assert from "node:assert/strict";
import test from "node:test";

import { generateCandidates } from "../src/lib/follow-through-api.ts";

test("candidate generation sends live FactsR context with final transcript evidence", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let requestBody: unknown;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "https://ward.example" } },
  });
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        candidates: [],
        rejectedEvidenceCount: 0,
        rejectedAudioQualityCount: 0,
        creditsConsumed: 0,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", originalWindow);
    }
  });

  await generateCandidates({
    patientId: "synthetic-sarah",
    interactionId: "interaction-1",
    correlationId: "correlation-1",
    segments: [
      {
        interactionId: "interaction-1",
        segmentKey: "segment-1",
        text: "Could someone make sure the blood pressure is checked after discharge?",
        startSeconds: 0,
        endSeconds: 5,
        isFinal: true,
      },
    ],
    facts: [
      {
        factId: "fact-1",
        text: "Blood pressure follow-up discussed",
        group: "plan",
        source: "ambient",
        createdAt: "2026-08-21T10:05:30.000Z",
      },
    ],
  } as Parameters<typeof generateCandidates>[0] & {
    facts: Array<{
      factId: string;
      text: string;
      group: string;
      source: string;
      createdAt: string;
    }>;
  });

  assert.deepEqual((requestBody as { facts?: unknown }).facts, [
    {
      factId: "fact-1",
      text: "Blood pressure follow-up discussed",
      group: "plan",
      source: "ambient",
      createdAt: "2026-08-21T10:05:30.000Z",
    },
  ]);
});
