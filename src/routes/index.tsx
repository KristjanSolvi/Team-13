import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, LayoutGrid, ListChecks, X } from "lucide-react";
import { WardBoard } from "@/components/ward/WardBoard";
import { PatientActivity } from "@/components/ward/PatientActivity";
import { Insights } from "@/components/ward/Insights";
import { FloatingLauncher } from "@/components/ward/FloatingLauncher";
import { NervecentreShell } from "@/components/ehr/NervecentreShell";
import type { CaseNote, DocId, Thread, ThreadStatus } from "@/data/ward";
import {
  initialNotes,
  initialThreads,
  patients,
  statusDotClass,
  statusLabels,
} from "@/data/ward";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ward Threads — follow-through for hospital wards" },
      {
        name: "description",
        content:
          "A calm ward companion that tracks what was said on the round through to verified completion, with a live thread panel and a bed-by-bed ward board.",
      },
      { property: "og:title", content: "Ward Threads — follow-through for hospital wards" },
      {
        property: "og:description",
        content:
          "Track promised referrals, symptoms and scans from conversation to verified completion across every bed on the ward.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const [threads, setThreads] = useState<Thread[]>(initialThreads);
  const [notes, setNotes] = useState<Record<string, CaseNote[]>>(initialNotes);
  const [open, setOpen] = useState(true);
  const [view, setView] = useState<"board" | "activity" | "insights">("board");
  const [ehrPatientId, setEhrPatientId] = useState("p1");
  const [activeThreadId, setActiveThreadId] = useState<string | null>("t1");
  const [cameFromBoard, setCameFromBoard] = useState(false);
  const [scopeId, setScopeId] = useState<string | null>(null);
  const lastShift = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (!typing && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        setView((v) => {
          const order = ["board", "activity", "insights"] as const;
          const i = order.indexOf(v);
          const next = e.key === "ArrowLeft" ? Math.max(0, i - 1) : Math.min(order.length - 1, i + 1);
          return order[next]!;
        });
        return;
      }
      if (e.key === "Shift") {
        const now = Date.now();
        if (now - lastShift.current < 400) {
          setOpen((v) => !v);
          lastShift.current = 0;
        } else {
          lastShift.current = now;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const counts = useMemo(() => {
    const base: Record<ThreadStatus, number> = {
      pending: 0,
      tracking: 0,
      verified: 0,
      escalated: 0,
    };
    for (const t of threads) base[t.status] += 1;
    return base;
  }, [threads]);

  const stamp = () =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

  const updateThread = (id: string, fn: (t: Thread) => Thread) =>
    setThreads((prev) => prev.map((t) => (t.id === id ? fn(t) : t)));

  const addNote = (
    patientId: string,
    text: string,
    doc: DocId = "medical",
    source: CaseNote["source"] = "agent",
    author = "Ward Threads agent",
  ) =>
    setNotes((prev) => ({
      ...prev,
      [patientId]: [
        ...(prev[patientId] ?? []),
        {
          id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          doc,
          at: stamp(),
          author,
          source,
          text,
        },
      ],
    }));

  const handleStatusChange = (id: string, status: ThreadStatus) => {
    const th = threads.find((t) => t.id === id);
    if (th) {
      addNote(th.patientId, `${th.title} — moved to ${statusLabels[status].toLowerCase()}.`);
      if (status === "verified")
        addNote(th.patientId, `Completed and verified: ${th.title}.`, "discharge");
      if (status === "escalated")
        addNote(th.patientId, `Escalated — still outstanding: ${th.title}.`, "discharge");
    }
    updateThread(id, (t) => ({
      ...t,
      status,
      activity: [
        ...t.activity,
        {
          id: `${t.id}-${t.activity.length + 1}`,
          at: stamp(),
          actor: "You",
          text: `Moved to ${statusLabels[status].toLowerCase()}.`,
          kind: "action" as const,
        },
      ],
    }));
  }

  const handleAssign = (id: string, assignee: string | null) => {
    const th = threads.find((t) => t.id === id);
    if (th)
      addNote(
        th.patientId,
        assignee ? `${th.title} — picked up by ${assignee}.` : `${th.title} — released, open to anyone free.`,
      );
    updateThread(id, (t) => ({
      ...t,
      assignee,
      activity: [
        ...t.activity,
        {
          id: `${t.id}-${t.activity.length + 1}`,
          at: stamp(),
          actor: "You",
          text: assignee ? `${assignee} picked this up.` : "Released — open to anyone free.",
          kind: "action" as const,
        },
      ],
    }));
  };

  const handleAddActivity = (id: string, text: string) => {
    const th = threads.find((t) => t.id === id);
    if (th) addNote(th.patientId, `${th.title} — ${text}`);
    updateThread(id, (t) => ({
      ...t,
      activity: [
        ...t.activity,
        {
          id: `${t.id}-${t.activity.length + 1}`,
          at: stamp(),
          actor: "You",
          text,
          kind: "note" as const,
        },
      ],
    }));
  };

  const handleAddThread = (patientId: string, title: string) => {
    const patient = patients.find((p) => p.id === patientId);
    const id = `t-${Date.now()}`;
    setThreads((prev) => [
      ...prev,
      {
        id,
        patientId,
        title,
        status: "pending",
        heard: "Added by hand on the ward.",
        matters: "Flagged as worth following through to completion.",
        suggestion: `Offer this to whoever is free in ${patient?.bay ?? "the bay"}.`,
        assignee: null,
        candidates: [
          { name: "Nurse in charge", role: "Coordinator", free: true },
          { name: "Dr. Neve Halloran", role: "SHO", free: true },
        ],
        due: "Today",
        activity: [
          { id: `${id}-1`, at: stamp(), actor: "You", text: "Thread created.", kind: "system" },
        ],
      },
    ]);
    setActiveThreadId(id);
    setView("activity");
    setCameFromBoard(false);
    setOpen(true);
    addNote(patientId, `New thread started: ${title}. Tracking through to completion.`);
    addNote(patientId, `Outstanding before discharge: ${title}.`, "discharge");
  };

  return (
    <div className="min-h-screen font-sans text-foreground">
      <NervecentreShell
        patient={patients.find((p) => p.id === ehrPatientId)}
        notes={notes[ehrPatientId] ?? []}
        activity={threads
          .filter((t) => t.patientId === ehrPatientId)
          .flatMap((t) => t.activity)}
        onAddNote={(doc, text) => addNote(ehrPatientId, text, doc, "clinician", "S. Marriott")}
        onSelectPatient={(id) => {
          setEhrPatientId(id);
          setView("activity");
          setOpen(true);
        }}
      />

      {open && (
        <section
          className="fixed bottom-4 right-4 top-4 z-50 flex w-[calc(100%-2rem)] max-w-[52rem] flex-col overflow-hidden rounded-xl border border-border bg-panel/95 shadow-xl ring-1 ring-foreground/5 backdrop-blur-xl transition-[max-width] duration-300"
        >
          <header className="border-b border-border bg-background/60 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1 rounded-md border border-border bg-background p-0.5">
                {(
                  [
                    ["board", "Ward board", LayoutGrid],
                    ["activity", "Activity", ListChecks],
                    ["insights", "Insights", BarChart3],
                  ] as const
                ).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    onClick={() => {
                      setView(key);
                      if (key === "board") setCameFromBoard(false);
                    }}
                    aria-current={view === key}
                    className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-[13px] font-medium transition-colors ${
                      view === key
                        ? "bg-panel text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="size-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <span className="hidden items-center gap-4 text-xs text-muted-foreground sm:flex">
                  {(
                    [
                      ["pending", "Needs action"],
                      ["tracking", "In progress"],
                      ["verified", "Completed"],
                      ["escalated", "Escalated"],
                    ] as [ThreadStatus, string][]
                  ).map(([s, label]) => (
                    <span key={s} className="flex items-center gap-1.5" title={label}>
                      <span className={`size-2 rounded-full ${statusDotClass[s]}`} />
                      <span className="text-[11px]">{label}</span>
                      <span className="text-[11px] tabular-nums text-foreground">{counts[s]}</span>
                      <span className="sr-only">{statusLabels[s]}</span>
                    </span>
                  ))}
                </span>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Hide panel"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
          </header>

          <div className="min-h-0 flex-1">
            {view === "activity" ? (
              <PatientActivity
                threads={threads}
                patientId={ehrPatientId}
                scopeId={scopeId}
                onScopeChange={(id) => {
                  setScopeId(id);
                  if (id) setEhrPatientId(id);
                  setCameFromBoard(false);
                }}
                activeThreadId={activeThreadId}
                onSelect={setActiveThreadId}
                onStatusChange={handleStatusChange}
                onAssign={handleAssign}
                onAddActivity={handleAddActivity}
                onAddThread={handleAddThread}
                onSelectPatient={setEhrPatientId}
                onScribe={(text) =>
                  addNote(ehrPatientId, text, "medical", "scribe", "Ambient scribe")
                }
                cameFromBoard={cameFromBoard}
                onBackToBoard={() => {
                  setView("board");
                  setCameFromBoard(false);
                  setScopeId(null);
                }}
              />
            ) : view === "insights" ? (
              <Insights
                threads={threads}
                onOpenPatient={(pid) => {
                  setEhrPatientId(pid);
                  setCameFromBoard(false);
                  setView("activity");
                }}
              />
            ) : (
              <div className="flex h-full flex-col">
                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-border px-5 py-3">
                  <div>
                    <h1 className="text-[15px] font-medium tracking-tight">
                      North Wing · Level 4
                    </h1>
                    <p className="text-[12.5px] text-muted-foreground">
                      {counts.pending + counts.tracking + counts.escalated} open across the ward
                    </p>
                  </div>
                  <dl className="flex gap-6 text-[12.5px] text-muted-foreground">
                    <div>
                      <dt>Home tomorrow</dt>
                      <dd className="text-foreground">
                        {patients.filter((p) => p.homeTomorrow).length}
                      </dd>
                    </div>
                    <div>
                      <dt>Past deadline</dt>
                      <dd className="text-foreground">{counts.escalated}</dd>
                    </div>
                  </dl>
                </div>
                <div className="flex-1 overflow-y-auto p-5">
                  <WardBoard
                    threads={threads}
                    notes={notes}
                    activePatientId={ehrPatientId}
                    onOpenPatient={(pid) => {
                      setEhrPatientId(pid);
                      setScopeId(pid);
                      setCameFromBoard(true);
                      setView("activity");
                    }}
                    onOpenThread={(id) => {
                      const pid = threads.find((t) => t.id === id)?.patientId ?? ehrPatientId;
                      setEhrPatientId(pid);
                      setScopeId(pid);
                      setActiveThreadId(id);
                      setCameFromBoard(true);
                      setView("activity");
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          <footer className="flex items-center justify-between border-t border-border bg-background/60 px-6 py-3 text-xs font-medium text-muted-foreground">
            <span>Ward Threads · connected to Nervecentre</span>
            <span>← → to switch views · Esc to hide</span>
          </footer>
        </section>
      )}

      {!open && <FloatingLauncher onOpen={() => setOpen(true)} />}
    </div>
  );
}
