import "@corti/dictation-web";

import type {
  CortiDictation,
  DeltaUsageEventDetail,
  ErrorEventDetail,
  TranscriptEventDetail,
  UsageEventDetail,
} from "@corti/dictation-web";
import type { Corti } from "@corti/sdk";

import type { PipelineEvent, ScopedToken } from "../contracts.js";
import { pipelineEvent } from "../events.js";

export interface BindDictationOptions {
  element: CortiDictation;
  token: ScopedToken;
  refreshToken: () => Promise<ScopedToken>;
  primaryLanguage: string;
  correlationId: string;
  onEvent: (event: PipelineEvent) => void;
}

function isDictationTranscript(
  detail: TranscriptEventDetail,
): detail is Corti.TranscribeTranscriptMessage {
  return detail.type === "transcript" && !Array.isArray(detail.data);
}

export function bindCortiDictation(options: BindDictationOptions) {
  options.element.authConfig = {
    accessToken: options.token.accessToken,
    expiresIn: options.token.expiresIn,
    refreshAccessToken: options.refreshToken,
  };
  options.element.dictationConfig = {
    primaryLanguage: options.primaryLanguage,
    interimResults: true,
    automaticPunctuation: true,
    spokenPunctuation: false,
    formatting: {
      numbers: "numerals_above_nine",
      measurements: "abbreviated",
    },
  };

  const onTranscript = (event: Event) => {
    const detail = (event as CustomEvent<TranscriptEventDetail>).detail;
    if (!isDictationTranscript(detail)) {
      return;
    }
    const data = detail.data;
    options.onEvent(
      pipelineEvent({
        type: data.isFinal ? "dictation.final" : "dictation.interim",
        correlationId: options.correlationId,
        payload: {
          text: data.text,
          startSeconds: data.start,
          endSeconds: data.end,
        },
      }),
    );
  };

  const onUsage = (event: Event) => {
    const detail = (event as CustomEvent<UsageEventDetail | DeltaUsageEventDetail>)
      .detail;
    options.onEvent(
      pipelineEvent({
        type: "usage.updated",
        correlationId: options.correlationId,
        payload: { product: "dictation", creditsConsumed: detail.credits },
      }),
    );
  };

  const onError = (event: Event) => {
    const detail = (event as CustomEvent<ErrorEventDetail>).detail;
    options.onEvent(
      pipelineEvent({
        type: "pipeline.error",
        correlationId: options.correlationId,
        payload: {
          code: "DICTATION_STREAM_ERROR",
          message:
            detail.message.length > 0
              ? "The Dictation stream encountered an error."
              : "The Dictation stream ended unexpectedly.",
          retryable: true,
          correlationId: options.correlationId,
        },
      }),
    );
  };

  options.element.addEventListener("transcript", onTranscript);
  options.element.addEventListener("usage", onUsage);
  options.element.addEventListener("delta-usage", onUsage);
  options.element.addEventListener("error", onError);

  return async () => {
    options.element.removeEventListener("transcript", onTranscript);
    options.element.removeEventListener("usage", onUsage);
    options.element.removeEventListener("delta-usage", onUsage);
    options.element.removeEventListener("error", onError);
    await options.element.closeConnection();
  };
}
