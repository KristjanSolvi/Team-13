import "@corti/dictation-web";

import {
  CortiDictation,
  type RecordingStateChangedEventDetail,
} from "@corti/dictation-web";

import {
  AmbientCapture,
  bindCortiDictation,
  getDictationToken,
  refreshAmbientToken,
  startAmbientSession,
} from "../src/browser/index.js";
import type {
  PipelineEvent,
  TaskRevisionPreview,
  TranscriptSegment,
} from "../src/contracts.js";
import { appendFinalTranscript, presentRevisionPatch } from "./presentation.js";
import "./styles.css";

type Tone = "neutral" | "active" | "success" | "error";

const isButton = (element: HTMLElement): element is HTMLButtonElement =>
  element instanceof HTMLButtonElement;

function requireElement<TElement extends HTMLElement>(
  id: string,
  guard: (element: HTMLElement) => element is TElement,
): TElement {
  const element = document.getElementById(id);
  if (element === null || !guard(element)) {
    throw new Error(`Required harness element #${id} is unavailable.`);
  }
  return element;
}

function requireHtmlElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Required harness element #${id} is unavailable.`);
  }
  return element;
}

function setStatus(element: HTMLElement, label: string, tone: Tone): void {
  element.textContent = label;
  element.dataset.tone = tone;
}

function setError(element: HTMLElement, message?: string): void {
  element.hidden = message === undefined;
  element.textContent = message ?? "";
}

function formatCredits(credits: number | null, active: boolean): string {
  if (credits !== null) {
    return credits.toFixed(4);
  }
  return active ? "pending…" : "—";
}

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function safeMicrophoneError(error: unknown, product: "Ambient" | "Dictation"): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Microphone access was denied. Allow it in the browser and macOS settings, then try again.";
    }
    if (error.name === "NotFoundError") {
      return "No microphone was found. Connect or enable an input device, then try again.";
    }
  }
  return `${product} could not start. Check that the pipeline is running, then retry.`;
}

interface HealthResponse {
  status: "ok";
  cortiConfigured: boolean;
}

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Pipeline request failed with status ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body: object): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return responseJson<T>(response);
}

const pipelineStatus = requireHtmlElement("pipeline-status");
const pipelineIndicator = requireHtmlElement("pipeline-indicator");

const ambientStart = requireElement("ambient-start", isButton);
const ambientStop = requireElement("ambient-stop", isButton);
const ambientReset = requireElement("ambient-reset", isButton);
const ambientStatus = requireHtmlElement("ambient-status");
const ambientCredits = requireHtmlElement("ambient-credits");
const ambientTranscript = requireHtmlElement("ambient-transcript");
const ambientSegmentCount = requireHtmlElement("ambient-segment-count");
const ambientError = requireHtmlElement("ambient-error");

const dictationStatus = requireHtmlElement("dictation-status");
const dictationCredits = requireHtmlElement("dictation-credits");
const dictationFinalElement = requireHtmlElement("dictation-final");
const dictationInterim = requireHtmlElement("dictation-interim");
const dictationClear = requireElement("dictation-clear", isButton);
const previewRevision = requireElement("preview-revision", isButton);
const revisionPreview = requireHtmlElement("revision-preview");
const dictationError = requireHtmlElement("dictation-error");

await customElements.whenDefined("corti-dictation");
const dictationCandidate = requireHtmlElement("dictation-control");
if (!(dictationCandidate instanceof CortiDictation)) {
  throw new Error("The Corti Dictation component did not register correctly.");
}
const dictationControl = dictationCandidate;

let ambientCapture: AmbientCapture | null = null;
let ambientCreditValue: number | null = null;
let ambientActive = false;
let finalDictation = "";
let dictationCreditValue: number | null = null;
let dictationActive = false;
let releaseDictation: (() => Promise<void>) | null = null;

function renderAmbientSegments(segments: TranscriptSegment[]): void {
  ambientTranscript.replaceChildren();
  if (segments.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Waiting for audio…";
    ambientTranscript.append(empty);
    ambientSegmentCount.textContent = "0 segments";
    return;
  }

  for (const segment of segments) {
    const row = document.createElement("article");
    row.className = "transcript-row";
    row.dataset.final = String(segment.isFinal);

    const meta = document.createElement("div");
    meta.className = "transcript-meta";

    const speaker = document.createElement("span");
    speaker.textContent =
      segment.speakerId === undefined ? "Speaker" : `Speaker ${segment.speakerId + 1}`;

    const timestamp = document.createElement("time");
    timestamp.textContent = formatSeconds(segment.startSeconds);

    const state = document.createElement("span");
    state.className = "transcript-state";
    state.textContent = segment.isFinal ? "Final" : "Listening";

    const copy = document.createElement("p");
    copy.textContent = segment.text;

    meta.append(speaker, timestamp, state);
    row.append(meta, copy);
    ambientTranscript.append(row);
  }

  const finalCount = segments.filter((segment) => segment.isFinal).length;
  ambientSegmentCount.textContent = `${finalCount} final · ${segments.length} total`;
  ambientTranscript.scrollTop = ambientTranscript.scrollHeight;
}

