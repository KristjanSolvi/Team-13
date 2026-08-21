import { useEffect, useRef, useState } from "react";
import { ChevronDown, LoaderCircle, Mic2, Pencil, ShieldCheck } from "lucide-react";
import type { CortiDictation } from "@corti/dictation-web";
import type { PipelineEvent, TaskRevisionPreview } from "@pipeline/contracts.js";
import type { Thread } from "@/data/ward";
import { recordCortiActivity } from "@/lib/corti-activity";
import {
  buildDictationRevisionPreview,
  demoActors,
  executeTaskCommand,
  FollowThroughApiError,
  getDictationToken,
} from "@/lib/follow-through-api";
import type { TaskCorrectionPatch } from "@/lib/follow-through-api";
import { LiveInterimText } from "./LiveInterimText";

const recipientTeams = [
  { id: "ward-medical", label: "Ward Medical Team", aliases: ["ward medical", "doctors"] },
  { id: "ward-nursing", label: "Ward Nursing Team", aliases: ["ward nursing", "nurses"] },
  {
    id: "district-nursing",
    label: "District Nursing Team",
    aliases: ["district nursing", "district nurses"],
  },
  { id: "gp-practice", label: "GP Practice", aliases: ["GP", "general practice"] },
  { id: "radiology", label: "Radiology", aliases: ["radiology"] },
  { id: "therapy", label: "Therapy Team", aliases: ["physio", "therapy"] },
  { id: "pharmacy", label: "Pharmacy", aliases: ["pharmacy", "pharmacist"] },
  { id: "surgical-team", label: "Surgical Team", aliases: ["surgery", "surgeons"] },
];

function appendFinal(current: string, next: string): string {
  const clean = next.trim();
  if (clean.length === 0) return current;
  return current.length === 0 ? clean : `${current} ${clean}`;
}

function dueLabel(milliseconds: number): string {
  const hours = milliseconds / 3_600_000;
  return Number.isInteger(hours) ? `${hours} hours` : `${hours.toFixed(1)} hours`;
}

function previewFields(preview: TaskRevisionPreview) {
  const { patch } = preview.draft;
  return [
    patch.summary === undefined ? null : ["Action", patch.summary],
    patch.targetTeamId === undefined
      ? null
      : [
          "Receiving team",
          recipientTeams.find((team) => team.id === patch.targetTeamId)?.label ??
            patch.targetTeamId,
        ],
    patch.dueInMs === undefined ? null : ["Deadline", dueLabel(patch.dueInMs)],
    patch.clinicalUrgency === undefined ? null : ["Clinical urgency", patch.clinicalUrgency],
    preview.draft.reason === undefined ? null : ["Reason", preview.draft.reason],
  ].filter((field): field is string[] => field !== null);
}

type Props = {
  thread: Thread;
  busy?: boolean;
  onManualSave: (patch: TaskCorrectionPatch) => void;
  onApplied?: () => void;
};

