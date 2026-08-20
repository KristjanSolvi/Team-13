import { describe, expect, it } from "vitest";

import type { Corti } from "@corti/sdk";

import type { TranscriptSegment } from "../contracts.js";
import {
  applyStreamFacts,
  buildSpeechAudioConstraints,
  markTranscriptAudioQuality,
  normalizeAudioQualityEvent,
  normalizeSpeechKeyterms,
} from "./speech.js";

describe("speech capture resilience", () => {
  it("requests only supported browser speech-processing constraints", () => {
    expect(
      buildSpeechAudioConstraints(
        {
          autoGainControl: true,
          channelCount: true,
          deviceId: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
        "close-microphone",
      ),
    ).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: { ideal: 1 },
      deviceId: { exact: "close-microphone" },
    });

    expect(buildSpeechAudioConstraints({ echoCancellation: true })).toEqual({
      echoCancellation: true,
    });
  });

  it("deduplicates valid Corti keyterms and drops overlong entries", () => {
    expect(
      normalizeSpeechKeyterms([
        " Karen ",
        "district nursing",
        "Karen",
        "",
        "x".repeat(51),
      ]),
    ).toEqual([{ term: "Karen" }, { term: "district nursing" }]);
  });

  it("normalizes Corti quality events for the shared event stream", () => {
    expect(
      normalizeAudioQualityEvent("ambient", {
        event: "speechQualityIssueDetected",
        channel: 0,
        startTimeMs: 12_500,
      }),
    ).toEqual({
      product: "ambient",
      state: "speech-quality-issue",
      channel: 0,
      startSeconds: 12.5,
    });
  });

  it("marks transcript spans that overlap a speech-quality issue", () => {
    const segments: TranscriptSegment[] = [
      {
        interactionId: "interaction-1",
        segmentKey: "interaction-1:10",
        text: "Clear sentence.",
        startSeconds: 10,
        endSeconds: 12,
        isFinal: true,
      },
      {
        interactionId: "interaction-1",
        segmentKey: "interaction-1:13",
        text: "Noisy sentence.",
        startSeconds: 13,
        endSeconds: 17,
        isFinal: true,
      },
    ];

    expect(
      markTranscriptAudioQuality(segments, [
        { channel: 0, startSeconds: 12.5, endSeconds: 18 },
      ]).map((segment) => segment.audioQuality),
    ).toEqual(["clear", "uncertain"]);
  });

  it("does not mark segments that merely touch a quality-window boundary", () => {
    const segments: TranscriptSegment[] = [
      {
        interactionId: "interaction-1",
        segmentKey: "interaction-1:10",
        text: "Sentence ending before the issue.",
        startSeconds: 10,
        endSeconds: 12.5,
        isFinal: true,
      },
      {
        interactionId: "interaction-1",
        segmentKey: "interaction-1:18",
        text: "Sentence starting after recovery.",
        startSeconds: 18,
        endSeconds: 20,
        isFinal: true,
      },
    ];

    expect(
      markTranscriptAudioQuality(segments, [
        { channel: 0, startSeconds: 12.5, endSeconds: 18 },
      ]).map((segment) => segment.audioQuality),
    ).toEqual(["clear", "clear"]);
  });
});

describe("applyStreamFacts", () => {
  const streamFact = (overrides: Partial<Corti.StreamFact> = {}): Corti.StreamFact => ({
    id: "fact-1",
    text: "Blood pressure check requested at home",
    group: "plan",
    groupId: "group-plan",
    isDiscarded: false,
    source: "core",
    createdAt: new Date("2026-08-20T10:00:00Z"),
    ...overrides,
  });

  it("normalizes an incoming fact and keeps first-heard order", () => {
    const first = applyStreamFacts([], [streamFact()]);
    const second = applyStreamFacts(first, [
      streamFact({ id: "fact-2", text: " Referral to district nursing ", group: " referral " }),
    ]);
    expect(second.map((fact) => fact.factId)).toEqual(["fact-1", "fact-2"]);
    expect(second[1]).toMatchObject({
      text: "Referral to district nursing",
      group: "referral",
      source: "core",
      createdAt: "2026-08-20T10:00:00.000Z",
    });
  });

  it("replaces an updated fact by id instead of duplicating it", () => {
    const first = applyStreamFacts([], [streamFact()]);
    const second = applyStreamFacts(first, [streamFact({ text: "BP check twice daily" })]);
    expect(second).toHaveLength(1);
    expect(second[0]?.text).toBe("BP check twice daily");
  });

  it("removes discarded and empty facts", () => {
    const first = applyStreamFacts([], [streamFact(), streamFact({ id: "fact-2" })]);
    const second = applyStreamFacts(first, [
      streamFact({ isDiscarded: true }),
      streamFact({ id: "fact-2", text: "   " }),
    ]);
    expect(second).toHaveLength(0);
  });

  it("returns the same array instance when nothing changed", () => {
    const first = applyStreamFacts([], [streamFact()]);
    expect(applyStreamFacts(first, [])).toBe(first);
    expect(applyStreamFacts(first, [streamFact()])).toBe(first);
  });
});