function handleAmbientEvent(event: PipelineEvent): void {
  switch (event.type) {
    case "ambient.started":
      ambientActive = true;
      setStatus(ambientStatus, "Recording", "active");
      ambientCredits.textContent = formatCredits(ambientCreditValue, true);
      break;
    case "transcript.interim":
    case "transcript.final":
      renderAmbientSegments(event.payload.segments);
      break;
    case "usage.updated":
      if (event.payload.product === "ambient") {
        ambientCreditValue = event.payload.creditsConsumed;
        ambientCredits.textContent = formatCredits(ambientCreditValue, ambientActive);
      }
      break;
    case "ambient.ended":
      ambientActive = false;
      setStatus(ambientStatus, "Ended cleanly", "success");
      ambientCredits.textContent = formatCredits(ambientCreditValue, false);
      break;
    case "pipeline.error":
      setError(ambientError, event.payload.message);
      setStatus(ambientStatus, "Error", "error");
      break;
    default:
      break;
  }
}

async function startAmbient(): Promise<void> {
  setError(ambientError);
  setStatus(ambientStatus, "Connecting", "active");
  ambientCreditValue = null;
  ambientCredits.textContent = formatCredits(null, true);
  ambientStart.disabled = true;
  ambientStop.disabled = true;
  renderAmbientSegments([]);

  try {
    const session = await startAmbientSession(
      window.location.origin,
      `karen-mic-lab-${Date.now()}`,
    );
    ambientCapture = new AmbientCapture({
      session,
      correlationId: crypto.randomUUID(),
      refreshToken: () => refreshAmbientToken(window.location.origin),
      onEvent: handleAmbientEvent,
    });
    await ambientCapture.start();
    ambientStop.disabled = false;
  } catch (error) {
    ambientCapture = null;
    ambientActive = false;
    setStatus(ambientStatus, "Could not start", "error");
    setError(ambientError, safeMicrophoneError(error, "Ambient"));
    ambientStart.disabled = false;
  }
}

async function stopAmbient(): Promise<void> {
  if (ambientCapture === null) {
    return;
  }

  ambientStop.disabled = true;
  setStatus(ambientStatus, "Finishing final words", "active");
  try {
    await ambientCapture.stop();
  } catch (error) {
    setStatus(ambientStatus, "Could not stop cleanly", "error");
    setError(ambientError, safeMicrophoneError(error, "Ambient"));
  } finally {
    ambientCapture = null;
    ambientActive = false;
    ambientStart.disabled = false;
    ambientCredits.textContent = formatCredits(ambientCreditValue, false);
  }
}

async function resetAmbient(): Promise<void> {
  if (ambientCapture !== null) {
    await stopAmbient();
  }
  renderAmbientSegments([]);
  setError(ambientError);
  setStatus(ambientStatus, "Idle", "neutral");
  ambientStart.disabled = false;
  ambientStop.disabled = true;
}

function renderRevisionPreview(preview: TaskRevisionPreview): void {
  revisionPreview.replaceChildren();
  const fields = presentRevisionPatch(preview.draft.patch);

  if (fields.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No supported edit fields were detected. Try the suggested phrase.";
    revisionPreview.append(empty);
  } else {
    for (const field of fields) {
      const item = document.createElement("div");
      item.className = "preview-field";
      const label = document.createElement("span");
      label.textContent = field.label;
      const value = document.createElement("strong");
      value.textContent = field.value;
      item.append(label, value);
      revisionPreview.append(item);
    }
  }

  if (preview.draft.reason !== undefined) {
    const item = document.createElement("div");
    item.className = "preview-field wide";
    const label = document.createElement("span");
    label.textContent = "Reason";
    const value = document.createElement("strong");
    value.textContent = preview.draft.reason;
    item.append(label, value);
    revisionPreview.append(item);
  }

  const boundary = document.createElement("p");
  boundary.className = "preview-boundary";
  boundary.textContent = preview.requiresConfirmation
    ? "Preview only · explicit clinician confirmation is still required"
    : "Unexpected response: confirmation boundary missing";
  revisionPreview.append(boundary);
}

function handleDictationEvent(event: PipelineEvent): void {
  switch (event.type) {
    case "dictation.interim":
      dictationInterim.textContent = event.payload.text;
      dictationActive = true;
      dictationCredits.textContent = formatCredits(dictationCreditValue, true);
      break;
    case "dictation.final":
      finalDictation = appendFinalTranscript(finalDictation, event.payload.text);
      dictationFinalElement.textContent = finalDictation;
      dictationInterim.textContent = "";
      previewRevision.disabled = finalDictation.length === 0;
      break;
    case "usage.updated":
      if (event.payload.product === "dictation") {
        dictationCreditValue = event.payload.creditsConsumed;
        dictationCredits.textContent = formatCredits(
          dictationCreditValue,
          dictationActive,
        );
      }
      break;
    case "pipeline.error":
      setStatus(dictationStatus, "Error", "error");
      setError(dictationError, event.payload.message);
      break;
    default:
      break;
  }
}

