import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { WardBoard } from "@/components/ward/WardBoard";
import { PatientActivity } from "@/components/ward/PatientActivity";
import { Insights } from "@/components/ward/Insights";
import { FloatingLauncher } from "@/components/ward/FloatingLauncher";
import { BoardSkeleton, InsightsSkeleton, ListSkeleton } from "@/components/ward/Loading";
import { ViewTabs } from "@/components/ward/ViewTabs";
import { useFirstLoad } from "@/components/ward/useLoading";
import { NervecentreShell } from "@/components/ehr/NervecentreShell";
import {
  demoActors,
  executeTaskCommand,
  FollowThroughApiError,
  getWardCompanionOverview,
  type WardTaskCommand,
} from "@/lib/follow-through-api";
import { loadWardState, saveWardState } from "@/lib/ward-persistence";
import type { CaseNote, DocId, Thread, ThreadStatus } from "@/data/ward";
import { initialNotes, initialThreads, patients, statusLabels } from "@/data/ward";

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

const ledgerCommandNotes: Record<WardTaskCommand, string> = {
  approve: "approved and sent to the receiving team.",
  correct: "corrected before approval.",
  dismiss: "dismissed as already covered.",
  reopen: "reopened with a fresh deadline.",
  accept: "accepted by the receiving team.",
  decline: "declined by the receiving team.",
  complete: "reported complete, awaiting verification.",
  verify: "completion independently verified.",
};

