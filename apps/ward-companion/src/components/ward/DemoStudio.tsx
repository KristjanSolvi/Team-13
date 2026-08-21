import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  FileCheck2,
  LoaderCircle,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import type { Thread } from "@/data/ward";
import { RoutingReceipt } from "./RoutingReceipt";
import {
  assignDemoTask,
  createDemoSession,
  demoActors,
  FollowThroughApiError,
  getDemoSession,
  type DemoScenario,
  type DemoSession,
} from "@/lib/follow-through-api";

type Props = {
  threads: Thread[];
  onRefreshPatient: (patientId: string) => Promise<void>;
  onOpenPatient: (patientId: string, threadId?: string) => void;
};

const sessionStorageKey = "fluence:audience-demo-session:v1";
const demoPatientId = "p9";
const demoTeamId = "district-nursing";

const scenarioOptions: Array<{
  id: DemoScenario;
  title: string;
  description: string;
}> = [
  {
    id: "meeting",
    title: "Ward meeting",
    description: "A multidisciplinary round turns spoken commitments into owned work.",
  },
  {
    id: "discharge_coordination",
    title: "Discharge coordination",
    description: "The audience receives one real blocker from the discharge pathway.",
  },
  {
    id: "ward_consultation",
    title: "Solo / duo consultation",
    description: "Small groups demonstrate deterministic routing and clear ownership.",
  },
];

function displayError(error: unknown): string {
  if (error instanceof FollowThroughApiError) {
    return `${error.message}${error.retryable ? " · safe to retry" : ""}`;
  }
  return "The demo service could not complete this step.";
}

function groupLabel(groupId: string): string {
  return `Group ${groupId.replace(/^group-/, "")}`;
}

function scenarioLabel(scenario: DemoScenario): string {
  return scenarioOptions.find((option) => option.id === scenario)?.title ?? "Audience demo";
}

