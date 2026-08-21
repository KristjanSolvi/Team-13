import { useCallback, useEffect, useState } from "react";
import type { CaseNote, DocId, NewTaskOptions, Thread, ThreadStatus } from "@/data/ward";
import { initialNotes, initialThreads, patients, statusLabels } from "@/data/ward";
import { demoStaff, demoTeams } from "@/data/demo-staff";
import {
  demoActors,
  executeTaskCommand,
  FollowThroughApiError,
  getWardCompanionOverview,
  type ChangeImpact,
  type WardTaskCommand,
} from "@/lib/follow-through-api";
import { loadWardState, saveWardState } from "@/lib/ward-persistence";

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

function stamp() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Team-13-owned runtime boundary for the Lovable ward UI.
 *
 * Presentational components consume this hook's state and commands; they do not
 * own persistence, backend identities, ledger concurrency, or API calls. Keeping
 * those concerns here lets us port upstream UI files without silently replacing
 * the live integration with Lovable's local demo handlers.
 */
export function useWardRuntime() {
  const [threads, setThreads] = useState<Thread[]>(initialThreads);
  const [changeImpacts, setChangeImpacts] = useState<Record<string, ChangeImpact[]>>({});
  const [notes, setNotes] = useState<Record<string, CaseNote[]>>(initialNotes);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [ledgerBusy, setLedgerBusy] = useState<string | null>(null);
  const [ledgerErrors, setLedgerErrors] = useState<Record<string, string>>({});
  const [ehrRevision, setEhrRevision] = useState(0);

  useEffect(() => {
    const persisted = loadWardState(window.localStorage);
    if (persisted !== null) {
      // Preserve real saved work. An empty state from the earlier fixture-free
      // phase is reseeded so the hackathon demo remains useful after refresh.
      setThreads(persisted.threads.length > 0 ? persisted.threads : initialThreads);
      setNotes(persisted.notes);
    }
    setPersistenceReady(true);
  }, []);

  useEffect(() => {
    if (!persistenceReady) return;
    saveWardState(window.localStorage, { threads, notes });
  }, [notes, persistenceReady, threads]);

  const refreshPatientThreads = useCallback(async (uiPatientId: string) => {
    const patient = patients.find((candidate) => candidate.id === uiPatientId);
    if (patient === undefined || patient.backendLinked !== true) return;
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
      setChangeImpacts((current) => ({
        ...current,
        [uiPatientId]: overview.changeImpacts,
      }));
    } catch {
      // Retain current local/demo work when authoritative services are unavailable.
    }
  }, []);

  const updateThread = useCallback(
    (id: string, update: (thread: Thread) => Thread) =>
      setThreads((current) =>
        current.map((thread) => (thread.id === id ? update(thread) : thread)),
      ),
    [],
  );

  const addNote = useCallback(
    (
      patientId: string,
      text: string,
      doc: DocId = "medical",
      source: CaseNote["source"] = "agent",
      author = "Ward Threads agent",
    ) => {
      setNotes((current) => ({
        ...current,
        [patientId]: [
          ...(current[patientId] ?? []),
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
    },
    [],
  );

  const runLedgerCommand = useCallback(
    async (thread: Thread, command: WardTaskCommand) => {
      const backend = thread.backend;
      if (backend?.taskId == null || backend.taskVersion == null || ledgerBusy !== null) {
        return;
      }
      setLedgerBusy(`${command}-${thread.id}`);
      setLedgerErrors((current) => {
        const next = { ...current };
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
        const result = await executeTaskCommand({
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
        if (
          command === "approve" &&
          (result.recordDraft?.status === "created" || result.recordDraft?.status === "existing")
        ) {
          addNote(
            thread.patientId,
            `${thread.title} — Corti drafted an important-details note for clinician review in the EHR.`,
          );
          setEhrRevision((current) => current + 1);
        }
        await refreshPatientThreads(thread.patientId);
      } catch (error) {
        setLedgerErrors((current) => ({
          ...current,
          [thread.id]:
            error instanceof FollowThroughApiError
              ? `${error.message}${error.retryable ? " · safe to retry" : ""}`
              : "The ledger did not accept the command; the task is unchanged.",
        }));
      } finally {
        setLedgerBusy(null);
      }
    },
    [addNote, ledgerBusy, refreshPatientThreads],
  );

  const changeStatus = useCallback(
    (id: string, status: ThreadStatus) => {
      const thread = threads.find((candidate) => candidate.id === id);
      if (thread !== undefined) {
        addNote(
          thread.patientId,
          `${thread.title} — moved to ${statusLabels[status].toLowerCase()}.`,
        );
        if (status === "verified") {
          addNote(thread.patientId, `Completed and verified: ${thread.title}.`, "discharge");
        }
        if (status === "escalated") {
          addNote(thread.patientId, `Escalated — still outstanding: ${thread.title}.`, "discharge");
        }
      }
      updateThread(id, (current) => ({
        ...current,
        status,
        activity: [
          ...current.activity,
          {
            id: `${current.id}-${current.activity.length + 1}`,
            at: stamp(),
            actor: "You",
            text: `Moved to ${statusLabels[status].toLowerCase()}.`,
            kind: "action" as const,
          },
        ],
      }));
    },
    [addNote, threads, updateThread],
  );

  const assignThread = useCallback(
    (id: string, assignee: string | null) => {
      const thread = threads.find((candidate) => candidate.id === id);
      if (thread !== undefined) {
        addNote(
          thread.patientId,
          assignee
            ? `${thread.title} — picked up by ${assignee}.`
            : `${thread.title} — released, open to anyone free.`,
        );
      }
      updateThread(id, (current) => ({
        ...current,
        assignee,
        ...(current.backend === undefined && assignee !== null
          ? { offerState: "accepted" as const }
          : current.backend === undefined && current.offerState === "accepted"
            ? { offerState: "none" as const }
            : {}),
        activity: [
          ...current.activity,
          {
            id: `${current.id}-${current.activity.length + 1}`,
            at: stamp(),
            actor: "You",
            text: assignee ? `${assignee} picked this up.` : "Released — open to anyone free.",
            kind: "action" as const,
          },
        ],
      }));
    },
    [addNote, threads, updateThread],
  );

  const addActivity = useCallback(
    (id: string, text: string) => {
      const thread = threads.find((candidate) => candidate.id === id);
      if (thread !== undefined) addNote(thread.patientId, `${thread.title} — ${text}`);
      updateThread(id, (current) => ({
        ...current,
        activity: [
          ...current.activity,
          {
            id: `${current.id}-${current.activity.length + 1}`,
            at: stamp(),
            actor: "You",
            text,
            kind: "note" as const,
          },
        ],
      }));
    },
    [addNote, threads, updateThread],
  );

  const createThread = useCallback(
    (patientId: string, title: string, options: NewTaskOptions = {}) => {
      const id = `t-${Date.now()}`;
      const team = options.team ?? null;
      const candidates = demoStaff
        .filter((member) => team === null || member.team === team)
        .slice(0, 4)
        .map(({ name, role, free }) => ({ name, role, free }));
      setThreads((current) => [
        ...current,
        {
          id,
          patientId,
          title,
          status: "pending",
          heard: options.source === "scribe" ? "Heard on the round." : "Added by hand on the ward.",
          matters: "Flagged as worth following through to completion.",
          suggestion: team === null ? "Awaiting assignment." : `Offer this to ${team}.`,
          assignee: null,
          candidates,
          due: options.due?.trim() || "Today",
          team,
          urgency: options.urgency ?? "routine",
          detail: options.detail?.trim() || null,
          source: options.source ?? "manual",
          offerState: "none",
          offeredTo: null,
          activity: [
            { id: `${id}-1`, at: stamp(), actor: "You", text: "Thread created.", kind: "system" },
          ],
        },
      ]);
      addNote(patientId, `New thread started: ${title}. Tracking through to completion.`);
      addNote(patientId, `Outstanding before discharge: ${title}.`, "discharge");
      return id;
    },
    [addNote],
  );

  const offerThreadToTeam = useCallback(
    (id: string, team: string) => {
      updateThread(id, (thread) => {
        if (thread.backend !== undefined) return thread;
        const candidates = demoStaff
          .filter((member) => member.team === team)
          .map(({ name, role, free }) => ({ name, role, free }));
        return {
          ...thread,
          team,
          offeredTo: team,
          offerState: "offered",
          assignee: null,
          status: "pending",
          candidates: candidates.length > 0 ? candidates : thread.candidates,
          activity: [
            ...thread.activity,
            {
              id: `${thread.id}-${thread.activity.length + 1}`,
              at: stamp(),
              actor: "You",
              text: `Offered to ${team} — waiting for a member to accept.`,
              kind: "action",
            },
          ],
        };
      });
      const thread = threads.find((candidate) => candidate.id === id);
      if (thread !== undefined && thread.backend === undefined) {
        addNote(thread.patientId, `${thread.title} — offered to ${team}.`);
      }
    },
    [addNote, threads, updateThread],
  );

  const editThread = useCallback(
    (id: string, patch: Partial<Thread>) => {
      updateThread(id, (thread) => {
        if (thread.backend !== undefined) return thread;
        return {
          ...thread,
          ...patch,
          activity: [
            ...thread.activity,
            {
              id: `${thread.id}-${thread.activity.length + 1}`,
              at: stamp(),
              actor: "You",
              text: "Task details edited.",
              kind: "action",
            },
          ],
        };
      });
    },
    [updateThread],
  );

  const removeThread = useCallback(
    (id: string, reason: string) => {
      const thread = threads.find((candidate) => candidate.id === id);
      if (thread === undefined || thread.backend !== undefined) return false;
      setThreads((current) => current.filter((candidate) => candidate.id !== id));
      addNote(thread.patientId, `${thread.title} — removed (${reason}). No longer tracked.`);
      return true;
    },
    [addNote, threads],
  );

  return {
    threads,
    changeImpacts,
    notes,
    ledgerBusy,
    ledgerErrors,
    ehrRevision,
    refreshPatientThreads,
    addNote,
    runLedgerCommand,
    changeStatus,
    assignThread,
    addActivity,
    createThread,
    offerThreadToTeam,
    editThread,
    removeThread,
    staff: demoStaff,
    teams: demoTeams,
  };
}
