import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, LoaderCircle, Mic, Radio, Square } from "lucide-react";
import { AmbientCapture } from "@pipeline/browser/ambient.js";
import type {
  FollowThroughCandidate,
  PipelineEvent,
  TranscriptReviewSuggestion,
  TranscriptSegment,
  AmbientFact,
} from "@pipeline/contracts.js";
import {
  buildReviewedTranscript,
  type TranscriptReviewDecision,
} from "@pipeline/transcript-interpretation.js";
import type { Patient } from "@/data/ward";
import { recordCortiActivity } from "@/lib/corti-activity";
import {
  createAmbientSession,
  generateCandidates,
  getIntegrationReadiness,
  investigateCandidate,
  refreshAmbientToken,
  reviewTranscript,
} from "@/lib/follow-through-api";
import { LiveInterimText } from "./LiveInterimText";
import { TranscriptReviewPanel } from "./TranscriptReviewPanel";

type CaptureState =
  | "checking"
  | "unavailable"
  | "idle"
  | "starting"
  | "recording"
  | "stopping"
  | "awaiting-review"
  | "analysing"
  | "complete"
  | "error";

type InvestigationState = "checking" | "sent" | "failed";
type TranscriptReviewState = "idle" | "reviewing" | "complete" | "confirmed" | "unavailable";
type CandidateGenerationResult = Awaited<ReturnType<typeof generateCandidates>>;

type CandidateView = {
  candidate: FollowThroughCandidate;
  state: InvestigationState;
  message: string;
  agentCredits: number | null;
};

type Props = {
  patient: Patient;
  onAuthoritativeChange: () => Promise<void>;
};

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function agentHandoffSummary(handoff: unknown): {
  completed: boolean;
  retained: boolean;
  credits: number | null;
} {
  const value = asRecord(handoff);
  return {
    completed: value?.["agentState"] === "completed",
    retained: value?.["status"] === "retained",
    credits: typeof value?.["credits"] === "number" ? value["credits"] : null,
  };
}

function creditsLabel(credits: number): string {
  return `${credits.toFixed(4)} credits`;
}

