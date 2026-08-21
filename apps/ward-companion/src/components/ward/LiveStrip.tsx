import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  FileText,
  Mic,
  Pause,
  Play,
  Plus,
  Radio,
  Sparkles,
  X,
} from "lucide-react";
import type { Patient } from "@/data/ward";
import { CortiLiveStrip } from "./CortiLiveStrip";

/** A conservatively flagged span: likely mishearing, never applied silently. */
type Flag = {
  id: string;
  /** exact substring as heard in the raw transcript */
  heard: string;
  suggestion: string;
  reason: string;
  confidence: number;
};

type Line = {
  speaker: string;
  text: string;
  role: "clinician" | "patient" | "staff";
  flags?: Flag[];
};
type Cue = {
  id: string;
  detail: string;
  title: string;
  /** index of the transcript line that triggers this cue */
  after: number;
  team: string;
  confidence: number;
  /** cue cannot be tracked until these flags are resolved */
  dependsOn?: string[];
};

const scripts: Record<string, { lines: Line[]; cues: Cue[] }> = {
  default: {
    lines: [
      { speaker: "Doctor", role: "clinician", text: "Uh... how have things been overnight?" },
      {
        speaker: "Nurse",
        role: "staff",
        text: "Stable overnight, she had two parachutes at four for the headache.",
        flags: [
          {
            id: "f-default-1",
            heard: "parachutes",
            suggestion: "paracetamol",
            reason: "Analgesia context; no plausible clinical reading of “parachutes”.",
            confidence: 0.72,
          },
        ],
      },

      { speaker: "Doctor", role: "clinician", text: "Good — let's review again this afternoon." },
      { speaker: "Patient", role: "patient", text: "When do you think I can go home?" },
      {
        speaker: "Doctor",
        role: "clinician",
        text: "Ehmmm... once the last results are back we'll plan it.",
      },
    ],
    cues: [
      {
        id: "c1",
        after: 2,
        team: "Surgical SHO team",
        confidence: 0.91,
        detail: "“We'll review again this afternoon” — no owner recorded.",
        title: "Afternoon review",
      },
    ],
  },
  p1: {
    lines: [
      { speaker: "Doctor", role: "clinician", text: "Chest is still tight on the right side." },
      {
        speaker: "Patient",
        role: "patient",
        text: "It aches up into my shoulder when I breathe in.",
      },
      {
        speaker: "Doctor",
        role: "clinician",
        text: "Uh... let's get the CT chest done before handover, and start him on co-amoxil.",
        flags: [
          {
            id: "f-p1-1",
            heard: "co-amoxil",
            suggestion: "co-amoxiclav",
            reason: "Closest formulary match; “co-amoxil” is not a licensed drug name.",
            confidence: 0.68,
          },
        ],
      },
      { speaker: "Nurse", role: "staff", text: "Radiology said 12:45 if we can get a porter." },
      {
        speaker: "Doctor",
        role: "clinician",
        text: "And keep an eye on his sats overnight — hourly if he drops below ninety free.",
        flags: [
          {
            id: "f-p1-2",
            heard: "ninety free",
            suggestion: "93%",
            reason: "Numeric threshold in a saturation context.",
            confidence: 0.64,
          },
        ],
      },
    ],

    cues: [
      {
        id: "c1",
        after: 1,
        team: "Surgical SHO team",
        confidence: 0.88,
        detail: "Referred shoulder pain mentioned, not yet documented.",
        title: "Review referred shoulder pain",
      },
      {
        id: "c2",
        after: 4,
        team: "Nursing team",
        confidence: 0.94,
        detail: "Sats mentioned as needing a watch; no observation plan has been confirmed yet.",
        title: "Monitor saturation",
        dependsOn: ["f-p1-2"],
      },
    ],
  },
  p3: {
    lines: [
      {
        speaker: "Doctor",
        role: "clinician",
        text: "She's walking better than yesterday, ehmmm...",
      },
      { speaker: "Physio", role: "staff", text: "Stairs assessment still outstanding though." },
      {
        speaker: "Doctor",
        role: "clinician",
        text: "I'll put in a physio referral so she can go home safely.",
      },
      { speaker: "Nurse", role: "staff", text: "Family are hoping for tomorrow morning." },
    ],
    cues: [
      {
        id: "c1",
        after: 2,
        team: "Physiotherapy",
        confidence: 0.93,
        detail: "Physio referral promised yesterday — home planned tomorrow.",
        title: "Stairs assessment before discharge",
      },
    ],
  },
  p7: {
    lines: [
      { speaker: "Doctor", role: "clinician", text: "He's fine to go home tomorrow." },
      {
        speaker: "Nurse",
        role: "staff",
        text: "Pharmacy will need the script today to make that.",
      },
      { speaker: "Doctor", role: "clinician", text: "Uh... I'll write the TTOs after the round." },
    ],
    cues: [
      {
        id: "c1",
        after: 1,
        team: "Pharmacy",
        confidence: 0.96,
        detail: "Discharge tomorrow depends on TTOs reaching pharmacy before 17:00.",
        title: "Write discharge script (TTOs)",
      },
    ],
  },
};

