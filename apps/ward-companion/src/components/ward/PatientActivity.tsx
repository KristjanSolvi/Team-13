import { useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronDown,
  CircleSlash,
  Plus,
  RotateCcw,
  Send,
  TriangleAlert,
  UserPlus,
} from "lucide-react";
import type { Thread, ThreadStatus } from "@/data/ward";
import { patients, staff, statusDotClass, statusLabels } from "@/data/ward";
import type { WardTaskCommand } from "@/lib/follow-through-api";
import { LiveStrip } from "./LiveStrip";
import { Spinner } from "./Loading";
import { TaskCorrectionPanel } from "./TaskCorrectionPanel";
import { usePendingAction } from "./useLoading";

type Props = {
  threads: Thread[];
  patientId: string;
  scopeId: string | null;
  onScopeChange: (id: string | null) => void;
  activeThreadId: string | null;
  onSelect: (id: string | null) => void;
  onStatusChange: (id: string, status: ThreadStatus) => void;
  onAssign: (id: string, assignee: string | null) => void;
  onLedgerCommand: (thread: Thread, command: WardTaskCommand) => void;
  ledgerBusy: string | null;
  ledgerErrors: Record<string, string>;
  onAddActivity: (id: string, text: string) => void;
  onAddThread: (patientId: string, title: string) => void;
  onSelectPatient: (id: string) => void;
  onRefreshPatient: (id: string) => Promise<void>;
  cameFromBoard?: boolean;
  onBackToBoard: () => void;
};

const kindDot: Record<string, string> = {
  system: "bg-border",
  note: "bg-tracking",
  action: "bg-verified",
};

const ledgerCommandMeta: Record<
  WardTaskCommand,
  { label: string; Icon: typeof Check; tone: string }
> = {
  approve: {
    label: "Approve & send to team",
    Icon: Check,
    tone: "bg-foreground text-background",
  },
  correct: { label: "Correct", Icon: Check, tone: "border border-border bg-panel" },
  dismiss: {
    label: "Dismiss · already covered",
    Icon: CircleSlash,
    tone: "border border-border bg-panel text-muted-foreground",
  },
  reopen: {
    label: "Reopen · 24h deadline",
    Icon: RotateCcw,
    tone: "bg-escalated-soft text-escalated-strong",
  },
  accept: { label: "Accept task", Icon: UserPlus, tone: "bg-foreground text-background" },
  decline: {
    label: "Decline",
    Icon: CircleSlash,
    tone: "border border-border bg-panel text-foreground",
  },
  complete: {
    label: "Mark completed",
    Icon: Check,
    tone: "bg-verified-soft text-verified-strong",
  },
  verify: {
    label: "Verify done",
    Icon: CheckCheck,
    tone: "bg-verified-soft text-verified-strong",
  },
};

