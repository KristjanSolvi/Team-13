import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, LoaderCircle, Mic, Radio, Square } from "lucide-react";
import { AmbientCapture } from "@pipeline/browser/ambient.js";
import type {
  FollowThroughCandidate,
  PipelineEvent,
  TranscriptSegment,
} from "@pipeline/contracts.js";
import type { Patient } from "@/data/ward";
import {
  createAmbientSession,
  generateCandidates,
  getPipelineHealth,
  investigateCandidate,
  refreshAmbientToken,
} from "@/lib/follow-through-api";

type CaptureState =
  | "checking"
  | "unavailable"
  | "idle"
  | "starting"
  | "recording"
  | "stopping"
  | "analysing"
  | "complete"
  | "error";

type InvestigationState = "checking" | "sent" | "failed";

type CandidateView = {
  candidate: FollowThroughCandidate;
  state: InvestigationState;
  message: string;
};

type Props = { patient: Patient };

function timeLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function microphoneMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone access was denied. Allow it in the browser and macOS settings, then retry.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No microphone was found. Connect or enable an input device, then retry.";
  }
  return error instanceof Error
    ? error.message
    : "Ambient capture could not start. Check the pipeline service and retry.";
}

export function LiveStrip({ patient }: Props) {
  const [state, setState] = useState<CaptureState>("checking");
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [candidateViews, setCandidateViews] = useState<CandidateView[]>([]);
  const [message, setMessage] = useState("Checking the Corti pipeline…");
  const [audioMessage, setAudioMessage] = useState("Audio not checked");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const captureRef = useRef<AmbientCapture | null>(null);
  const correlationIdRef = useRef(crypto.randomUUID());

  const refreshDevices = useCallback(async () => {
    if (navigator.mediaDevices === undefined) return;
    try {
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === "audioinput",
      );
      setDevices(inputs);
      setDeviceId((current) =>
        current.length > 0 && inputs.some((device) => device.deviceId === current) ? current : "",
      );
    } catch {
      // Device labels can remain hidden until microphone permission is granted.
    }
  }, []);

  useEffect(() => {
    let active = true;
    void getPipelineHealth()
      .then((health) => {
        if (!active) return;
        if (health.cortiConfigured) {
          setState("idle");
          setMessage("Ready for a consented ward-round capture");
        } else {
          setState("unavailable");
          setMessage("Pipeline is running, but Corti credentials are not configured");
        }
      })
      .catch(() => {
        if (!active) return;
        setState("unavailable");
        setMessage("Pipeline unavailable · start the Corti service on port 8787");
      });
    void refreshDevices();
    const onDeviceChange = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener("devicechange", onDeviceChange);
    return () => {
      active = false;
      navigator.mediaDevices?.removeEventListener("devicechange", onDeviceChange);
      if (captureRef.current !== null) {
        void captureRef.current.stop().catch(() => undefined);
      }
    };
  }, [refreshDevices]);

  useEffect(() => {
    if (captureRef.current !== null) {
      void captureRef.current.stop().catch(() => undefined);
    }
    captureRef.current = null;
    correlationIdRef.current = crypto.randomUUID();
    setSegments([]);
    setCandidateViews([]);
    setAudioMessage("Audio not checked");
    setState((current) => (current === "unavailable" ? current : "idle"));
    setMessage("Ready for a consented ward-round capture");
  }, [patient.id]);

  const onPipelineEvent = (event: PipelineEvent) => {
    switch (event.type) {
      case "ambient.started":
        setState("recording");
        setMessage("Listening · transcript remains evidence, not authorization");
        break;
      case "transcript.interim":
      case "transcript.final":
        setSegments(event.payload.segments);
        break;
      case "audio.quality_changed":
        if (event.payload.product !== "ambient") return;
        if (event.payload.state === "speech-quality-issue") {
          setAudioMessage("Audio unclear · move the microphone closer");
        } else if (event.payload.state === "speech-quality-recovered") {
          setAudioMessage("Audio clear again");
        } else if (event.payload.state === "long-silence") {
          setAudioMessage("No speech detected");
        } else {
          setAudioMessage("Listening");
        }
        break;
      case "pipeline.error":
        setState("error");
        setMessage(event.payload.message);
        break;
      default:
        break;
    }
  };

  const start = async () => {
    correlationIdRef.current = crypto.randomUUID();
    const correlationId = correlationIdRef.current;
    setState("starting");
    setMessage("Creating a scoped Corti interaction…");
    setSegments([]);
    setCandidateViews([]);
    setAudioMessage("Checking audio…");
    try {
      const session = await createAmbientSession(
        `${patient.pipelinePatientId}-${Date.now()}`,
        correlationId,
      );
      const capture = new AmbientCapture({
        session,
        correlationId,
        refreshToken: () => refreshAmbientToken(correlationId),
        keyterms: [patient.name, "blood pressure", "district nursing", "medication change"],
        ...(deviceId.length > 0 ? { audioDeviceId: deviceId } : {}),
        onEvent: onPipelineEvent,
      });
      captureRef.current = capture;
      await capture.start();
      await refreshDevices();
    } catch (error) {
      captureRef.current = null;
      setState("error");
      setMessage(microphoneMessage(error));
      setAudioMessage("Audio unavailable");
    }
  };

  const updateCandidate = (
    candidateId: string,
    update: Pick<CandidateView, "state" | "message">,
  ) => {
    setCandidateViews((current) =>
      current.map((view) =>
        view.candidate.candidateId === candidateId ? { ...view, ...update } : view,
      ),
    );
  };

  const stopAndAnalyse = async () => {
    const capture = captureRef.current;
    if (capture === null) return;
    setState("stopping");
    setMessage("Finishing the final words…");
    try {
      await capture.stop();
      const finalSegments = capture.segments.filter((segment) => segment.isFinal);
      captureRef.current = null;
      setSegments([...capture.segments]);
      setState("analysing");
      setMessage("Checking exact evidence for conservative follow-through candidates…");
      const interactionId = finalSegments[0]?.interactionId;
      if (interactionId === undefined) {
        throw new Error("No final transcript was available for candidate analysis.");
      }
      const generated = await generateCandidates({
        patientId: patient.pipelinePatientId,
        interactionId,
        correlationId: correlationIdRef.current,
        segments: finalSegments,
      });
      setCandidateViews(
        generated.candidates.map((candidate) => ({
          candidate,
          state: "checking" as const,
          message: "Checking the record and open work…",
        })),
      );
      setState("complete");
      if (generated.candidates.length === 0) {
        setMessage(
          generated.rejectedAudioQualityCount > 0
            ? "No item promoted · relevant evidence overlapped unclear audio"
            : "No evidence-backed follow-through item detected",
        );
        return;
      }
      setMessage(
        `${generated.candidates.length} evidence-backed candidate${generated.candidates.length === 1 ? "" : "s"} sent for context checks`,
      );
      await Promise.allSettled(
        generated.candidates.map(async (candidate) => {
          try {
            await investigateCandidate(candidate);
            updateCandidate(candidate.candidateId, {
              state: "sent",
              message: "Context check requested · no task has been created yet",
            });
          } catch {
            updateCandidate(candidate.candidateId, {
              state: "failed",
              message: "Context check unavailable · candidate retained without action",
            });
          }
        }),
      );
    } catch (error) {
      captureRef.current = null;
      setState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Capture ended, but candidate analysis failed safely.",
      );
    }
  };

  const busy = ["starting", "stopping", "analysing"].includes(state);
  const finalSegments = segments.filter((segment) => segment.isFinal);

  return (
    <section className="rounded-xl border border-border bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div>
          <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
            <Mic className="size-3.5 text-teal" />
            Corti Ambient
            {state === "recording" && (
              <span className="flex items-center gap-1 text-[12px] font-normal text-muted-foreground">
                <span className="size-1.5 animate-pulse rounded-full bg-teal" />
                recording
              </span>
            )}
          </span>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">{message}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={deviceId}
            onChange={(event) => setDeviceId(event.target.value)}
            disabled={state === "recording" || busy}
            aria-label="Ambient microphone"
            className="max-w-36 rounded-md border border-border bg-panel px-2 py-1.5 text-[11.5px] text-muted-foreground"
          >
            <option value="">Default microphone</option>
            {devices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone ${index + 1}`}
              </option>
            ))}
          </select>
          {state === "recording" ? (
            <button
              onClick={() => void stopAndAnalyse()}
              className="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-[12.5px] font-medium text-background"
            >
              <Square className="size-3" /> Stop and check
            </button>
          ) : (
            <button
              onClick={() => void start()}
              disabled={state === "checking" || state === "unavailable" || busy}
              className="flex items-center gap-1.5 rounded-md bg-teal px-3 py-1.5 text-[12.5px] font-medium text-panel disabled:cursor-not-allowed disabled:opacity-45"
            >
              {busy ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Radio className="size-3.5" />
              )}
              Start capture
            </button>
          )}
        </div>
      </header>

      <div className="border-b border-border px-4 py-2 text-[11.5px] text-muted-foreground">
        <span
          className={
            audioMessage.startsWith("Audio unclear") ? "font-medium text-escalated-strong" : ""
          }
        >
          {audioMessage}
        </span>
        <span className="px-2">·</span>
        <span>{finalSegments.length} final transcript segments</span>
      </div>

      {segments.length > 0 && (
        <div className="max-h-40 space-y-1.5 overflow-y-auto px-4 py-3">
          {segments.map((segment) => (
            <p key={segment.segmentKey} className="text-[13px] leading-snug text-foreground">
              <span className="mr-2 text-[11.5px] tabular-nums text-muted-foreground">
                {timeLabel(segment.startSeconds)}
              </span>
              {segment.text}
              {!segment.isFinal && (
                <span className="ml-2 text-[11px] text-muted-foreground">listening…</span>
              )}
              {segment.audioQuality === "uncertain" && (
                <span className="ml-2 text-[11px] font-medium text-escalated-strong">
                  audio uncertain
                </span>
              )}
            </p>
          ))}
        </div>
      )}

      {candidateViews.length > 0 && (
        <div className="space-y-2 border-t border-border px-4 py-3">
          {candidateViews.map(({ candidate, state: candidateState, message }) => (
            <article key={candidate.candidateId} className="rounded-lg bg-background p-3">
              <div className="flex items-start gap-2.5">
                {candidateState === "checking" ? (
                  <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin text-teal" />
                ) : candidateState === "failed" ? (
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-escalated-strong" />
                ) : (
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-pending" />
                )}
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium text-foreground">{candidate.summary}</p>
                  <blockquote className="mt-1 border-l-2 border-teal/30 pl-2 text-[12.5px] italic text-muted-foreground">
                    “{candidate.evidence[0]?.sourceQuote}”
                  </blockquote>
                  <p className="mt-1.5 text-[11.5px] text-muted-foreground">{message}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <footer className="border-t border-border px-4 py-2.5 text-[11.5px] text-muted-foreground">
        Ambient evidence may suggest a candidate. Only an authenticated clinician approval can
        create tracked work.
      </footer>
    </section>
  );
}