export function TaskCorrectionPanel({ thread, busy = false, onManualSave, onApplied }: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [message, setMessage] = useState("Voice is optional; typing always remains available.");
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [dictationCredits, setDictationCredits] = useState<number | null>(null);
  const [preview, setPreview] = useState<TaskRevisionPreview | null>(null);
  const [building, setBuilding] = useState(false);
  const [applying, setApplying] = useState(false);
  const elementRef = useRef<CortiDictation | null>(null);
  const correlationIdRef = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!open || elementRef.current === null) return;
    let cancelled = false;
    let release: (() => Promise<void>) | null = null;
    const element = elementRef.current;

    const onEvent = (event: PipelineEvent) => {
      switch (event.type) {
        case "dictation.interim":
          setInterim(event.payload.text);
          break;
        case "dictation.final":
          setText((current) => appendFinal(current, event.payload.text));
          setInterim("");
          setPreview(null);
          recordCortiActivity({
            product: "dictation",
            status: "completed",
            action: "Voice correction transcribed for clinician review",
          });
          break;
        case "audio.quality_changed":
          if (event.payload.product !== "dictation") return;
          if (event.payload.state === "speech-quality-issue") {
            setMessage("Audio unclear · move closer or type the correction.");
          } else if (event.payload.state === "speech-quality-recovered") {
            setMessage("Audio clear again · review the final words before previewing.");
          }
          break;
        case "usage.updated":
          if (event.payload.product === "dictation") {
            setDictationCredits(event.payload.creditsConsumed);
            recordCortiActivity({
              product: "dictation",
              status: "completed",
              action: "Voice correction transcribed for clinician review",
              credits: event.payload.creditsConsumed,
            });
          }
          break;
        case "pipeline.error":
          setStatus("error");
          setMessage("Dictation stopped safely. Type the correction instead.");
          recordCortiActivity({
            product: "dictation",
            status: "unavailable",
            action: "Voice correction unavailable; typed fallback remained available",
          });
          break;
        default:
          break;
      }
    };

    const setup = async () => {
      setStatus("loading");
      try {
        const [{ bindCortiDictation }, token] = await Promise.all([
          import("@pipeline/browser/dictation.js"),
          getDictationToken(correlationIdRef.current),
        ]);
        await customElements.whenDefined("corti-dictation");
        if (cancelled) return;
        element.settingsEnabled = ["device", "language"];
        element.allowButtonFocus = true;
        release = bindCortiDictation({
          element,
          token,
          refreshToken: () => getDictationToken(correlationIdRef.current),
          primaryLanguage: "en",
          correlationId: correlationIdRef.current,
          keyterms: [thread.title, ...recipientTeams.map((team) => team.label)],
          onEvent,
        });
        setStatus("ready");
        setMessage("Ready · dictate or type, then review the parsed change.");
      } catch {
        if (cancelled) return;
        setStatus("error");
        setMessage("Voice unavailable · the typed correction still works.");
        recordCortiActivity({
          product: "dictation",
          status: "unavailable",
          action: "Voice correction unavailable; typed fallback remained available",
        });
      }
    };

    void setup();
    return () => {
      cancelled = true;
      if (release !== null) void release().catch(() => undefined);
    };
  }, [open, thread.id, thread.title]);

  useEffect(() => {
    setOpen(false);
    setText("");
    setInterim("");
    setDictationCredits(null);
    setPreview(null);
    correlationIdRef.current = crypto.randomUUID();
  }, [thread.id]);

  const buildPreview = async () => {
    const transcript = text.trim();
    if (transcript.length === 0) return;
    setBuilding(true);
    setPreview(null);
    try {
      const result = await buildDictationRevisionPreview({
        taskId: thread.backend?.taskId ?? thread.id,
        expectedVersion: thread.backend?.taskVersion ?? 1,
        idempotencyKey: `correct-${crypto.randomUUID()}`,
        transcript,
        recipientTeams,
        correlationId: correlationIdRef.current,
      });
      setPreview(result);
      setMessage("Preview built · nothing has been applied.");
    } catch {
      setMessage("Preview unavailable · no change was applied.");
    } finally {
      setBuilding(false);
    }
  };

  const applyCorrection = async () => {
    const backend = thread.backend;
    if (
      preview === null ||
      backend?.taskId == null ||
      backend.taskVersion == null ||
      Object.keys(preview.draft.patch).length === 0
    ) {
      return;
    }
    setApplying(true);
    try {
      await executeTaskCommand({
        taskId: backend.taskId,
        command: "correct",
        actorId: demoActors.clinician,
        correlationId: correlationIdRef.current,
        body: {
          expectedVersion: backend.taskVersion,
          idempotencyKey: preview.draft.idempotencyKey,
          ...preview.draft.patch,
        },
      });
      setPreview(null);
      setText("");
      setMessage("Correction applied · the tracked task now holds the confirmed change.");
      onApplied?.();
    } catch (error) {
      setMessage(
        error instanceof FollowThroughApiError
          ? `Correction not applied · ${error.message}`
          : "Correction not applied · the task is unchanged.",
      );
    } finally {
      setApplying(false);
    }
  };

  const canApply =
    preview !== null &&
    Object.keys(preview.draft.patch).length > 0 &&
    thread.backend?.taskId != null &&
    thread.backend.taskVersion != null &&
    thread.backend.availableCommands.includes("correct");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border border-border bg-panel px-3 py-2 text-[12.5px] font-medium text-foreground hover:bg-background"
      >
        <Pencil className="size-3.5 text-teal" /> Edit task
      </button>
    );
  }

  const fields = preview === null ? [] : previewFields(preview);

  return (
    <section className="space-y-3 rounded-lg border border-teal/20 bg-panel p-3">
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
              <Pencil className="size-3.5 text-teal" /> Edit task
            </p>
          </div>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            Review the Agentic draft and manually change any field before approval.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close correction editor"
          className="text-muted-foreground"
        >
          <ChevronDown className="size-4" />
        </button>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const summary = String(data.get("summary") ?? "").trim();
          const targetTeamId = String(data.get("targetTeamId") ?? "").trim();
          const clinicalUrgency = String(data.get("clinicalUrgency") ?? "").trim();
          const dueHours = Number(String(data.get("dueHours") ?? "").trim());
          const patch: TaskCorrectionPatch = { summary };
          if (targetTeamId.length > 0 && targetTeamId !== thread.backend?.targetTeamId) {
            patch.targetTeamId = targetTeamId;
          }
          if (["high", "medium", "routine"].includes(clinicalUrgency)) {
            patch.clinicalUrgency = clinicalUrgency as "high" | "medium" | "routine";
          }
          if (Number.isFinite(dueHours) && dueHours > 0) {
            patch.dueInMs = Math.round(dueHours * 3_600_000);
          }
          onManualSave(patch);
          setOpen(false);
        }}
        className="space-y-2 rounded-md border border-border bg-background p-3"
      >
        <label className="block">
          <span className="mb-1 block text-[11.5px] font-medium text-muted-foreground">
            Task action
          </span>
          <input
            name="summary"
            defaultValue={thread.title}
            minLength={5}
            maxLength={240}
            required
            className="w-full rounded-md border border-border bg-panel px-3 py-2 text-[13px] text-foreground"
          />
        </label>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium text-muted-foreground">Team</span>
            <select
              name="targetTeamId"
              defaultValue={thread.backend?.targetTeamId ?? ""}
              className="w-full rounded-md border border-border bg-panel px-2.5 py-2 text-[12.5px] text-foreground"
            >
              <option value="">Keep current team</option>
              {recipientTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium text-muted-foreground">
              Urgency
            </span>
            <select
              name="clinicalUrgency"
              defaultValue=""
              className="w-full rounded-md border border-border bg-panel px-2.5 py-2 text-[12.5px] text-foreground"
            >
              <option value="">Keep current</option>
              <option value="high">Urgent</option>
              <option value="medium">Soon</option>
              <option value="routine">Routine</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-medium text-muted-foreground">
              New deadline
            </span>
            <input
              name="dueHours"
              type="number"
              min="1"
              step="1"
              placeholder="Hours"
              aria-label="New deadline in hours"
              className="w-full rounded-md border border-border bg-panel px-2.5 py-2 text-[12.5px] text-foreground"
            />
          </label>
        </div>
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-[11.5px] text-muted-foreground">
            Blank urgency and deadline fields keep the current values.
          </p>
          <button
            type="submit"
            disabled={busy}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-[12.5px] font-medium text-background disabled:opacity-45"
          >
            {busy ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="size-3.5" />
            )}
            Save task changes
          </button>
        </div>
      </form>

      <div className="border-t border-border pt-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
            <Mic2 className="size-3.5 text-teal" /> Optional · edit using Corti Dictation
          </p>
          <span className="text-[10.5px] text-muted-foreground">
            Usage:{" "}
            {dictationCredits === null
              ? "shown when complete"
              : `${dictationCredits.toFixed(4)} credits`}
          </span>
        </div>
        <p className="mb-2 text-[11.5px] text-muted-foreground">{message}</p>
      </div>

      <div className="flex min-h-12 items-center rounded-md border border-border bg-background px-2">
        {status === "loading" && <LoaderCircle className="mr-2 size-3.5 animate-spin text-teal" />}
        <corti-dictation
          ref={elementRef}
          className={status === "ready" ? "min-w-44" : "pointer-events-none min-w-44 opacity-45"}
        />
      </div>

      <label className="block">
        <span className="mb-1 block text-[11.5px] font-medium text-muted-foreground">
          Final correction · editable before parsing
        </span>
        <textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setPreview(null);
          }}
          rows={3}
          placeholder="For example: Route to district nursing within 48 hours and mark medium because blood pressure needs checking."
          className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-[13px] leading-relaxed text-foreground"
        />
      </label>

      {interim.length > 0 && <LiveInterimText text={interim} label="Corti Dictation is hearing" />}

      <button
        type="button"
        onClick={() => void buildPreview()}
        disabled={text.trim().length === 0 || building}
        className="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-[12.5px] font-medium text-background disabled:opacity-45"
      >
        {building && <LoaderCircle className="size-3.5 animate-spin" />}
        Build change preview
      </button>

      {preview !== null && (
        <div className="space-y-2 rounded-md border border-border bg-background p-3">
          {fields.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              No supported fields were detected. Keep the change to action, team, deadline, or
              urgency.
            </p>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
              {fields.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-medium text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {preview.warnings.map((warning) => (
            <p key={warning} className="text-[11.5px] text-pending-strong">
              {warning}
            </p>
          ))}
          <p className="flex items-start gap-1.5 border-t border-border pt-2 text-[11.5px] text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-teal" />
            {thread.backend?.taskId === null || thread.backend?.taskVersion == null
              ? "Preview only · explicit clinician confirmation and an authoritative task version are required before this can change tracked work."
              : "Preview only until confirmed · applying uses the authoritative task version and is recorded against the clinician."}
          </p>
          {canApply && (
            <button
              type="button"
              onClick={() => void applyCorrection()}
              disabled={applying}
              className="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-[12.5px] font-medium text-background disabled:opacity-45"
            >
              {applying ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="size-3.5" />
              )}
              Confirm and apply correction
            </button>
          )}
        </div>
      )}
    </section>
  );
}