export function PatientActivity({
  threads,
  patientId,
  scopeId,
  onScopeChange,
  activeThreadId,
  onSelect,
  onStatusChange,
  onAssign,
  onLedgerCommand,
  ledgerBusy,
  ledgerErrors,
  onAddActivity,
  onAddThread,
  onSelectPatient,
  onRefreshPatient,
  cameFromBoard,
  onBackToBoard,
}: Props) {
  const [draft, setDraft] = useState("");
  const [newTask, setNewTask] = useState("");
  const [showNewTask, setShowNewTask] = useState(false);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "mine" | "unowned" | "attention" | "done">("all");
  const { pending, run } = usePendingAction();

  const patient = patients.find((p) => p.id === patientId) ?? patients[0]!;
  const scoped = scopeId ? threads.filter((t) => t.patientId === scopeId) : threads;
  const items = scoped
    .filter((t) => {
      if (filter === "mine") return t.assignee === "You" && t.status !== "verified";
      if (filter === "unowned") return !t.assignee && t.status !== "verified";
      if (filter === "attention") return t.status === "escalated" || t.status === "pending";
      if (filter === "done") return t.status === "verified";
      return true;
    })
    .sort((a, b) => {
      const rank = (t: Thread) =>
        t.status === "escalated" ? 0 : t.status === "pending" ? 1 : t.status === "tracking" ? 2 : 3;
      return rank(a) - rank(b) || a.patientId.localeCompare(b.patientId);
    });
  const openCount = scoped.filter((t) => t.status !== "verified").length;
  const doneCount = scoped.filter((t) => t.status === "verified").length;
  const patientOf = (id: string) => patients.find((p) => p.id === id);

  const filters: { key: typeof filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: scoped.length },
    {
      key: "mine",
      label: "Mine",
      count: scoped.filter((t) => t.assignee === "You" && t.status !== "verified").length,
    },
    {
      key: "unowned",
      label: "No owner",
      count: scoped.filter((t) => !t.assignee && t.status !== "verified").length,
    },
    {
      key: "attention",
      label: "Needs attention",
      count: scoped.filter((t) => t.status === "escalated" || t.status === "pending").length,
    },
    { key: "done", label: "Done", count: doneCount },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-border px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium tracking-tight text-foreground">
              {scopeId ? (patientOf(scopeId)?.name ?? "Ward activity") : "Ward activity"}
            </p>
            <p className="text-[12.5px] text-muted-foreground">
              {scopeId
                ? `Bed ${patientOf(scopeId)?.bed} · ${patientOf(scopeId)?.bay}`
                : "All clinicians"}
              {" · "}
              {openCount} open · {doneCount} done
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {scopeId && (
              <button
                onClick={() => {
                  onScopeChange(null);
                  if (cameFromBoard) onBackToBoard();
                }}
                className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-background"
              >
                <ArrowLeft className="size-3.5" /> {cameFromBoard ? "Board" : "Whole ward"}
              </button>
            )}
            <select
              value={scopeId ?? "ward"}
              onChange={(e) => onScopeChange(e.target.value === "ward" ? null : e.target.value)}
              className="shrink-0 rounded-md border border-border bg-panel px-2.5 py-1.5 text-[12.5px] font-medium"
              aria-label="Scope activity"
            >
              <option value="ward">Whole ward</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  Bed {p.bed} — {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full border px-2.5 py-1 text-[12.5px] font-medium transition-colors ${
                filter === f.key
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-panel text-muted-foreground hover:bg-background"
              }`}
            >
              {f.label}
              <span className={filter === f.key ? "ml-1 opacity-70" : "ml-1 text-muted-foreground"}>
                {f.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <LiveStrip patient={patient} onAuthoritativeChange={() => onRefreshPatient(patient.id)} />

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {scopeId ? "Activity" : "Ward activity"}
            </h3>
            <button
              onClick={() => setShowNewTask((v) => !v)}
              className="flex items-center gap-1 text-[13px] font-medium text-teal"
            >
              <Plus className="size-3.5" /> Add task
            </button>
          </div>

          {showNewTask && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newTask.trim()) return;
                onAddThread(scopeId ?? patient.id, newTask.trim());
                setNewTask("");
                setShowNewTask(false);
              }}
              className="mb-4 flex gap-2"
            >
              <input
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                placeholder={`Task for ${(scopeId ? patientOf(scopeId)?.name : patient.name) ?? "patient"}…`}
                className="flex-1 rounded-md border border-border bg-panel px-3 py-2 text-sm"
              />
              <button className="rounded-md bg-foreground px-3 text-sm font-medium text-background">
                Add
              </button>
            </form>
          )}

          {items.length === 0 && (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13.5px] text-muted-foreground">
              Nothing here — everything in this filter is clear.
            </p>
          )}

          <ul className="relative space-y-0.5">
            {items.length > 0 && (
              <span className="absolute bottom-5 left-[5px] top-5 w-px bg-border" />
            )}
            {items.map((thread) => {
              const expanded = thread.id === activeThreadId;
              const done = thread.status === "verified";
              const suggested = thread.candidates.find((c) => c.free) ?? thread.candidates[0];
              const last = thread.activity[thread.activity.length - 1];
              return (
                <li key={thread.id} className="relative pl-6">
                  <span
                    className={`absolute left-0 top-[15px] size-[11px] rounded-full ring-4 ring-panel ${statusDotClass[thread.status]}`}
                  />
                  <button
                    onClick={() => onSelect(expanded ? null : thread.id)}
                    className="flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-background"
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-[14.5px] leading-snug ${done ? "text-muted-foreground line-through" : "font-medium text-foreground"}`}
                      >
                        {thread.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
                        {!scopeId && (
                          <span className="text-foreground/70">
                            Bed {patientOf(thread.patientId)?.bed} ·{" "}
                            {patientOf(thread.patientId)?.name.split(" ").slice(-1)[0]} ·{" "}
                          </span>
                        )}
                        {statusLabels[thread.status]} · {thread.assignee ?? "no owner"} ·{" "}
                        {thread.due} · {thread.backend === undefined ? "demo fixture" : "ledger"}
                      </span>
                    </span>
                    <ChevronDown
                      className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                  </button>

                  {!expanded && last && (
                    <p className="truncate px-2 pb-2 text-[12.5px] text-muted-foreground/80">
                      {last.at} — {last.text}
                    </p>
                  )}

                  {expanded && (
                    <div className="mb-3 space-y-4 rounded-lg border border-border bg-background px-4 py-3.5">
                      <p className="border-l-2 border-teal/40 pl-3 text-[13.5px] leading-relaxed italic text-foreground">
                        {thread.heard}
                      </p>

                      {!done &&
                        (thread.backend === undefined ||
                          thread.backend.availableCommands.includes("correct")) && (
                          <TaskCorrectionPanel
                            thread={thread}
                            onApplied={() => void onRefreshPatient(thread.patientId)}
                          />
                        )}

                      {ledgerErrors[thread.id] !== undefined && (
                        <p className="rounded-md bg-escalated-soft px-3 py-2 text-[12.5px] text-escalated-strong">
                          {ledgerErrors[thread.id]}
                        </p>
                      )}

                      {!done && thread.backend !== undefined && (
                        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                          {thread.backend.availableCommands
                            .filter((command) => command !== "correct")
                            .map((command) => {
                              const busy = ledgerBusy === `${command}-${thread.id}`;
                              const meta = ledgerCommandMeta[command];
                              return (
                                <button
                                  key={command}
                                  type="button"
                                  disabled={ledgerBusy !== null}
                                  onClick={() => onLedgerCommand(thread, command)}
                                  className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-[13px] font-medium hover:opacity-85 disabled:opacity-45 ${meta.tone}`}
                                >
                                  {busy ? (
                                    <Spinner className="size-3.5" />
                                  ) : (
                                    <meta.Icon className="size-3.5" />
                                  )}
                                  {meta.label}
                                </button>
                              );
                            })}
                        </div>
                      )}

                      {!done && thread.backend === undefined && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            disabled={pending === `assign-you-${thread.id}`}
                            onClick={() =>
                              run(`assign-you-${thread.id}`, () => {
                                onAssign(thread.id, "You");
                                onStatusChange(thread.id, "tracking");
                              })
                            }
                            className="flex flex-1 items-center justify-center gap-2 rounded-md bg-foreground py-2 text-[13.5px] font-medium text-background hover:opacity-90"
                          >
                            {pending === `assign-you-${thread.id}` ? (
                              <Spinner className="size-3.5" />
                            ) : (
                              <UserPlus className="size-3.5" />
                            )}
                            {pending === `assign-you-${thread.id}` ? "Assigning…" : "Assign to you"}
                          </button>
                          {suggested && (
                            <button
                              disabled={pending === `assign-suggested-${thread.id}`}
                              onClick={() =>
                                run(`assign-suggested-${thread.id}`, () =>
                                  onAssign(thread.id, suggested.name),
                                )
                              }
                              className="flex items-center gap-2 rounded-md border border-border bg-panel px-3 py-2 text-[13.5px] font-medium text-foreground hover:bg-background"
                            >
                              {pending === `assign-suggested-${thread.id}` && (
                                <Spinner className="size-3" />
                              )}
                              Assign to {suggested.name.split(" ")[0]}
                            </button>
                          )}
                          <button
                            onClick={() => setPickerFor(pickerFor === thread.id ? null : thread.id)}
                            className="rounded-md border border-border bg-panel px-2.5 py-2 text-[13.5px] font-medium text-muted-foreground hover:bg-background"
                            aria-label="Choose someone else"
                          >
                            …
                          </button>
                        </div>
                      )}

                      {pickerFor === thread.id && (
                        <div className="flex flex-wrap gap-1.5">
                          {staff.map((s) => (
                            <button
                              key={s.name}
                              onClick={() => {
                                onAssign(thread.id, thread.assignee === s.name ? null : s.name);
                                setPickerFor(null);
                              }}
                              className={`rounded-full border px-2.5 py-1 text-[12.5px] transition-colors ${
                                thread.assignee === s.name
                                  ? "border-teal bg-teal/10 text-teal"
                                  : "border-border bg-panel text-foreground hover:bg-background"
                              }`}
                            >
                              {s.name}
                              <span className="ml-1 text-muted-foreground">
                                {s.free ? "· free" : "· busy"}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}

                      <ul className="relative space-y-2.5 pl-4">
                        <span className="absolute bottom-1.5 left-[2px] top-1.5 w-px bg-border" />
                        {thread.activity.map((a) => (
                          <li key={a.id} className="relative">
                            <span
                              className={`absolute -left-4 top-[6px] size-[6px] rounded-full ring-2 ring-background ${kindDot[a.kind] ?? "bg-border"}`}
                            />
                            <p className="text-[13.5px] leading-snug text-foreground">{a.text}</p>
                            <span className="text-[11.5px] text-muted-foreground">
                              {a.actor} · {a.at}
                            </span>
                          </li>
                        ))}
                      </ul>

                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!draft.trim()) return;
                          onAddActivity(thread.id, draft.trim());
                          setDraft("");
                        }}
                        className="flex items-center gap-2"
                      >
                        <input
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          placeholder="Write an update…"
                          className="flex-1 rounded-md border border-border bg-panel px-3 py-2 text-[13.5px]"
                        />
                        <button
                          className="rounded-md bg-foreground p-2 text-background"
                          aria-label="Add update"
                        >
                          <Send className="size-3.5" />
                        </button>
                      </form>

                      {thread.backend === undefined && (
                        <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
                          {(
                            [
                              [
                                "verified",
                                "Verify done",
                                Check,
                                "bg-verified-soft text-verified-strong",
                              ],
                              [
                                "escalated",
                                "Ask for help",
                                TriangleAlert,
                                "bg-escalated-soft text-escalated-strong",
                              ],
                            ] as [ThreadStatus, string, typeof Check, string][]
                          ).map(([status, label, Icon, tone]) => {
                            const actionId = `${status}-${thread.id}`;
                            const busy = pending === actionId;
                            return (
                              <button
                                key={status}
                                disabled={busy}
                                onClick={() =>
                                  run(actionId, () => onStatusChange(thread.id, status))
                                }
                                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] font-medium hover:opacity-85 ${tone}`}
                              >
                                {busy ? (
                                  <Spinner className="size-3" />
                                ) : (
                                  <Icon className="size-3.5" />
                                )}
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