function handleDictationState(event: Event): void {
  const detail = (event as CustomEvent<RecordingStateChangedEventDetail>).detail;
  switch (detail.state) {
    case "initializing":
      setStatus(dictationStatus, "Connecting", "active");
      break;
    case "recording":
      dictationActive = true;
      setStatus(dictationStatus, "Recording", "active");
      dictationCredits.textContent = formatCredits(dictationCreditValue, true);
      break;
    case "stopping":
      setStatus(dictationStatus, "Finishing final words", "active");
      break;
    case "stopped":
      dictationActive = false;
      setStatus(dictationStatus, "Ready", "success");
      dictationCredits.textContent = formatCredits(dictationCreditValue, false);
      break;
  }
}

async function setupDictation(): Promise<void> {
  setError(dictationError);
  setStatus(dictationStatus, "Preparing", "active");
  dictationControl.style.pointerEvents = "none";
  dictationControl.style.opacity = "0.55";

  try {
    const token = await getDictationToken(window.location.origin);
    dictationControl.settingsEnabled = ["device", "language"];
    dictationControl.allowButtonFocus = true;
    releaseDictation = bindCortiDictation({
      element: dictationControl,
      token,
      refreshToken: () => getDictationToken(window.location.origin),
      primaryLanguage: "en",
      correlationId: crypto.randomUUID(),
      onEvent: handleDictationEvent,
    });
    dictationControl.addEventListener("recording-state-changed", handleDictationState);
    dictationControl.style.pointerEvents = "auto";
    dictationControl.style.opacity = "1";
    setStatus(dictationStatus, "Ready", "success");
  } catch (error) {
    setStatus(dictationStatus, "Unavailable", "error");
    setError(dictationError, safeMicrophoneError(error, "Dictation"));
  }
}

async function buildRevisionPreview(): Promise<void> {
  if (finalDictation.length === 0) {
    return;
  }

  previewRevision.disabled = true;
  previewRevision.textContent = "Building…";
  setError(dictationError);
  try {
    const preview = await postJson<TaskRevisionPreview>(
      "/api/corti/dictation/revision-preview",
      {
        taskId: "task-karen-bp",
        transcript: finalDictation,
        recipientTeams: [
          {
            id: "district-nursing",
            label: "District Nursing Team",
            aliases: ["district nursing"],
          },
          { id: "gp-practice", label: "GP Practice", aliases: ["GP"] },
        ],
        owners: [
          { id: "nurse-anna", label: "Anna Jensen", aliases: ["Anna"] },
          { id: "dr-larsen", label: "Dr Larsen", aliases: ["Larsen"] },
        ],
      },
    );
    renderRevisionPreview(preview);
  } catch {
    setError(
      dictationError,
      "The revision preview could not be built. Your dictated text was not applied.",
    );
  } finally {
    previewRevision.disabled = finalDictation.length === 0;
    previewRevision.textContent = "Build preview";
  }
}

function clearDictation(): void {
  finalDictation = "";
  dictationFinalElement.textContent =
    "Final words will appear here. Interim words appear below while speaking.";
  dictationInterim.textContent = "";
  revisionPreview.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "empty-state";
  empty.textContent = "Nothing is applied until a clinician confirms it.";
  revisionPreview.append(empty);
  previewRevision.disabled = true;
  setError(dictationError);
}

async function checkPipeline(): Promise<void> {
  try {
    const health = await responseJson<HealthResponse>(await fetch("/health"));
    if (health.status === "ok" && health.cortiConfigured) {
      pipelineStatus.textContent = "Pipeline live · Corti configured";
      pipelineIndicator.dataset.tone = "success";
      return;
    }
    pipelineStatus.textContent = "Pipeline live · credentials missing";
    pipelineIndicator.dataset.tone = "error";
  } catch {
    pipelineStatus.textContent = "Pipeline offline · start npm run dev";
    pipelineIndicator.dataset.tone = "error";
  }
}

ambientStart.addEventListener("click", () => void startAmbient());
ambientStop.addEventListener("click", () => void stopAmbient());
ambientReset.addEventListener("click", () => void resetAmbient());
previewRevision.addEventListener("click", () => void buildRevisionPreview());
dictationClear.addEventListener("click", clearDictation);

window.addEventListener("pagehide", () => {
  if (ambientCapture !== null) {
    void ambientCapture.stop();
  }
  if (releaseDictation !== null) {
    void releaseDictation();
  }
});

await Promise.all([checkPipeline(), setupDictation()]);
