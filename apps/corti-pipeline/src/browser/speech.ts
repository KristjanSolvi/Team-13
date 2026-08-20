import type { Corti } from "@corti/sdk";

import type {
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
