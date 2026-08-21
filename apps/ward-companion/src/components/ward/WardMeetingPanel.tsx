import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert, LoaderCircle, Mic, RotateCcw, Square } from "lucide-react";
import { AmbientCapture } from "@pipeline/browser/ambient.js";
import { transcriptSpeakerLabels } from "@pipeline/browser/speakers.js";
import type { PipelineEvent, TranscriptSegment } from "@pipeline/contracts.js";

import { recordCortiActivity } from "@/lib/corti-activity";
import { wardMeetingEncounterIdentifier } from "@/lib/ward-meeting";
import {
  appendWardMeetingTranscript,
  closeAndReconcileWardMeetingSegment,
  completeWardMeeting,
  demoActors,
  FollowThroughApiError,
  openWardMeetingSegment,
  refreshAmbientToken,
  startWardMeeting,
  type PatientMeetingSegment,
  type WardMeeting,
  type WardMeetingReconciliationResult,
} from "@/lib/follow-through-api";

type MeetingState =
  | "idle"
  | "starting"
  | "recording"
  | "stopping"
  | "reconciling"
  | "reconciled"
  | "completing"
  | "completed"
  | "error";

type Props = {
  patientId: string;
  patientName: string;
  onAuthoritativeChange: () => Promise<void>;
};

function commandKeys() {
  return {
    start: `ward-meeting-start-${crypto.randomUUID()}`,
    open: `ward-meeting-open-${crypto.randomUUID()}`,
    transcript: `ward-meeting-transcript-${crypto.randomUUID()}`,
    close: `ward-meeting-close-${crypto.randomUUID()}`,
    complete: `ward-meeting-complete-${crypto.randomUUID()}`,
  };
}

function displayError(error: unknown): string {
  if (error instanceof FollowThroughApiError) {
    return `${error.message}${error.retryable ? " · safe to retry" : ""}`;
  }
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone access was denied. Allow it in Chrome and macOS settings, then retry.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No microphone was found. Connect or enable an input device, then retry.";
  }
  return error instanceof Error ? error.message : "The ward-meeting flow failed safely.";
}

function statusLabel(state: MeetingState): string {
  switch (state) {
    case "starting":
      return "Starting";
    case "recording":
      return "Listening";
    case "stopping":
      return "Finalising speech";
    case "reconciling":
      return "Agent checking context";
    case "reconciled":
      return "Clinician review";
    case "completing":
      return "Closing meeting";
    case "completed":
      return "Meeting closed";
    case "error":
      return "Needs attention";
    default:
      return "Ready";
  }
}

