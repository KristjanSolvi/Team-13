import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Mic, Plus } from "lucide-react";
import type { Patient } from "@/data/ward";

type Line = { speaker: string; text: string };
type Cue = { id: string; detail: string; title: string };

const scripts: Record<string, { lines: Line[]; cues: Cue[] }> = {
  default: {
    lines: [
      { speaker: "Consultant", text: "How have things been overnight?" },
      { speaker: "Nurse", text: "Stable, obs unremarkable, eating and drinking." },
      { speaker: "Consultant", text: "Good — let's review again this afternoon." },
      { speaker: "Patient", text: "When do you think I can go home?" },
      { speaker: "Consultant", text: "Once the last results are back we'll plan it." },
    ],
    cues: [{ id: "c1", detail: "“We'll review again this afternoon” — no owner recorded.", title: "Afternoon review" }],
  },
  p1: {
    lines: [
      { speaker: "Consultant", text: "Chest is still tight on the right side." },
      { speaker: "Patient", text: "It aches up into my shoulder when I breathe in." },
      { speaker: "Consultant", text: "Let's get the CT chest done before handover." },
      { speaker: "Nurse", text: "Radiology said 12:45 if we can get a porter." },
      { speaker: "Consultant", text: "And keep an eye on his sats overnight." },
    ],
    cues: [
      { id: "c1", detail: "Referred shoulder pain mentioned, not yet documented.", title: "Referred shoulder pain — review" },
      { id: "c2", detail: "Hourly sats observations implied but never confirmed.", title: "Hourly sats observations" },
    ],
  },
  p3: {
    lines: [
      { speaker: "Consultant", text: "She's walking better than yesterday." },
      { speaker: "Physio", text: "Stairs assessment still outstanding though." },
      { speaker: "Consultant", text: "I'll put in a physio referral so she can go home safely." },
      { speaker: "Nurse", text: "Family are hoping for tomorrow morning." },
    ],
    cues: [{ id: "c1", detail: "Physio referral promised yesterday — home planned tomorrow.", title: "Stairs assessment before discharge" }],
  },
  p7: {
    lines: [
      { speaker: "Consultant", text: "He's fine to go home tomorrow." },
      { speaker: "Nurse", text: "Pharmacy will need the script today to make that." },
      { speaker: "Consultant", text: "I'll write the TTOs after the round." },
    ],
    cues: [{ id: "c1", detail: "Discharge tomorrow depends on TTOs reaching pharmacy before 17:00.", title: "Write discharge script (TTOs)" }],
  },
};

type Props = {
  patient: Patient;
  onAddThread: (patientId: string, title: string) => void;
  onScribe: (text: string) => void;
};

export function LiveStrip({ patient, onAddThread, onScribe }: Props) {
  const script = scripts[patient.id] ?? scripts["default"]!;
  const [live, setLive] = useState(true);
  const [shown, setShown] = useState(1);
  const [handled, setHandled] = useState<string[]>([]);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [filed, setFiled] = useState(false);
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
    setLive(true);
  }, [patient.id]);

  useEffect(() => {
    if (!live || shown >= script.lines.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), 2600);
    return () => clearTimeout(t);
  }, [live, shown, script.lines.length]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [shown]);

  const listening = live && shown < script.lines.length;
  const cues = script.cues.filter((c) => !handled.includes(c.id));

  const draftNote = useMemo(() => {
    const said = script.lines.map((l) => `${l.speaker}: ${l.text}`).join("\n");
    const plan = script.cues.map((c) => `• ${c.title}`).join("\n");
    return `Ward round (${clock}) — ${patient.name}, bed ${patient.bed}.\n\n${said}\n\nPlan:\n${plan}`;
  }, [script, clock, patient.name, patient.bed]);

  return (
    <section className="rounded-xl border border-border bg-panel">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
          <Mic className="size-3.5 text-teal" />
          Ambient round
          {listening && (
            <span className="flex items-center gap-1 text-[12px] font-normal text-muted-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-teal" /> listening
            </span>
          )}
        </span>
        <button
          onClick={() => setLive((v) => !v)}
          className="rounded-full border border-border px-2.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {live ? "Pause" : "Resume"}
        </button>
      </header>

      <div ref={feedRef} className="max-h-40 space-y-1.5 overflow-y-auto px-4 py-3">
        {script.lines.slice(0, shown).map((l, i) => (
          <p key={i} className="animate-in fade-in text-[13.5px] leading-snug duration-500">
            <span className="text-muted-foreground">{l.speaker}: </span>
            <span className="text-foreground">{l.text}</span>
          </p>
        ))}
        {listening && <p className="text-[12px] text-muted-foreground">transcribing…</p>}
      </div>

      {cues.length > 0 && (
        <div className="space-y-2 border-t border-border px-4 py-3">
          {cues.map((c) => (
            <div key={c.id} className="flex items-start gap-3">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-teal" />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium leading-snug text-foreground">{c.title}</p>
                <p className="text-[12.5px] leading-snug text-muted-foreground">{c.detail}</p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  onClick={() => {
                    onAddThread(patient.id, c.title);
                    setAccepted((a) => [...a, c.id]);
                    setHandled((h) => [...h, c.id]);
                  }}
                  className="flex items-center gap-1 rounded-md bg-teal px-2.5 py-1.5 text-[12.5px] font-medium text-panel"
                >
                  <Plus className="size-3.5" /> Track
                </button>
                <button
                  onClick={() => setHandled((h) => [...h, c.id])}
                  className="rounded-md border border-border px-2.5 py-1.5 text-[12.5px] font-medium text-muted-foreground"
                >
                  Skip
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <footer className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5">
        <span className="text-[12px] text-muted-foreground">
          {accepted.length > 0 ? `${accepted.length} tracked from this round` : "Draft note ready"}
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
            className="rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-background"
          >
            File note to record
          </button>
        )}
      </footer>
    </section>
  );
}
