import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { WardBoard } from "@/components/ward/WardBoard";
import { PatientActivity } from "@/components/ward/PatientActivity";
import { Insights } from "@/components/ward/Insights";
import { FloatingLauncher } from "@/components/ward/FloatingLauncher";
import { BoardSkeleton, InsightsSkeleton, ListSkeleton } from "@/components/ward/Loading";
import { useFirstLoad } from "@/components/ward/useLoading";
import { ViewTabs, type ViewKey } from "@/components/ward/ViewTabs";
import { NervecentreShell } from "@/components/ehr/NervecentreShell";
import { useWardRuntime } from "@/features/ward-runtime/useWardRuntime";
import type { NewTaskOptions, WardBedAssignments } from "@/data/ward";
import { bays, patients } from "@/data/ward";

const initialBedAssignments = Object.fromEntries(
  bays.flatMap((bay) => bay.beds.map((slot) => [slot.bed, slot.patientId])),
) as WardBedAssignments;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Fluence — follow-through for hospital wards" },
      {
        name: "description",
        content:
          "A calm ward companion that tracks what was said on the round through to verified completion, with a live thread panel and a bed-by-bed ward board.",
      },
      { property: "og:title", content: "Fluence — follow-through for hospital wards" },
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
    authoritativeSync,
    notes,
    ledgerBusy,
    ledgerErrors,
    ehrRevision,
    refreshPatientThreads,
    loadTaskRoutingReceipt,
    demoHostUnlocked,
    unlockDemoHost,
    routeTaskNow,
    addNote,
    runLedgerCommand,
    changeStatus,
    assignThread,
    addActivity,
    createThread,
    offerThreadToTeam,
    editThread,
    removeThread,
    staff,
    teams,
  } = runtime;
  const [open, setOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [view, setView] = useState<ViewKey>("activity");
  const [ehrPatientId, setEhrPatientId] = useState("p1");
  const [activeThreadId, setActiveThreadId] = useState<string | null>("demo-t1");
  const [scopeId, setScopeId] = useState<string>("p1");
  const [openNotesRequest, setOpenNotesRequest] = useState(0);
  const [bedAssignments, setBedAssignments] = useState<WardBedAssignments>(() => ({
    ...initialBedAssignments,
  }));
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
        target instanceof Element && target.closest('[data-ward-threads-launcher="true"]') !== null;
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
          const order = ["activity", "board", "insights"] as const;
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
          setOpen((current) => {
            if (!current) {
              setMaximized(true);
              setScopeId(ehrPatientId);
            }
            return !current;
          });
          lastShift.current = 0;
        } else {
          lastShift.current = now;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ehrPatientId]);

  const handleAddThread = (patientId: string, title: string, options?: NewTaskOptions) => {
    const id = createThread(patientId, title, options);
    setActiveThreadId(id);
    setEhrPatientId(patientId);
    setScopeId(patientId);
    setView("activity");
    setOpen(true);
  };

  const placePatient = (patientId: string, bed: string) => {
    setBedAssignments((current) => {
      const next = { ...current };
      for (const [candidateBed, assignedId] of Object.entries(next)) {
        if (assignedId === patientId) next[candidateBed] = null;
      }
      next[bed] = patientId;
      return next;
    });
  };

  const removePatientFromBed = (bed: string) => {
    setBedAssignments((current) => ({ ...current, [bed]: null }));
  };

  const baseEhrPatient = patients.find((patient) => patient.id === ehrPatientId);
  const currentBed = Object.entries(bedAssignments).find(
    ([, patientId]) => patientId === ehrPatientId,
  )?.[0];
  const currentBay = bays.find((bay) => bay.beds.some((slot) => slot.bed === currentBed));
  const displayedEhrPatient = baseEhrPatient
    ? currentBed
      ? { ...baseEhrPatient, bed: currentBed, bay: currentBay?.name ?? baseEhrPatient.bay }
      : { ...baseEhrPatient, bed: "Unassigned", bay: "EHR roster" }
    : undefined;

  return (
    <div className="min-h-screen font-sans text-foreground">
      <NervecentreShell
        patient={displayedEhrPatient}
        notes={notes[ehrPatientId] ?? []}
        activity={threads
          .filter((thread) => thread.patientId === ehrPatientId)
          .flatMap((thread) =>
            thread.activity.map((entry) => ({
              ...entry,
              id: `${thread.id}:${entry.id}`,
            })),
          )}
        recordRefreshKey={ehrRevision}
        openNotesRequest={openNotesRequest}
        onAddNote={(doc, text) => addNote(ehrPatientId, text, doc, "clinician", "S. Marriott")}
        onSelectPatient={(id) => {
          setEhrPatientId(id);
          if (open) {
            setScopeId(id);
            setView("activity");
          }
        }}
      />

      {open && (
        <section
          ref={panelRef}
          className={`liquid-glass fixed z-40 flex flex-col overflow-hidden transition-all duration-300 ${
            maximized
              ? "inset-0 rounded-none"
              : "bottom-4 right-4 top-4 w-[calc(100%-2rem)] max-w-[52rem] rounded-[28px]"
          }`}
        >
          <header className="flex items-center border-b border-white/25 bg-white/12 px-4 py-3">
            <div className="flex flex-1 items-center justify-start gap-2.5">
              <button
                type="button"
                onClick={() => setMaximized((current) => !current)}
                onPointerDown={(event) => event.stopPropagation()}
                className="liquid-press flex size-8 items-center justify-center rounded-full border border-white/20 bg-white/50 text-muted-foreground shadow-sm backdrop-blur-md transition-colors hover:bg-white/80 hover:text-foreground"
                aria-label={maximized ? "Restore window" : "Maximize window"}
                title={maximized ? "Restore" : "Maximize"}
              >
                {maximized ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
              </button>
              <div className="hidden items-center gap-2 sm:flex" aria-label="Fluence">
                <span className="flex size-7 items-center justify-center rounded-full border border-white/30 bg-white/70 shadow-sm">
                  <img
                    src="/corti-hack-logo.png"
                    alt=""
                    aria-hidden="true"
                    className="size-5 object-contain"
                  />
                </span>
                <span className="text-[13px] font-semibold tracking-tight text-foreground">
                  Fluence
                </span>
              </div>
            </div>
            <ViewTabs
              value={view}
              onChange={(key) => {
                setView(key);
              }}
            />
            <div className="flex-1" />
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
                  changeImpacts={changeImpacts[scopeId] ?? null}
                  authoritativeSync={authoritativeSync[scopeId] ?? "idle"}
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
                  onOfferToTeam={offerThreadToTeam}
                  onEditThread={editThread}
                  onRemoveThread={(id, reason) => {
                    if (removeThread(id, reason)) {
                      setActiveThreadId((current) => (current === id ? null : current));
                    }
                  }}
                  staff={staff}
                  teams={teams}
                  onLoadTaskRoutingReceipt={loadTaskRoutingReceipt}
                  demoHostUnlocked={demoHostUnlocked}
                  onUnlockDemoHost={unlockDemoHost}
                  onRouteTaskNow={routeTaskNow}
                  onRefreshPatient={refreshPatientThreads}
                  onMoveToDocument={(text) => {
                    addNote(ehrPatientId, text, "medical", "scribe", "Corti Ambient draft");
                    setOpenNotesRequest((current) => current + 1);
                    setOpen(false);
                  }}
                  onBackToBoard={() => {
                    setView("board");
                    setScopeId(ehrPatientId);
                  }}
                />
              </div>
            ) : view === "insights" ? (
              <div key="insights" className="fade-in-view h-full">
                <Insights
                  threads={threads}
                  initialPatientId={ehrPatientId}
                  onOpenThread={(threadId) => {
                    const patientId =
                      threads.find((thread) => thread.id === threadId)?.patientId ?? ehrPatientId;
                    setEhrPatientId(patientId);
                    setScopeId(patientId);
                    setActiveThreadId(threadId);
                    setView("activity");
                  }}
                  onOpenPatient={(patientId) => {
                    setEhrPatientId(patientId);
                    setScopeId(patientId);
                    setView("activity");
                  }}
                />
              </div>
            ) : (
              <div key="board" className="fade-in-view flex h-full flex-col">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-border px-5 py-3">
                  <div>
                    <h1 className="text-[15px] font-medium tracking-tight">North Wing · Level 4</h1>
                    <p className="text-[12.5px] text-muted-foreground">Board ward</p>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-5">
                  <WardBoard
                    threads={threads}
                    notes={notes}
                    activePatientId={ehrPatientId}
                    bedAssignments={bedAssignments}
                    onPlacePatient={placePatient}
                    onRemovePatient={removePatientFromBed}
                    onResetPlacements={() => setBedAssignments({ ...initialBedAssignments })}
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
            <span className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-verified" />
              Live · connected to NerveCentre
              <span className="rounded-full bg-pending-soft px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-pending-strong">
                Demo data
              </span>
            </span>
            <span>← → to switch views · Esc to hide</span>
          </footer>
        </section>
      )}

      <FloatingLauncher
        open={open}
        onToggle={() => {
          setOpen((current) => {
            if (!current) {
              setMaximized(false);
              setScopeId(ehrPatientId);
              setActiveThreadId(null);
            }
            return !current;
          });
        }}
      />
    </div>
  );
}
