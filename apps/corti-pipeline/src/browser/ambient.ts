import { CortiClient, type Corti } from "@corti/sdk";

import type {
  AmbientSession,
  PipelineEvent,
  ScopedToken,
  TranscriptSegment,
} from "../contracts.js";
import { pipelineEvent } from "../events.js";
import {
  mergeTranscriptSegments,
  normalizeStreamTranscript,
} from "../transcript.js";

type AmbientSocket = Awaited<ReturnType<CortiClient["stream"]["connect"]>>;
type AmbientMessage =
  | Corti.StreamTranscriptMessage
  | Corti.StreamFactsMessage
  | Corti.StreamFlushedMessage
  | Corti.StreamDeltaUsageMessage
  | Corti.StreamEndedMessage
  | Corti.StreamUsageMessage
  | Corti.StreamErrorMessage
  | Corti.StreamConfigStatusMessage
  | Corti.StreamAudioEventMessage;

export interface AmbientCaptureOptions {
  session: AmbientSession;
  correlationId: string;
  refreshToken: () => Promise<ScopedToken>;
  onEvent: (event: PipelineEvent) => void;
  mediaDevices?: MediaDevices;
  mediaRecorder?: typeof MediaRecorder;
}

function supportedAudioType(mediaRecorder: typeof MediaRecorder): string {
  const preferred = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  return preferred.find((type) => mediaRecorder.isTypeSupported(type)) ?? "";
}

function waitForRecorderStop(recorder: MediaRecorder): Promise<void> {
  if (recorder.state === "inactive") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    recorder.addEventListener("stop", () => resolve(), { once: true });
    recorder.stop();
  });
}

export class AmbientCapture {
  readonly #options: AmbientCaptureOptions;
  #socket: AmbientSocket | null = null;
  #mediaStream: MediaStream | null = null;
  #recorder: MediaRecorder | null = null;
  #segments: TranscriptSegment[] = [];
  #audioQueue: Promise<void> = Promise.resolve();
  #ended: Promise<void> | null = null;
  #resolveEnded: (() => void) | null = null;

  constructor(options: AmbientCaptureOptions) {
    this.#options = options;
  }

  get segments(): readonly TranscriptSegment[] {
    return this.#segments;
  }

  async start(): Promise<void> {
    if (this.#socket !== null) {
      throw new Error("Ambient capture has already started.");
    }

    const MediaRecorderClass = this.#options.mediaRecorder ?? window.MediaRecorder;
    const mediaDevices = this.#options.mediaDevices ?? navigator.mediaDevices;
    const audioType = supportedAudioType(MediaRecorderClass);
    const client = new CortiClient({
      environment: this.#options.session.environment,
      tenantName: this.#options.session.tenantName,
      auth: {
        accessToken: this.#options.session.accessToken,
        expiresIn: this.#options.session.expiresIn,
        refreshAccessToken: this.#options.refreshToken,
      },
    });

    try {
      this.#socket = await client.stream.connect({
        id: this.#options.session.interactionId,
        configuration: {
          transcription: {
            primaryLanguage: this.#options.session.primaryLanguage,
            diarize: true,
            isMultichannel: false,
            participants: [{ channel: 0, role: "multiple" }],
          },
          mode: {
            type: "facts",
            outputLocale: this.#options.session.outputLanguage,
          },
          retentionPolicy: "none",
          ...(audioType.length > 0 ? { audioFormat: audioType } : {}),
        },
      });
      this.#ended = new Promise((resolve) => {
        this.#resolveEnded = resolve;
      });
      this.#socket.on("message", (message) => this.#onMessage(message));
      this.#socket.on("error", () => {
        this.#emitError(
          "AMBIENT_STREAM_ERROR",
          "The Ambient stream encountered an error.",
          true,
        );
      });

      this.#mediaStream = await mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      this.#recorder =
        audioType.length > 0
          ? new MediaRecorderClass(this.#mediaStream, { mimeType: audioType })
          : new MediaRecorderClass(this.#mediaStream);
      this.#recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size === 0 || this.#socket === null) {
          return;
        }
        const socket = this.#socket;
        this.#audioQueue = this.#audioQueue.then(async () => {
          socket.sendAudio(await event.data.arrayBuffer());
        });
      });
      this.#recorder.start(1_000);
      this.#options.onEvent(
        pipelineEvent({
          type: "ambient.started",
          correlationId: this.#options.correlationId,
          interactionId: this.#options.session.interactionId,
          payload: { startedAt: new Date().toISOString() },
        }),
      );
    } catch (error) {
      await this.#cleanup();
      this.#emitError(
        "AMBIENT_START_FAILED",
        "Ambient capture failed to start.",
        true,
      );
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.#socket === null || this.#recorder === null) {
      return;
    }

    try {
      await waitForRecorderStop(this.#recorder);
      await this.#audioQueue;
      this.#socket.sendEnd({ type: "end" });
      await Promise.race([
        this.#ended ?? Promise.resolve(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("Ambient stream did not end in time.")), 15_000),
        ),
      ]);
      this.#options.onEvent(
        pipelineEvent({
          type: "ambient.ended",
          correlationId: this.#options.correlationId,
          interactionId: this.#options.session.interactionId,
          payload: {},
        }),
      );
    } catch (error) {
      this.#emitError(
        "AMBIENT_STOP_FAILED",
        "Ambient capture failed to stop cleanly.",
        true,
      );
      throw error;
    } finally {
      await this.#cleanup();
    }
  }

  #onMessage(message: AmbientMessage) {
    if (message.type === "transcript") {
      const incoming = message.data.map(normalizeStreamTranscript);
      this.#segments = mergeTranscriptSegments(this.#segments, incoming);
      const hasFinal = incoming.some((segment) => segment.isFinal);
      this.#options.onEvent(
        pipelineEvent({
          type: hasFinal ? "transcript.final" : "transcript.interim",
          correlationId: this.#options.correlationId,
          interactionId: this.#options.session.interactionId,
          payload: { segments: this.#segments },
        }),
      );
      return;
    }

    if (message.type === "usage" || message.type === "delta_usage") {
      this.#options.onEvent(
        pipelineEvent({
          type: "usage.updated",
          correlationId: this.#options.correlationId,
          interactionId: this.#options.session.interactionId,
          payload: { product: "ambient", creditsConsumed: message.credits },
        }),
      );
      return;
    }

    if (message.type === "ENDED") {
      this.#resolveEnded?.();
    }
  }

  #emitError(code: string, message: string, retryable: boolean) {
    this.#options.onEvent(
      pipelineEvent({
        type: "pipeline.error",
        correlationId: this.#options.correlationId,
        interactionId: this.#options.session.interactionId,
        payload: {
          code,
          message,
          retryable,
          correlationId: this.#options.correlationId,
        },
      }),
    );
  }

  async #cleanup(): Promise<void> {
    this.#socket?.close();
    this.#socket = null;
    this.#mediaStream?.getTracks().forEach((track) => track.stop());
    this.#mediaStream = null;
    this.#recorder = null;
    this.#resolveEnded = null;
    this.#ended = null;
  }
}