const roleTone: Record<Line["role"], string> = {
  clinician: "bg-teal/12 text-teal",
  patient: "bg-tracking-soft text-foreground",
  staff: "bg-background text-muted-foreground",
};

function Waveform({ active }: { active: boolean }) {
  const bars = [0.35, 0.7, 1, 0.55, 0.85, 0.4, 0.95, 0.6, 0.3];
  return (
    <span className="flex h-4 items-center gap-[2px]" aria-hidden>
      {bars.map((h, i) => (
        <span
          key={i}
          className="w-[2px] rounded-full bg-teal transition-all duration-300"
          style={{
            height: active ? `${Math.round(h * 16)}px` : "3px",
            opacity: active ? 0.35 + h * 0.65 : 0.3,
            animation: active ? `ward-wave 1.1s ease-in-out ${i * 0.09}s infinite` : undefined,
          }}
        />
      ))}
    </span>
  );
}

/** Renders a raw transcript line, marking flagged spans without ever rewriting them. */
function renderLine(
  line: Line,
  stateOf: (id: string) => "open" | "confirmed" | "kept",
  onResolve: (id: string, state: "confirmed" | "kept") => void,
) {
  const flags = line.flags ?? [];
  if (flags.length === 0) return line.text;

  const nodes: React.ReactNode[] = [];
  let rest = line.text;
  flags.forEach((f, i) => {
    const at = rest.indexOf(f.heard);
    if (at === -1) return;
    nodes.push(rest.slice(0, at));
    const state = stateOf(f.id);
    nodes.push(
      <span key={f.id} className="group relative inline-block">
        <span
          tabIndex={0}
          title={state === "open" ? "Possible mishearing — hover to review" : undefined}
          className={`cursor-help rounded px-0.5 outline-none transition-colors ${
            state === "confirmed"
              ? "bg-verified-soft text-verified-strong"
              : state === "kept"
                ? "text-foreground underline decoration-dotted decoration-muted-foreground underline-offset-2"
                : "bg-pending-soft text-pending-strong underline decoration-dashed underline-offset-2"
          }`}
        >
          {state === "open" && (
            <AlertTriangle className="mr-0.5 inline size-3 -translate-y-[1px] text-pending" />
          )}
          {state === "confirmed" ? f.suggestion : f.heard}
        </span>

        {state === "open" && (
          <span className="pointer-events-none absolute left-0 top-full z-30 hidden w-64 pt-1.5 group-hover:block group-focus-within:block">
            <span className="pointer-events-auto block rounded-xl border border-pending/40 bg-panel p-3 text-left shadow-[0_8px_24px_rgba(16,24,40,0.14)]">
              <span className="block text-[12.5px] leading-snug text-foreground">
                Heard <span className="rounded bg-pending-soft px-1 font-medium">“{f.heard}”</span>{" "}
                · likely <span className="font-medium">“{f.suggestion}”</span>
              </span>
              <span className="mt-1 block text-[11.5px] leading-snug text-muted-foreground">
                {f.reason} · {Math.round(f.confidence * 100)}% confidence. The raw transcript stays
                unchanged.
              </span>
              <span className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => onResolve(f.id, "confirmed")}
                  className="liquid-press flex items-center gap-1 rounded-lg bg-foreground px-2.5 py-1 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
                >
                  <Check className="size-3" /> Confirm
                </button>
                <button
                  onClick={() => onResolve(f.id, "kept")}
                  className="liquid-press ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-3" /> Keep as heard
                </button>
              </span>
            </span>
          </span>
        )}
      </span>,
    );
    rest = rest.slice(at + f.heard.length);
    if (i === flags.length - 1) nodes.push(rest);
  });
  return nodes;
}