function teamLabel(teamId: string): string {
  return teamId
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function DemoStudio({ threads, onRefreshPatient, onOpenPatient }: Props) {
  const [scenario, setScenario] = useState<DemoScenario>("discharge_coordination");
  const [groupSize, setGroupSize] = useState<1 | 2>(2);
  const [session, setSession] = useState<DemoSession | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [busy, setBusy] = useState<"restore" | "create" | "refresh" | "assign" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [lastAssignment, setLastAssignment] = useState<string | null>(null);

  const assignableTasks = useMemo(
    () =>
      threads.filter(
        (thread) =>
          thread.backend?.taskId != null &&
          thread.backend.taskVersion != null &&
          thread.backend?.taskState === "offered_to_team" &&
          thread.backend.targetTeamId === (session?.targetTeamId ?? demoTeamId),
      ),
    [session?.targetTeamId, threads],
  );

  const joinUrl =
    session === null || typeof window === "undefined"
      ? ""
      : new URL(session.joinPath, window.location.origin).toString();
  const latestAssignment = session?.assignments.at(-1) ?? null;

  const refreshSession = useCallback(
    async (sessionId: string, mode: "restore" | "refresh" = "refresh") => {
      setBusy(mode);
      try {
        const current = await getDemoSession(sessionId, crypto.randomUUID());
        setSession(current);
        setSelectedGroupId((selected) =>
          current.groups.some((group) => group.groupId === selected)
            ? selected
            : (current.groups[0]?.groupId ?? ""),
        );
        setError(null);
      } catch (caught) {
        setError(displayError(caught));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  useEffect(() => {
    void onRefreshPatient(demoPatientId);
    const storedSessionId = window.localStorage.getItem(sessionStorageKey);
    if (storedSessionId !== null) void refreshSession(storedSessionId, "restore");
  }, [onRefreshPatient, refreshSession]);

  useEffect(() => {
    if (session === null) return;
    const timer = window.setInterval(() => {
      void getDemoSession(session.sessionId, crypto.randomUUID())
        .then((current) => {
          setSession(current);
          setSelectedGroupId((selected) =>
            current.groups.some((group) => group.groupId === selected)
              ? selected
              : (current.groups[0]?.groupId ?? ""),
          );
        })
        .catch(() => undefined);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [session]);

  useEffect(() => {
    setSelectedTaskId((selected) =>
      assignableTasks.some((thread) => thread.backend?.taskId === selected)
        ? selected
        : (assignableTasks[0]?.backend?.taskId ?? ""),
    );
  }, [assignableTasks]);

  const startSession = async () => {
    setBusy("create");
    setError(null);
    setLastAssignment(null);
    try {
      const created = await createDemoSession({
        title: `${scenarioLabel(scenario)} · Fluence live demo`,
        scenario,
        groupSize,
        targetTeamId: demoTeamId,
        actorId: demoActors.clinician,
        correlationId: crypto.randomUUID(),
      });
      window.localStorage.setItem(sessionStorageKey, created.sessionId);
      setSession(created);
      setSelectedGroupId(created.groups[0]?.groupId ?? "");
    } catch (caught) {
      setError(displayError(caught));
    } finally {
      setBusy(null);
    }
  };

  const copyInvite = async () => {
    if (joinUrl === "") return;
    await navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  const assign = async () => {
    if (session === null || selectedGroupId === "" || selectedTaskId === "") return;
    const task = assignableTasks.find((thread) => thread.backend?.taskId === selectedTaskId);
    if (task?.backend?.taskId == null || task.backend.taskVersion == null) return;
    setBusy("assign");
    setError(null);
    try {
      const result = await assignDemoTask({
        sessionId: session.sessionId,
        groupId: selectedGroupId,
        taskId: task.backend.taskId,
        expectedVersion: task.backend.taskVersion,
        actorId: demoActors.clinician,
        correlationId: crypto.randomUUID(),
      });
      setLastAssignment(
        `${task.title} → ${result.participant.displayName} in ${groupLabel(result.participant.groupId)}`,
      );
      await Promise.all([refreshSession(session.sessionId), onRefreshPatient(task.patientId)]);
    } catch (caught) {
      setError(displayError(caught));
      setBusy(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      <section className="rounded-2xl border border-border bg-panel">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-3.5">
          <div>
            <h2 className="flex items-center gap-2 text-[14px] font-medium text-foreground">
              <Users className="size-4 text-teal" /> Live audience interaction
            </h2>
            <p className="mt-0.5 max-w-xl text-[11.5px] leading-relaxed text-muted-foreground">
              Guests scan once, enter solo or duo groups, then one participant receives an actual
              clinician-approved task from the live ledger.
            </p>
          </div>
          {session !== null && (
            <button
              type="button"
              onClick={() => void refreshSession(session.sessionId)}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11.5px] font-medium text-foreground disabled:opacity-45"
            >
              <RefreshCw className={`size-3 ${busy === "refresh" ? "animate-spin" : ""}`} />
              Refresh groups
            </button>
          )}
        </header>

        {session === null ? (
          <div className="space-y-4 px-5 py-4">
            <div className="grid gap-2 sm:grid-cols-3">
              {scenarioOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setScenario(option.id)}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    scenario === option.id
                      ? "border-teal/45 bg-teal/5"
                      : "border-border bg-background hover:border-teal/25"
                  }`}
                >
                  <span className="text-[12.5px] font-medium text-foreground">{option.title}</span>
                  <span className="mt-1 block text-[10.5px] leading-relaxed text-muted-foreground">
                    {option.description}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl bg-background px-3.5 py-3">
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Group format
                </span>
                <div className="mt-1.5 flex gap-1.5">
                  {([1, 2] as const).map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setGroupSize(size)}
                      className={`rounded-md px-3 py-1.5 text-[11.5px] font-medium ${
                        groupSize === size
                          ? "bg-foreground text-background"
                          : "border border-border bg-panel text-foreground"
                      }`}
                    >
                      {size === 1 ? "Solo" : "Duo"}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void startSession()}
                disabled={busy !== null}
                className="flex items-center gap-1.5 rounded-md bg-teal px-3.5 py-2 text-[12.5px] font-medium text-panel disabled:opacity-45"
              >
                {busy === "create" ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <QrCode className="size-3.5" />
                )}
                Create audience room
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-px bg-border lg:grid-cols-[220px_1fr]">
            <div className="bg-panel p-4">
              <div className="rounded-xl border border-border bg-white p-3">
                <QRCodeSVG
                  value={joinUrl}
                  size={168}
                  level="M"
                  marginSize={1}
                  className="mx-auto h-auto w-full"
                  aria-label="Audience join QR code"
                />
              </div>
              <p className="mt-2 text-center text-[10px] uppercase tracking-wide text-muted-foreground">
                Scan to join · code
              </p>
              <p className="text-center text-[16px] font-semibold tracking-[0.16em] text-foreground">
                {session.joinCode}
              </p>
              <button
                type="button"
                onClick={() => void copyInvite()}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11.5px] font-medium text-foreground"
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? "Invite copied" : "Copy invite link"}
              </button>
              <p className="mt-2 text-center text-[10px] text-muted-foreground">
                {scenarioLabel(session.scenario)} · {session.groupSize === 1 ? "solo" : "duo"}{" "}
                groups
              </p>
            </div>

            <div className="space-y-4 bg-panel px-4 py-4">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Live groups ·{" "}
                    {session.groups.reduce((sum, group) => sum + group.participants.length, 0)}{" "}
                    joined
                  </h3>
                  <span className="text-[10.5px] text-muted-foreground">
                    Routing team: {teamLabel(session.targetTeamId)}
                  </span>
                </div>
                {session.groups.length === 0 ? (
                  <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-4 text-center text-[11.5px] text-muted-foreground">
                    Waiting for the first scan. Groups appear here automatically.
                  </p>
                ) : (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {session.groups.map((group) => (
                      <button
                        key={group.groupId}
                        type="button"
                        onClick={() => setSelectedGroupId(group.groupId)}
                        className={`rounded-lg border px-3 py-2 text-left ${
                          selectedGroupId === group.groupId
                            ? "border-teal/45 bg-teal/5"
                            : "border-border bg-background"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2 text-[11.5px] font-medium text-foreground">
                          {groupLabel(group.groupId)}
                          <span className="text-[10px] text-muted-foreground">
                            {group.participants.length}/{session.groupSize}
                          </span>
                        </span>
                        <span className="mt-1 block truncate text-[10.5px] text-muted-foreground">
                          {group.participants
                            .map((participant) => participant.displayName)
                            .join(" + ")}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-border bg-background p-3">
                <h3 className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
                  <ShieldCheck className="size-3.5 text-teal" /> Assign only after clinician
                  approval
                </h3>
                <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
                  Corti Agentic proposes work through scoped MCP. The audience receives it only
                  after the clinician approves and publishes it to {teamLabel(session.targetTeamId)}
                  .
                </p>

                {assignableTasks.length > 0 && session.groups.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <select
                      value={selectedTaskId}
                      onChange={(event) => setSelectedTaskId(event.target.value)}
                      aria-label="Approved task"
                      className="min-w-0 flex-1 rounded-md border border-border bg-panel px-2.5 py-2 text-[11.5px] text-foreground"
                    >
                      {assignableTasks.map((thread) => (
                        <option key={thread.backend?.taskId} value={thread.backend?.taskId ?? ""}>
                          {thread.title}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void assign()}
                      disabled={busy !== null || selectedGroupId === "" || selectedTaskId === ""}
                      className="flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-[11.5px] font-medium text-background disabled:opacity-45"
                    >
                      {busy === "assign" ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <ArrowRight className="size-3.5" />
                      )}
                      Assign to {selectedGroupId === "" ? "group" : groupLabel(selectedGroupId)}
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-panel px-3 py-2">
                    <p className="text-[10.5px] text-muted-foreground">
                      {session.groups.length === 0
                        ? "Waiting for an audience group before assignment."
                        : "No approved team task is waiting yet. Capture Karen’s follow-through, then approve it in Main."}
                    </p>
                    <button
                      type="button"
                      onClick={() => onOpenPatient(demoPatientId)}
                      className="shrink-0 text-[11px] font-medium text-teal"
                    >
                      Open Karen’s flow
                    </button>
                  </div>
                )}

                {lastAssignment !== null && (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-verified-strong">
                    <Check className="size-3.5" /> {lastAssignment}
                  </p>
                )}
              </div>

              {session.assignments.length > 0 && (
                <div>
                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Assignment receipt
                  </h3>
                  <ul className="mt-1.5 space-y-1">
                    {session.assignments.map((assignment) => {
                      const participant = session.groups
                        .flatMap((group) => group.participants)
                        .find((candidate) => candidate.participantId === assignment.participantId);
                      const thread = threads.find(
                        (candidate) => candidate.backend?.taskId === assignment.taskId,
                      );
                      return (
                        <li
                          key={assignment.assignmentId}
                          className="flex items-center gap-2 text-[10.5px] text-muted-foreground"
                        >
                          <FileCheck2 className="size-3 text-verified-strong" />
                          <span className="font-medium text-foreground">
                            {thread?.title ?? "Approved task"}
                          </span>
                          <ArrowRight className="size-3" />
                          <span>{participant?.displayName ?? groupLabel(assignment.groupId)}</span>
                        </li>
                      );
                    })}
                  </ul>
                  {latestAssignment?.routingDecision != null && (
                    <RoutingReceipt
                      decision={latestAssignment.routingDecision}
                      participants={session.groups.flatMap((group) => group.participants)}
                      triggerLabel="Chosen from this clinician-selected audience group"
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {error !== null && (
          <p
            role="alert"
            className="border-t border-border px-5 py-2.5 text-[11.5px] text-escalated-strong"
          >
            {error}
          </p>
        )}

        {session !== null && (
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-2.5 text-[10.5px] text-muted-foreground">
            <span>
              Real grouping and ledger assignment · no participant sees the patient record or MCP
              credentials.
            </span>
            <button
              type="button"
              onClick={() => {
                window.localStorage.removeItem(sessionStorageKey);
                setSession(null);
                setLastAssignment(null);
                setError(null);
              }}
              className="font-medium text-foreground"
            >
              Start another room
            </button>
          </footer>
        )}
      </section>
    </div>
  );
}