export function WardMeetingPanel({ patientId, patientName, onAuthoritativeChange }: Props) {
  const [state, setState] = useState<MeetingState>("idle");
  const [meeting, setMeeting] = useState<WardMeeting | null>(null);
  const [patientSegment, setPatientSegment] = useState<PatientMeetingSegment | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [audioMessage, setAudioMessage] = useState("Audio not checked");
  const [message, setMessage] = useState(
    `Open a patient-scoped segment for ${patientName}, then let Corti Ambient capture it live.`,
  );
  const [result, setResult] = useState<WardMeetingReconciliationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const captureRef = useRef<AmbientCapture | null>(null);
  const meetingRef = useRef<WardMeeting | null>(null);
  const patientSegmentRef = useRef<PatientMeetingSegment | null>(null);
  const pendingFinalSegmentsRef = useRef<TranscriptSegment[] | null>(null);
  const keysRef = useRef(commandKeys());
  const correlationIdRef = useRef(crypto.randomUUID());

  const speakerLabels = useMemo(() => transcriptSpeakerLabels(segments), [segments]);
  const finalSegments = useMemo(() => segments.filter((segment) => segment.isFinal), [segments]);

  useEffect(
    () => () => {
      if (captureRef.current !== null) {
        void captureRef.current.stop().catch(() => undefined);
      }
    },
    [],
  );

  const updateMeeting = (next: WardMeeting) => {
    meetingRef.current = next;
    setMeeting(next);
  };

  const updatePatientSegment = (next: PatientMeetingSegment) => {
    patientSegmentRef.current = next;
    setPatientSegment(next);
  };

  const onPipelineEvent = (event: PipelineEvent) => {
    switch (event.type) {
      case "ambient.started":
        setState("recording");
        setMessage(`Listening to ${patientName}'s ward-round segment.`);
        setAudioMessage("Listening");
        recordCortiActivity({
          product: "ambient",
          status: "active",
          action: "Patient-scoped ward meeting capture started",
        });
        break;
      case "transcript.interim":
      case "transcript.final":
        setSegments(event.payload.segments);
        break;
      case "facts.updated":
        if (event.payload.facts.length > 0) {
          recordCortiActivity({
            product: "factsr",
            status: "completed",
            action: `${event.payload.facts.length} ward-meeting fact${event.payload.facts.length === 1 ? "" : "s"} structured`,
          });
        }
        break;
      case "audio.quality_changed":
        if (event.payload.product !== "ambient") return;
        setAudioMessage(
          event.payload.state === "speech-quality-issue"
            ? "Audio unclear · move the microphone closer"
            : event.payload.state === "speech-quality-recovered"
              ? "Audio clear again"
              : event.payload.state === "long-silence"
                ? "No speech detected"
                : "Listening",
        );
        break;
      case "usage.updated":
        if (event.payload.product === "ambient") {
          recordCortiActivity({
            product: "ambient",
            status: "active",
            action: "Ward-meeting transcript streaming",
            credits: event.payload.creditsConsumed,
          });
        }
        break;
      case "ambient.ended":
        recordCortiActivity({
          product: "ambient",
          status: "completed",
          action: "Ward-meeting transcript finalised",
          ...(event.payload.creditsConsumed === undefined
            ? {}
            : { credits: event.payload.creditsConsumed }),
        });
        break;
      case "pipeline.error":
        setState("error");
        setError(event.payload.message);
        break;
      default:
        break;
    }
  };

  const start = async () => {
    setState("starting");
    setError(null);
    setResult(null);
    setSegments([]);
    setAudioMessage("Checking audio…");
    setMessage("Creating one scoped Corti interaction and meeting ledger…");
    const correlationId = crypto.randomUUID();
    correlationIdRef.current = correlationId;
    try {
      const started = await startWardMeeting({
        wardId: "north-wing-l4",
        // Corti encounter identifiers are unique. The previous patient-only value
        // collided as soon as someone reconciled the same patient a second time.
        encounterIdentifier: wardMeetingEncounterIdentifier(correlationId),
        idempotencyKey: keysRef.current.start,
        actorId: demoActors.clinician,
        correlationId,
      });
      updateMeeting(started.meeting);
      const opened = await openWardMeetingSegment({
        meetingId: started.meeting.meetingId,
        patientId,
        expectedMeetingVersion: started.meeting.version,
        idempotencyKey: keysRef.current.open,
        actorId: demoActors.clinician,
        correlationId,
      });
      updateMeeting(opened.meeting);
      updatePatientSegment(opened.segment);
      const capture = new AmbientCapture({
        session: started.ambientSession,
        correlationId,
        refreshToken: () => refreshAmbientToken(correlationId),
        keyterms: [patientName, "follow-up", "owner", "deadline", "discharge"],
        onEvent: onPipelineEvent,
      });
      captureRef.current = capture;
      await capture.start();
    } catch (caught) {
      captureRef.current = null;
      setState("error");
      setError(displayError(caught));
      setAudioMessage("Audio unavailable");
    }
  };

  const reconcile = async (finalTranscript: TranscriptSegment[]) => {
    const currentMeeting = meetingRef.current;
    const currentSegment = patientSegmentRef.current;
    if (currentMeeting === null || currentSegment === null) {
      setState("error");
      setError("The patient-scoped meeting segment is unavailable; no reconciliation was run.");
      return;
    }
    setState("reconciling");
    setError(null);
    setMessage(
      "Corti Agentic is comparing the final words with the record and open work through MCP.",
    );
    try {
      await appendWardMeetingTranscript({
        meetingId: currentMeeting.meetingId,
        patientSegmentId: currentSegment.segmentId,
        segments: finalTranscript,
        idempotencyKey: keysRef.current.transcript,
        actorId: demoActors.clinician,
        correlationId: correlationIdRef.current,
      });
      const reconciled = await closeAndReconcileWardMeetingSegment({
        meetingId: currentMeeting.meetingId,
        segmentId: currentSegment.segmentId,
        expectedMeetingVersion: currentMeeting.version,
        expectedSegmentVersion: currentSegment.version,
        idempotencyKey: keysRef.current.close,
        actorId: demoActors.clinician,
        correlationId: correlationIdRef.current,
      });
      updateMeeting(reconciled.meeting);
      updatePatientSegment(reconciled.segment);
      setResult(reconciled);
      setState("reconciled");
      setMessage("Reconciliation saved. New work remains a draft until a clinician approves it.");
      recordCortiActivity({
        product: "agentic",
        status: "completed",
        action: "Ward-meeting segment reconciled through scoped MCP",
      });
      await onAuthoritativeChange();
    } catch (caught) {
      setState("error");
      setError(displayError(caught));
    }
  };

  const stopAndReconcile = async () => {
    const capture = captureRef.current;
    if (capture === null) return;
    setState("stopping");
    setError(null);
    setMessage("Finalising the last words before the agent sees anything…");
    try {
      await capture.stop();
      captureRef.current = null;
      const completedSegments = capture.segments.filter((segment) => segment.isFinal);
      setSegments([...capture.segments]);
      if (completedSegments.length === 0) {
        throw new Error("No final speech was captured. The meeting stayed open and no agent ran.");
      }
      pendingFinalSegmentsRef.current = completedSegments;
      await reconcile(completedSegments);
    } catch (caught) {
      captureRef.current = null;
      setState("error");
      setError(displayError(caught));
    }
  };

  const finishMeeting = async () => {
    const currentMeeting = meetingRef.current;
    if (currentMeeting === null) return;
    setState("completing");
    setError(null);
    try {
      const completed = await completeWardMeeting({
        meetingId: currentMeeting.meetingId,
        expectedMeetingVersion: currentMeeting.version,
        idempotencyKey: keysRef.current.complete,
        actorId: demoActors.clinician,
        correlationId: correlationIdRef.current,
      });
      updateMeeting(completed.meeting);
      setState("completed");
      setMessage("Meeting closed with an attributable reconciliation receipt.");
    } catch (caught) {
      setState("error");
      setError(displayError(caught));
    }
  };

  const reset = () => {
    keysRef.current = commandKeys();
    correlationIdRef.current = crypto.randomUUID();
    captureRef.current = null;
    meetingRef.current = null;
    patientSegmentRef.current = null;
    pendingFinalSegmentsRef.current = null;
    setMeeting(null);
    setPatientSegment(null);
    setSegments([]);
    setResult(null);
    setError(null);
    setAudioMessage("Audio not checked");
    setMessage(
      `Open a patient-scoped segment for ${patientName}, then let Corti Ambient capture it live.`,
    );
    setState("idle");
  };

  const busy = ["starting", "stopping", "reconciling", "completing"].includes(state);
  const canRetryReconciliation =
    state === "error" &&
    pendingFinalSegmentsRef.current !== null &&
    meetingRef.current !== null &&
    patientSegmentRef.current !== null;

  return (
    <section className="rounded-2xl border border-border bg-panel">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-3.5">
        <div>
          <h2 className="flex items-center gap-2 text-[14px] font-medium text-foreground">
            <Mic className="size-4 text-teal" /> Reconcile existing work
          </h2>
          <p className="mt-0.5 max-w-2xl text-[11.5px] leading-relaxed text-muted-foreground">
            Use after a ward-round or handover update. Corti compares the final discussion with
            existing tasks, revises changed work, drafts missing commitments, and carries unresolved
            work forward. For a new bedside conversation, use Corti Ambient above.
          </p>
        </div>
        <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[10.5px] font-medium text-foreground">
          {statusLabel(state)}
        </span>
      </header>

      <div className="grid gap-px bg-border lg:grid-cols-[1fr_220px]">
        <div className="bg-panel px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Patient segment
              </p>
              <p className="mt-0.5 text-[13px] font-medium text-foreground">{patientName}</p>
              <p className="mt-0.5 text-[10.5px] text-muted-foreground">{message}</p>
            </div>
            {state === "idle" && (
              <button
                type="button"
                onClick={() => void start()}
                className="flex items-center gap-1.5 rounded-md bg-teal px-3.5 py-2 text-[12px] font-medium text-panel"
              >
                <Mic className="size-3.5" /> Start reconciliation capture
              </button>
            )}
            {state === "recording" && (
              <button
                type="button"
                onClick={() => void stopAndReconcile()}
                className="flex items-center gap-1.5 rounded-md bg-foreground px-3.5 py-2 text-[12px] font-medium text-background"
              >
                <Square className="size-3" /> Stop and reconcile
              </button>
            )}
            {busy && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin" /> {statusLabel(state)}
              </span>
            )}
          </div>

          {(state === "recording" || segments.length > 0) && (
            <div className="mt-3 rounded-xl border border-border bg-background p-3">
              <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                <span>{audioMessage}</span>
                <span>
                  {finalSegments.length} final segment{finalSegments.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="mt-2 max-h-32 space-y-1.5 overflow-y-auto">
                {segments.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    Listening for Doctor and Patient…
                  </p>
                ) : (
                  segments.map((segment) => (
                    <p
                      key={segment.segmentKey}
                      className="text-[11.5px] leading-relaxed text-foreground"
                    >
                      <span className="mr-1.5 font-medium text-teal">
                        {segment.speakerId === undefined
                          ? "Speaker"
                          : (speakerLabels.get(segment.speakerId) ?? "Speaker")}
                      </span>
                      <span className={segment.isFinal ? "" : "text-muted-foreground"}>
                        {segment.text}
                      </span>
                    </p>
                  ))
                )}
              </div>
            </div>
          )}

          {result !== null && (
            <div className="mt-3 rounded-xl border border-teal/20 bg-teal/5 p-3">
              <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-foreground">
                <Check className="size-3.5 text-verified-strong" /> Agent reconciliation saved
              </p>
              <p className="mt-1 text-[10.5px] text-muted-foreground">
                {result.newDraftTasks.length} draft task
                {result.newDraftTasks.length === 1 ? "" : "s"}
                {" ready for review"}
                {" · "}
                {result.carryForwards.length} unresolved item
                {result.carryForwards.length === 1 ? "" : "s"} carried forward
              </p>
              {result.newDraftTasks.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {result.newDraftTasks.map((task) => (
                    <li key={task.taskId} className="text-[10.5px] text-foreground">
                      Review · {task.summary}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error !== null && (
            <p
              role="alert"
              className="mt-3 flex items-start gap-1.5 text-[11px] text-escalated-strong"
            >
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {error}
            </p>
          )}
        </div>

        <aside className="bg-panel px-4 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Safety boundary
          </p>
          <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
            Interim or unclear speech cannot become eligible evidence. Reconciliation creates draft
            work only; clinician approval remains a separate step in Main.
          </p>
          {meeting !== null && (
            <p className="mt-3 text-[10px] text-muted-foreground">
              Meeting {meeting.status} · v{meeting.version}
              {patientSegment === null ? "" : ` · segment ${patientSegment.status}`}
            </p>
          )}
          {state === "reconciled" && (
            <button
              type="button"
              onClick={() => void finishMeeting()}
              className="mt-3 w-full rounded-md border border-border px-3 py-2 text-[11px] font-medium text-foreground"
            >
              Complete meeting
            </button>
          )}
          {canRetryReconciliation && (
            <button
              type="button"
              onClick={() => void reconcile(pendingFinalSegmentsRef.current!)}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-[11px] font-medium text-foreground"
            >
              <RotateCcw className="size-3" /> Retry safely
            </button>
          )}
          {(state === "completed" || (state === "error" && !canRetryReconciliation)) && (
            <button
              type="button"
              onClick={reset}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 text-[11px] font-medium text-foreground"
            >
              <RotateCcw className="size-3" /> Start another
            </button>
          )}
        </aside>
      </div>
    </section>
  );
}