type Props = {
  patient: Patient;
  onAddThread: (patientId: string, title: string) => void;
  onScribe: (text: string) => void;
  onAuthoritativeChange: () => Promise<void>;
};

type FlagState = "open" | "confirmed" | "kept";

export function LiveStrip({ patient, onAddThread, onScribe, onAuthoritativeChange }: Props) {
  const script = scripts[patient.id] ?? scripts["default"]!;
  const [live, setLive] = useState(true);
  const [shown, setShown] = useState(1);
  const [handled, setHandled] = useState<string[]>([]);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [filed, setFiled] = useState(false);
  const [flagState, setFlagState] = useState<Record<string, FlagState>>({});
  const [captureMode, setCaptureMode] = useState<"demo" | "corti">("demo");
  const feedRef = useRef<HTMLDivElement>(null);

  const clock = useMemo(
    () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }),
    [],
  );

  useEffect(() => {
    setShown(1);
    setHandled([]);
    setAccepted([]);
    setFiled(false);
    setFlagState({});
    setCaptureMode("demo");
    setLive(true);
  }, [patient.id]);

  useEffect(() => {
    if (!live || shown >= script.lines.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), 2000);
    return () => clearTimeout(t);
  }, [live, shown, script.lines.length]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [shown]);

  const listening = live && shown < script.lines.length;
  const finished = shown >= script.lines.length;
  const surfaced = script.cues.filter((c) => c.after < shown);
  const cues = surfaced.filter((c) => !handled.includes(c.id));
  const progress = Math.round((shown / script.lines.length) * 100);

  const stateOf = (id: string): FlagState => flagState[id] ?? "open";

  /** Raw transcript is never mutated; corrections are applied only to the outgoing note. */
  const reviewedText = (l: Line) => {
    let out = l.text;
    for (const f of l.flags ?? []) {
      if (stateOf(f.id) === "confirmed") out = out.replace(f.heard, f.suggestion);
    }
    return out;
  };

  const draftNote = useMemo(() => {
    const said = script.lines.map((l) => `${l.speaker}: ${reviewedText(l)}`).join("\n");
    const plan = script.cues.map((c) => `• ${c.title}`).join("\n");
    const corrections = script.lines
      .flatMap((l) => l.flags ?? [])
      .filter((f) => stateOf(f.id) === "confirmed")
      .map((f) => `• “${f.heard}” → “${f.suggestion}” (confirmed by clinician)`);
    const audit = corrections.length
      ? `\n\nTranscript corrections:\n${corrections.join("\n")}`
      : "";
    return `Ward round (${clock}) — ${patient.name}, bed ${patient.bed}.\n\n${said}\n\nPlan:\n${plan}${audit}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script, clock, patient.name, patient.bed, flagState]);

  if (captureMode === "corti") {
    return (
      <div className="space-y-2">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setCaptureMode("demo")}
            className="liquid-press rounded-full border border-border bg-panel px-3 py-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
          >
            Return to demo round
          </button>
        </div>
        <CortiLiveStrip patient={patient} onAuthoritativeChange={onAuthoritativeChange} />
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-panel shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <style>{`@keyframes ward-wave{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}`}</style>

      <header className="flex items-center justify-between gap-3 px-4 pt-3.5">
        <span className="flex items-center gap-2.5">
          <span
            className={`flex size-7 items-center justify-center rounded-full transition-colors ${
              listening ? "bg-teal/15 text-teal" : "bg-background text-muted-foreground"
            }`}
          >
            <Mic className="size-3.5" />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[13.5px] font-medium text-foreground">Ambient round</span>
            <span className="text-[11.5px] tabular-nums text-muted-foreground">
              {listening
                ? "Listening · live transcript"
                : finished
                  ? `Round captured · ${clock}`
                  : "Paused"}
            </span>
          </span>
          <Waveform active={listening} />
        </span>
        <div className="flex items-center gap-2">
          <span
            className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium tabular-nums transition-colors duration-500 sm:flex ${
              surfaced.length > 0
                ? "bg-pending-soft text-pending-strong"
                : "bg-background text-muted-foreground"
            }`}
          >
            <Sparkles
              className={`size-3 transition-colors duration-500 ${surfaced.length > 0 ? "text-pending" : "text-teal"}`}
            />
            {surfaced.length} detected · {accepted.length} tracked
          </span>
          <button
            type="button"
            onClick={() => setCaptureMode("corti")}
            className="liquid-press hidden items-center gap-1.5 rounded-full border border-teal/25 bg-teal/5 px-2.5 py-1 text-[12px] font-medium text-teal transition-colors hover:bg-teal/10 md:flex"
          >
            <Radio className="size-3" /> Use live Corti
          </button>
          <button
            onClick={() => setLive((v) => !v)}
            className="liquid-press flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {live ? <Pause className="size-3" /> : <Play className="size-3" />}
            {live ? "Pause" : "Resume"}
          </button>
        </div>
      </header>

      <div className="mt-3 h-px w-full bg-border">
        <span
          className="block h-px bg-teal transition-all duration-700 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div ref={feedRef} className="space-y-2 overflow-visible px-4 py-3">
        {script.lines.slice(0, shown).map((l, i) => (
          <div
            key={i}
            className="animate-in fade-in slide-in-from-bottom-1 flex gap-2.5 duration-500"
          >
            <span
              className={`mt-[1px] shrink-0 rounded-full px-2 py-[2px] text-[11px] font-medium ${roleTone[l.role]}`}
            >
              {l.speaker}
            </span>
            <p className="text-[13.5px] leading-snug text-foreground">
              {renderLine(l, stateOf, (id, state) => setFlagState((s) => ({ ...s, [id]: state })))}
            </p>
          </div>
        ))}
        {listening && (
          <p className="flex items-center gap-1.5 pl-1 text-[12px] text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-teal" /> transcribing…
          </p>
        )}
      </div>

      {cues.length > 0 && (
        <div className="space-y-2 border-t border-border bg-background/60 px-4 py-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            <Sparkles className="size-3 text-teal" /> Tasks picked up from the agent
          </p>
          {cues.map((c) => {
            return (
              <div
                key={c.id}
                className="animate-in fade-in zoom-in-95 rounded-xl border border-teal/25 bg-panel p-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)] duration-300"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium leading-snug text-foreground">
                      {c.title}
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
                      {c.detail}
                    </p>
                  </div>
                </div>
                <div className="mt-2.5 flex items-center gap-2">
                  <button
                    onClick={() => {
                      onAddThread(patient.id, c.title);
                      setAccepted((a) => [...a, c.id]);
                      setHandled((h) => [...h, c.id]);
                    }}
                    className="liquid-press flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[12.5px] font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus className="size-3.5" /> Track task
                  </button>
                  <button
                    onClick={() => setHandled((h) => [...h, c.id])}
                    className="liquid-press ml-auto flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="size-3.5" /> Dismiss
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <footer className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5">
        <span className="text-[12px] tabular-nums text-muted-foreground">
          {accepted.length > 0
            ? `${accepted.length} task${accepted.length > 1 ? "s" : ""} tracked from this round`
            : "Draft note ready"}
        </span>
        {filed ? (
          <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-verified-strong">
            <Check className="size-3.5" /> Filed to record
          </span>
        ) : (
          <button
            onClick={() => {
              onScribe(draftNote);
              setFiled(true);
            }}
            className="liquid-press flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FileText className="size-3.5" /> File note to record
          </button>
        )}
      </footer>
    </section>
  );
}