export function LiveStrip({ patient, onAuthoritativeChange }: Props) {
  const [state, setState] = useState<CaptureState>("checking");
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [facts, setFacts] = useState<AmbientFact[]>([]);
  const [candidateViews, setCandidateViews] = useState<CandidateView[]>([]);
  const [message, setMessage] = useState("Checking the Corti pipeline…");
  const [audioMessage, setAudioMessage] = useState("Audio not checked");
  const [ambientCredits, setAmbientCredits] = useState<number | null>(null);
  const [generationCredits, setGenerationCredits] = useState<number | null>(null);
  const [reviewCredits, setReviewCredits] = useState<number | null>(null);
  const [reviewState, setReviewState] = useState<TranscriptReviewState>("idle");
  const [reviewSuggestions, setReviewSuggestions] = useState<TranscriptReviewSuggestion[]>([]);
  const [reviewDecisions, setReviewDecisions] = useState<Record<string, TranscriptReviewDecision>>(
    {},
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const captureRef = useRef<AmbientCapture | null>(null);
  const pendingFinalSegmentsRef = useRef<TranscriptSegment[] | null>(null);
  const pendingGenerationRef = useRef<Promise<CandidateGenerationResult> | null>(null);
  const correlationIdRef = useRef(crypto.randomUUID());
  const recordingStartedAtRef = useRef<number | null>(null);
  const liveCortiReadyRef = useRef<boolean | null>(null);
  const readyMessageRef = useRef("Checking the Corti pipeline…");

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
    void getIntegrationReadiness()
      .then((readiness) => {
        if (!active) return;
        liveCortiReadyRef.current = readiness.liveCortiReady;
        if (readiness.liveCortiReady) {
          const readyMessage =
            readiness.status === "ready"
              ? "Live Corti capture ready"
              : "Live Corti capture ready · another service is degraded";
          readyMessageRef.current = readyMessage;
          setState("idle");
          setMessage(readyMessage);
        } else {
          readyMessageRef.current =
            "Live Corti unavailable · check the pipeline credentials and services";
          setState("unavailable");
          setMessage(readyMessageRef.current);
        }
      })
      .catch(() => {
        if (!active) return;
        liveCortiReadyRef.current = false;
        readyMessageRef.current = "Integration service unavailable · start it on port 8790";
        setState("unavailable");
        setMessage(readyMessageRef.current);
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
    pendingFinalSegmentsRef.current = null;
    pendingGenerationRef.current = null;
    correlationIdRef.current = crypto.randomUUID();
    setSegments([]);
    setFacts([]);
    setCandidateViews([]);
    setAmbientCredits(null);
    setGenerationCredits(null);
    setReviewCredits(null);
    setReviewState("idle");
    setReviewSuggestions([]);
    setReviewDecisions({});
    setElapsedSeconds(0);
    recordingStartedAtRef.current = null;
    setAudioMessage("Audio not checked");
    setState(
      liveCortiReadyRef.current === null
        ? "checking"
        : liveCortiReadyRef.current
          ? "idle"
          : "unavailable",
    );
    setMessage(readyMessageRef.current);
  }, [patient.id]);

  useEffect(() => {
    if (state !== "recording" || recordingStartedAtRef.current === null) return;
    const updateElapsed = () => {
      setElapsedSeconds(Math.floor((Date.now() - recordingStartedAtRef.current!) / 1_000));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(timer);
  }, [state]);

  const onPipelineEvent = (event: PipelineEvent) => {
    switch (event.type) {
      case "ambient.started":
        recordCortiActivity({
          product: "ambient",
          status: "active",
          action: "Live audio capture started",
        });
        recordingStartedAtRef.current = Date.now();
        setElapsedSeconds(0);
        setState("recording");
        setMessage("Listening live · shadow words are provisional until Corti finalises them");
        break;
      case "transcript.interim":
      case "transcript.final":
        setSegments(event.payload.segments);
        break;
      case "facts.updated":
        setFacts(event.payload.facts);
        if (event.payload.facts.length > 0) {
          recordCortiActivity({
            product: "factsr",
            status: "completed",
            action: `${event.payload.facts.length} structured fact${event.payload.facts.length === 1 ? "" : "s"} extracted live`,
          });
        }
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
      case "usage.updated":
        if (event.payload.product === "ambient") {
          setAmbientCredits(event.payload.creditsConsumed);
          recordCortiActivity({
            product: "ambient",
            status: "active",
            action: "Live transcript and audio quality streaming",
            credits: event.payload.creditsConsumed,
          });
        }
        break;
      case "ambient.ended":
        if (event.payload.creditsConsumed !== undefined) {
          setAmbientCredits(event.payload.creditsConsumed);
        }
        recordCortiActivity({
          product: "ambient",
          status: "completed",
          action: "Final transcript captured",
          ...(event.payload.creditsConsumed === undefined
            ? {}
            : { credits: event.payload.creditsConsumed }),
        });
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
    setFacts([]);
    setCandidateViews([]);
    setAmbientCredits(null);
    setGenerationCredits(null);
    setReviewCredits(null);
    setReviewState("idle");
    setReviewSuggestions([]);
    setReviewDecisions({});
    setElapsedSeconds(0);
    setAudioMessage("Checking audio…");
    pendingFinalSegmentsRef.current = null;
    pendingGenerationRef.current = null;
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
    update: Pick<CandidateView, "state" | "message"> & { agentCredits?: number | null },
  ) => {
    setCandidateViews((current) =>
      current.map((view) =>
        view.candidate.candidateId === candidateId ? { ...view, ...update } : view,
      ),
    );
  };

  const analyseFinalSegments = async (
    finalSegments: TranscriptSegment[],
    correlationId: string,
    generatedResult?: Promise<CandidateGenerationResult>,
  ) => {
    const interactionId = finalSegments[0]?.interactionId;
    if (interactionId === undefined) {
      throw new Error("No final transcript was available for candidate analysis.");
    }
    setState("analysing");
    setMessage("Checking conservative follow-through evidence…");
    const generated = await (generatedResult ??
      generateCandidates({
        patientId: patient.pipelinePatientId,
        interactionId,
        correlationId,
        segments: finalSegments,
      }));
    if (correlationIdRef.current !== correlationId) return;
    recordCortiActivity({
      product: "text-generation",
      status: "completed",
      action: "Evidence-grounded follow-through candidates generated",
      credits: generated.creditsConsumed,
    });
    pendingGenerationRef.current = null;
    setGenerationCredits(generated.creditsConsumed);
    setCandidateViews(
      generated.candidates.map((candidate) => ({
        candidate,
        state: "checking" as const,
        message: "Corti Agentic is checking the patient record, open threads, and eligible teams…",
        agentCredits: null,
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
    let investigationAccepted = false;
    await Promise.allSettled(
      generated.candidates.map(async (candidate) => {
        try {
          const result = await investigateCandidate(candidate);
          if (correlationIdRef.current !== correlationId) return;
          const handoff = agentHandoffSummary(result.handoff);
          recordCortiActivity({
            product: "agentic",
            status: "completed",
            action: "Patient context and open work checked through scoped MCP",
            ...(handoff.credits === null ? {} : { credits: handoff.credits }),
          });
          investigationAccepted = true;
          updateCandidate(candidate.candidateId, {
            state: "sent",
            message: handoff.completed
              ? "Corti Agentic completed the context check · any proposed work remains clinician-controlled"
              : handoff.retained
                ? "Signal retained with its evidence · no autonomous task was created"
                : "Context check accepted · no autonomous task was created",
            agentCredits: handoff.credits,
          });
        } catch {
          if (correlationIdRef.current !== correlationId) return;
          recordCortiActivity({
            product: "agentic",
            status: "unavailable",
            action: "Agentic/MCP context check unavailable; candidate retained safely",
          });
          updateCandidate(candidate.candidateId, {
            state: "failed",
            message: "Context check unavailable · candidate retained without action",
          });
        }
      }),
    );
    if (investigationAccepted && correlationIdRef.current === correlationId) {
      await onAuthoritativeChange();
    }
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
      setMessage("Reviewing final wording while checking conservative follow-through evidence…");
      const interactionId = finalSegments[0]?.interactionId;
      if (interactionId === undefined) {
        throw new Error("No final transcript was available for candidate analysis.");
      }
      const reviewCorrelationId = correlationIdRef.current;
      pendingFinalSegmentsRef.current = finalSegments;
      const generationPromise = generateCandidates({
        patientId: patient.pipelinePatientId,
        interactionId,
        correlationId: reviewCorrelationId,
        segments: finalSegments,
      });
      pendingGenerationRef.current = generationPromise;
      void generationPromise.catch(() => undefined);
      setReviewState("reviewing");
      try {
        const review = await reviewTranscript({
          interactionId,
          correlationId: reviewCorrelationId,
          segments: finalSegments,
          contextTerms: [
            patient.name,
            patient.todaySchedule ?? "",
            patient.waitingFor ?? "",
            "blood pressure",
            "district nursing",
            "medication change",
          ].filter((term) => term.length > 0),
          protectedTerms: [patient.name],
        });
        if (correlationIdRef.current !== reviewCorrelationId) return;
        setReviewSuggestions(review.suggestions);
        setReviewCredits(review.creditsConsumed);
        recordCortiActivity({
          product: "text-generation",
          status: "completed",
          action:
            review.suggestions.length === 0
              ? "Transcript wording reviewed; original retained"
              : `${review.suggestions.length} possible wording mismatch${review.suggestions.length === 1 ? "" : "es"} surfaced for confirmation`,
          credits: review.creditsConsumed,
        });
        if (review.suggestions.length > 0) {
          setReviewState("complete");
          setState("awaiting-review");
          setMessage("Confirm possible wording mismatches before follow-through analysis");
          return;
        }
        setReviewState("complete");
      } catch {
        if (correlationIdRef.current !== reviewCorrelationId) return;
        setReviewState("unavailable");
        recordCortiActivity({
          product: "text-generation",
          status: "unavailable",
          action: "Transcript review unavailable; raw wording retained",
        });
      }
      await analyseFinalSegments(finalSegments, reviewCorrelationId, generationPromise);
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

  const continueAfterReview = async () => {
    const rawSegments = pendingFinalSegmentsRef.current;
    if (rawSegments === null || reviewSuggestions.length === 0) return;
    const correlationId = correlationIdRef.current;
    try {
      const reviewed = buildReviewedTranscript(rawSegments, reviewSuggestions, reviewDecisions);
      setReviewState("confirmed");
      setMessage(
        reviewed.appliedSuggestionIds.length > 0
          ? "Using the clinician-confirmed interpretation for follow-through analysis · raw transcript preserved"
          : "Original wording confirmed · checking follow-through evidence",
      );
      const generationPromise =
        reviewed.appliedSuggestionIds.length === 0
          ? (pendingGenerationRef.current ?? undefined)
          : undefined;
      await analyseFinalSegments(reviewed.segments, correlationId, generationPromise);
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "The wording confirmation could not be applied safely.",
      );
    }
  };

  const busy = ["starting", "stopping", "analysing"].includes(state);
  const reviewPending = state === "awaiting-review";
  const finalSegments = segments.filter((segment) => segment.isFinal);
  const latestInterim = segments.filter((segment) => !segment.isFinal).at(-1);

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
                recording · {timeLabel(elapsedSeconds)}
              </span>
            )}
          </span>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">{message}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={deviceId}
            onChange={(event) => setDeviceId(event.target.value)}
            disabled={state === "recording" || busy || reviewPending}
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
              disabled={state === "checking" || state === "unavailable" || busy || reviewPending}
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
        {(state === "recording" || ambientCredits !== null) && (
          <>
            <span className="px-2">·</span>
            <span>
              Ambient usage: {ambientCredits === null ? "pending" : creditsLabel(ambientCredits)}
            </span>
          </>
        )}
        {generationCredits !== null && (
          <>
            <span className="px-2">·</span>
            <span>Text Generation · candidate extraction: {creditsLabel(generationCredits)}</span>
          </>
        )}
        {reviewState !== "idle" && (
          <>
            <span className="px-2">·</span>
            <span>
              Transcript review: {reviewState === "reviewing" && "reviewing wording…"}
              {reviewState === "unavailable" && "unavailable · original retained"}
              {reviewState === "complete" &&
                (reviewSuggestions.length === 0
                  ? "no changes suggested"
                  : `${reviewSuggestions.length} phrase${reviewSuggestions.length === 1 ? "" : "s"} to confirm`)}
              {reviewState === "confirmed" && "clinician-confirmed interpretation used downstream"}
              {(reviewState === "complete" || reviewState === "confirmed") && reviewCredits !== null
                ? ` · ${creditsLabel(reviewCredits)}`
                : ""}
            </span>
          </>
        )}
      </div>

      {(state === "recording" || segments.length > 0) && (
        <div className="max-h-52 space-y-2 overflow-y-auto px-4 py-3">
          {finalSegments.map((segment) => (
            <p
              key={segment.segmentKey}
              className="fade-in-view text-[13px] leading-snug text-foreground"
            >
              <span className="mr-2 text-[11.5px] tabular-nums text-muted-foreground">
                {timeLabel(segment.startSeconds)}
              </span>
              {segment.text}
              {segment.audioQuality === "uncertain" && (
                <span className="ml-2 text-[11px] font-medium text-escalated-strong">
                  audio uncertain
                </span>
              )}
            </p>
          ))}
          {latestInterim !== undefined ? (
            <LiveInterimText
              text={latestInterim.text}
              timestamp={timeLabel(latestInterim.startSeconds)}
            />
          ) : state === "recording" ? (
            <div
              role="status"
              className="rounded-lg border border-dashed border-teal/20 px-3 py-2.5"
            >
              <span className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                <span className="flex gap-1" aria-hidden="true">
                  <span className="size-1.5 animate-pulse rounded-full bg-teal/35" />
                  <span className="size-1.5 animate-pulse rounded-full bg-teal/55 [animation-delay:150ms]" />
                  <span className="size-1.5 animate-pulse rounded-full bg-teal/75 [animation-delay:300ms]" />
                </span>
                Listening for speech…
              </span>
            </div>
          ) : null}
        </div>
      )}

      <TranscriptReviewPanel
        suggestions={reviewSuggestions}
        decisions={reviewDecisions}
        onDecision={(suggestion, decision) =>
          setReviewDecisions((current) => ({
            ...current,
            [suggestion.suggestionId]: decision,
          }))
        }
        onContinue={() => void continueAfterReview()}
        continuing={state === "analysing" && reviewState === "confirmed"}
        confirmed={reviewState === "confirmed"}
      />

      {facts.length > 0 && (
        <div className="border-t border-border px-4 py-2.5">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Corti FactsR · structured facts heard live
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {facts.map((fact) => (
              <li
                key={fact.factId}
                className="fade-in-view flex items-center gap-1.5 rounded-full border border-teal/25 bg-teal/5 px-2.5 py-1 text-[11.5px] text-foreground"
              >
                <span className="rounded-full bg-teal/10 px-1.5 py-px text-[10px] uppercase tracking-wide text-teal">
                  {fact.group}
                </span>
                {fact.text}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[10.5px] text-muted-foreground">
            Facts are observations, not actions · only clinician approval creates tracked work.
          </p>
        </div>
      )}

      {candidateViews.length > 0 && (
        <div className="space-y-2 border-t border-border px-4 py-3">
          {candidateViews.map(({ candidate, state: candidateState, message, agentCredits }) => (
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
                  {agentCredits !== null && (
                    <p className="mt-0.5 text-[10.5px] text-muted-foreground">
                      Agentic usage: {creditsLabel(agentCredits)}
                    </p>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <footer className="border-t border-border px-4 py-2.5 text-[11.5px] text-muted-foreground">
        Ambient evidence may suggest a candidate. Only an attributed clinician approval can create
        tracked work.
      </footer>
    </section>
  );
}