function Index() {
  const [threads, setThreads] = useState<Thread[]>(initialThreads);
  const [notes, setNotes] = useState<Record<string, CaseNote[]>>(initialNotes);
  const [open, setOpen] = useState(true);
  const [view, setView] = useState<"board" | "activity" | "insights">("board");
  const [ehrPatientId, setEhrPatientId] = useState("p1");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [scopeId, setScopeId] = useState<string>("p1");
  const [persistenceReady, setPersistenceReady] = useState(false);
  const lastShift = useRef(0);
  const panelRef = useRef<HTMLElement>(null);
  const loadingView = useFirstLoad(view === "activity" ? `activity:${scopeId}` : view);

  const refreshPatientThreads = useCallback(async (uiPatientId: string) => {
    const patient = patients.find((candidate) => candidate.id === uiPatientId);
    if (patient === undefined) return;
    try {
      const overview = await getWardCompanionOverview(
        patient.pipelinePatientId,
        crypto.randomUUID(),
      );
      if (overview.patientId !== patient.pipelinePatientId) return;
      const authoritative = overview.threads.map((thread) => ({
        ...thread,
        patientId: uiPatientId,
      }));
      setThreads((current) => [
        ...current.filter((thread) => thread.patientId !== uiPatientId),
        ...authoritative,
      ]);
    } catch {
      // Retain current local work when authoritative services are unavailable.
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const launcherClicked =
        target instanceof Element && target.closest("[data-ward-launcher]") !== null;
      if (!launcherClicked && !panelRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    const persisted = loadWardState(window.localStorage);
    if (persisted !== null) {
      setThreads(persisted.threads);
      setNotes(persisted.notes);
    }
    setPersistenceReady(true);
  }, []);

  useEffect(() => {
    if (!persistenceReady) return;
    saveWardState(window.localStorage, { threads, notes });
  }, [notes, persistenceReady, threads]);

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
          const next =
            e.key === "ArrowLeft" ? Math.max(0, i - 1) : Math.min(order.length - 1, i + 1);
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

  const [ledgerBusy, setLedgerBusy] = useState<string | null>(null);
  const [ledgerErrors, setLedgerErrors] = useState<Record<string, string>>({});

  const handleLedgerCommand = async (thread: Thread, command: WardTaskCommand) => {
    const backend = thread.backend;
    if (backend?.taskId == null || backend.taskVersion == null || ledgerBusy !== null) {
      return;
    }
    setLedgerBusy(`${command}-${thread.id}`);
    setLedgerErrors((prev) => {
      const next = { ...prev };
      delete next[thread.id];
      return next;
    });
    const extras: Record<string, unknown> =
      command === "approve"
        ? { approvalChannel: "app_one_tap" }
        : command === "dismiss"
          ? { reason: "Dismissed on the ward round as already covered." }
          : command === "reopen"
            ? { dueInMs: 24 * 3_600_000 }
            : command === "complete" || command === "verify"
              ? { outcomeRef: `record:ward-panel-${crypto.randomUUID().slice(0, 12)}` }
              : {};
    const actorId =
      command === "accept" || command === "decline" || command === "complete"
        ? (thread.assignee ?? demoActors.teamMember)
        : demoActors.clinician;
    try {
      await executeTaskCommand({
        taskId: backend.taskId,
        command,
        actorId,
        correlationId: crypto.randomUUID(),
        body: {
          expectedVersion: backend.taskVersion,
          idempotencyKey: `${command}-${crypto.randomUUID()}`,
          ...extras,
        },
      });
      addNote(thread.patientId, `${thread.title} — ${ledgerCommandNotes[command]}`);
      await refreshPatientThreads(thread.patientId);
    } catch (error) {
      setLedgerErrors((prev) => ({
        ...prev,
        [thread.id]:
          error instanceof FollowThroughApiError
            ? `${error.message}${error.retryable ? " · safe to retry" : ""}`
            : "The ledger did not accept the command; the task is unchanged.",
      }));
    } finally {
      setLedgerBusy(null);
    }
  };

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
  };

  const handleAssign = (id: string, assignee: string | null) => {
    const th = threads.find((t) => t.id === id);
    if (th)
      addNote(
        th.patientId,
        assignee
          ? `${th.title} — picked up by ${assignee}.`
          : `${th.title} — released, open to anyone free.`,
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
        suggestion: "Awaiting assignment.",
        assignee: null,
        candidates: [],
        due: "Today",
        activity: [
          { id: `${id}-1`, at: stamp(), actor: "You", text: "Thread created.", kind: "system" },
        ],
      },
    ]);
    setActiveThreadId(id);
    setEhrPatientId(patientId);
    setScopeId(patientId);
    setView("activity");
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
          .filter((thread) => thread.patientId === ehrPatientId)
          .flatMap((thread) =>
            thread.activity.map((entry) => ({
              ...entry,
              id: `${thread.id}:${entry.id}`,
            })),
          )}
        onAddNote={(doc, text) => addNote(ehrPatientId, text, doc, "clinician", "S. Marriott")}
        onSelectPatient={(id) => {
          setEhrPatientId(id);
          setScopeId(id);
          setView("activity");
          setOpen(true);
        }}
      />

      {open && (
        <section
          ref={panelRef}
          className="liquid-glass fixed bottom-4 right-4 top-4 z-50 flex w-[calc(100%-2rem)] max-w-[52rem] flex-col overflow-hidden rounded-[28px] transition-[max-width] duration-300"
        >
          <header className="border-b border-white/25 bg-white/12 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <ViewTabs
                value={view}
                onChange={(key) => {
                  setView(key);
                }}
              />

              <div className="flex items-center">
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
            {loadingView ? (
              view === "board" ? (
                <BoardSkeleton />
              ) : view === "insights" ? (
                <InsightsSkeleton />
              ) : (
                <ListSkeleton />
              )
            ) : view === "activity" ? (
              <div key="activity" className="fade-in-view h-full">
                <PatientActivity
                  threads={threads}
                  patientId={ehrPatientId}
                  scopeId={scopeId}
                  onScopeChange={(id) => {
                    setScopeId(id);
                    setEhrPatientId(id);
                  }}
                  activeThreadId={activeThreadId}
                  onSelect={setActiveThreadId}
                  onStatusChange={handleStatusChange}
                  onAssign={handleAssign}
                  onLedgerCommand={(thread, command) => void handleLedgerCommand(thread, command)}
                  ledgerBusy={ledgerBusy}
                  ledgerErrors={ledgerErrors}
                  onAddActivity={handleAddActivity}
                  onAddThread={handleAddThread}
                  onRefreshPatient={refreshPatientThreads}
                  onBackToBoard={() => {
                    setView("board");
                    setScopeId(ehrPatientId);
                  }}
                />
              </div>
            ) : view === "insights" ? (
              <div key="insights" className="fade-in-view h-full">
                <Insights threads={threads} />
              </div>
            ) : (
              <div key="board" className="fade-in-view flex h-full flex-col">
                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-border px-5 py-3">
                  <div>
                    <h1 className="text-[15px] font-medium tracking-tight">North Wing · Level 4</h1>
                    <p className="text-[12.5px] text-muted-foreground">
                      {counts.pending + counts.tracking + counts.escalated} open across the ward
                    </p>
                  </div>
                  <dl className="flex gap-6 text-[12.5px] text-muted-foreground">
                    <div>
                      <dt>Patients</dt>
                      <dd className="text-foreground">{patients.length}</dd>
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
                    activePatientId={ehrPatientId}
                    onOpenPatient={(pid) => {
                      setEhrPatientId(pid);
                      setScopeId(pid);
                      setView("activity");
                    }}
                    onOpenThread={(id) => {
                      const pid = threads.find((t) => t.id === id)?.patientId ?? ehrPatientId;
                      setEhrPatientId(pid);
                      setScopeId(pid);
                      setActiveThreadId(id);
                      setView("activity");
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          <footer className="flex items-center justify-between border-t border-white/25 bg-white/12 px-6 py-3 text-xs font-medium text-muted-foreground">
            <span>Ward Threads · connected to Nervecentre</span>
            <span>← → to switch views · Esc to hide</span>
          </footer>
        </section>
      )}

      <FloatingLauncher open={open} onToggle={() => setOpen((current) => !current)} />
    </div>
  );
}
