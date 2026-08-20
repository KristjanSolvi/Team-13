import type { Corti } from "@corti/sdk";

import type {
  AmbientFact,
  AudioQualityEventPayload,
  TranscriptSegment,
} from "../contracts.js";

export interface SpeechQualityWindow {
  channel: number;
  startSeconds: number;
  endSeconds?: number;
}

export function normalizeSpeechKeyterms(
  values: readonly string[],
): Array<{ term: string }> {
  const unique = new Set<string>();
  for (const value of values) {
    const term = value.trim();
    if (term.length > 0 && term.length <= 50) {
      unique.add(term);
    }
    if (unique.size === 1_000) {
      break;
    }
  }
  return [...unique].map((term) => ({ term }));
}

export function buildSpeechAudioConstraints(
  supported: MediaTrackSupportedConstraints,
  audioDeviceId?: string,
): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = {};
  if (supported.echoCancellation) {
    constraints.echoCancellation = true;
  }
  if (supported.noiseSuppression) {
    constraints.noiseSuppression = true;
  }
  if (supported.autoGainControl) {
    constraints.autoGainControl = true;
  }
  if (supported.channelCount) {
    constraints.channelCount = { ideal: 1 };
  }
  if (supported.deviceId && audioDeviceId !== undefined) {
    constraints.deviceId = { exact: audioDeviceId };
  }
  return constraints;
}

export function normalizeAudioQualityEvent(
  product: "ambient" | "dictation",
  data: Corti.StreamAudioEventData | Corti.TranscribeAudioEventData,
): AudioQualityEventPayload {
  const state = (() => {
    switch (data.event) {
      case "speechQualityIssueDetected":
        return "speech-quality-issue" as const;
      case "speechQualityIssueRecovered":
        return "speech-quality-recovered" as const;
      case "longSilenceDetected":
        return "long-silence" as const;
      case "longSilenceRecovered":
        return "speech-resumed" as const;
    }
  })();

  return {
    product,
    state,
    channel: data.channel,
    startSeconds: data.startTimeMs / 1_000,
  };
}

export function markTranscriptAudioQuality(
  segments: readonly TranscriptSegment[],
  windows: readonly SpeechQualityWindow[],
): TranscriptSegment[] {
  return segments.map((segment) => {
    const uncertain = windows.some(
      (window) =>
        segment.endSeconds > window.startSeconds &&
        (window.endSeconds === undefined ||
          segment.startSeconds < window.endSeconds),
    );
    const audioQuality = uncertain ? "uncertain" : "clear";
    return segment.audioQuality === audioQuality
      ? segment
      : { ...segment, audioQuality };
  });
}

/**
 * Folds one FactsR stream message into the accumulated fact list. Facts are
 * keyed by id so later updates replace earlier versions, discarded facts are
 * removed, and the result keeps a stable first-heard order. Returns the same
 * array instance when nothing changed so React consumers can diff cheaply.
 */
export function applyStreamFacts(
  current: readonly AmbientFact[],
  incoming: readonly Corti.StreamFact[],
): readonly AmbientFact[] {
  if (incoming.length === 0) {
    return current;
  }
  const byId = new Map(current.map((fact) => [fact.factId, fact]));
  let changed = false;
  for (const fact of incoming) {
    const text = fact.text.trim();
    if (fact.isDiscarded || text.length === 0) {
      changed = byId.delete(fact.id) || changed;
      continue;
    }
    const normalized: AmbientFact = {
      factId: fact.id,
      text,
      group: fact.group.trim(),
      source: fact.source,
      createdAt: new Date(fact.createdAt).toISOString(),
    };
    const existing = byId.get(fact.id);
    if (
      existing === undefined ||
      existing.text !== normalized.text ||
      existing.group !== normalized.group ||
      existing.source !== normalized.source
    ) {
      changed = true;
    }
    byId.set(fact.id, normalized);
  }
  if (!changed && byId.size === current.length) {
    return current;
  }
  return [...byId.values()];
}
