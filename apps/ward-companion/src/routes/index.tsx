import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { WardBoard } from "@/components/ward/WardBoard";
import { PatientActivity } from "@/components/ward/PatientActivity";
import { FloatingLauncher } from "@/components/ward/FloatingLauncher";
import { BoardSkeleton, ListSkeleton } from "@/components/ward/Loading";
import { ViewTabs } from "@/components/ward/ViewTabs";
import { useFirstLoad } from "@/components/ward/useLoading";
import { NervecentreShell } from "@/components/ehr/NervecentreShell";
import { useWardRuntime } from "@/features/ward-runtime/useWardRuntime";
import type { ThreadStatus } from "@/data/ward";
import { patients } from "@/data/ward";

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
  const runtime = useWardRuntime();
  const {
    threads,
    changeImpacts,
    notes,
    ledgerBusy,
    ledgerErrors,
    refreshPatientThreads,
    addNote,
    runLedgerCommand,
    changeStatus,
    assignThread,
    addActivity,
    createThread,
  } = runtime;
  const [open, setOpen] = useState(true);
  const [maximized, setMaximized] = useState(false);
  const [view, setView] = useState<"board" | "activity">("board");
  const [ehrPatientId, setEhrPatientId] = useState("p1");
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [scopeId, setScopeId] = useState<string>("p1");
  const lastShift = useRef(0);
  const panelRef = useRef<HTMLElement>(null);
  const loadingView = useFirstLoad(view === "activity" ? `activity:${scopeId}` : view);

  useEffect(() => {
    if (open && view === "activity") void refreshPatientThreads(scopeId);
  }, [open, refreshPatientThreads, scopeId, view]);

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
          const order = ["activity", "board"] as const;
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

  const handleAddThread = (patientId: string, title: string) => {
    const id = createThread(patientId, title);
    setActiveThreadId(id);
    setEhrPatientId(patientId);
    setScopeId(patientId);
    setView("activity");
    setOpen(true);
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
          className={`liquid-glass fixed bottom-4 right-4 top-4 z-40 flex w-[calc(100%-2rem)] flex-col overflow-hidden rounded-[28px] transition-[left,max-width] duration-300 ${
            maximized ? "left-4 max-w-none" : "max-w-[52rem]"
          }`}
        >
          <header className="border-b border-white/25 bg-white/12 px-4 py-3">
            <ViewTabs
              value={view}
              onChange={(key) => {
                setView(key);
              }}
            />
          </header>

          <div className="min-h-0 flex-1">
            {loadingView ? (
              view === "board" ? (
                <BoardSkeleton />
              ) : (
                <ListSkeleton />
              )
            ) : view === "activity" ? (
              <div key="activity" className="fade-in-view h-full">
                <PatientActivity
                  threads={threads}
                  changeImpacts={changeImpacts[scopeId] ?? null}
                  patientId={ehrPatientId}
                  scopeId={scopeId}
                  onScopeChange={(id) => {
                    setScopeId(id);
                    setEhrPatientId(id);
                  }}
                  activeThreadId={activeThreadId}
                  onSelect={setActiveThreadId}
                  onStatusChange={changeStatus}
                  onAssign={assignThread}
                  onLedgerCommand={(thread, command) => void runLedgerCommand(thread, command)}
                  ledgerBusy={ledgerBusy}
                  ledgerErrors={ledgerErrors}
                  onAddActivity={addActivity}
                  onAddThread={handleAddThread}
                  onRefreshPatient={refreshPatientThreads}
                  onBackToBoard={() => {
                    setView("board");
                    setScopeId(ehrPatientId);
                  }}
                />
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
                    notes={notes}
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

      <FloatingLauncher
        open={open}
        maximized={maximized}
        onToggle={() => setOpen((current) => !current)}
        onMaximize={() => setMaximized((current) => !current)}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
