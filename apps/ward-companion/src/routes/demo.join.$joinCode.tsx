import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  LoaderCircle,
  ShieldCheck,
  Users,
} from "lucide-react";

import {
  FollowThroughApiError,
  getDemoParticipantView,
  joinDemoSession,
  type DemoParticipantView,
} from "@/lib/follow-through-api";

export const Route = createFileRoute("/demo/join/$joinCode")({
  head: () => ({
    meta: [
      { title: "Join the Fluence audience demo" },
      {
        name: "description",
        content: "Join a live Fluence group and receive a clinician-approved ward task.",
      },
    ],
  }),
  component: AudienceJoin,
});

const joinKeyStorageKey = "fluence:demo-browser-key:v1";

function participantTokenStorageKey(joinCode: string): string {
  return `fluence:demo-participant:${joinCode.toUpperCase()}:v1`;
}

function groupLabel(groupId: string): string {
  return `Group ${groupId.replace(/^group-/, "")}`;
}

function displayError(error: unknown): string {
  if (error instanceof FollowThroughApiError) {
    if (error.code === "DEMO_SESSION_NOT_FOUND") {
      return "That audience room has closed or the join code is not valid.";
    }
    return `${error.message}${error.retryable ? " You can safely try again." : ""}`;
  }
  return "The audience room could not be reached. Please try again.";
}

function dueLabel(value: string): string {
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return value;
  return due.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function AudienceJoin() {
  const { joinCode } = Route.useParams();
  const normalizedCode = joinCode.trim().toUpperCase();
  const [displayName, setDisplayName] = useState("");
  const [participantToken, setParticipantToken] = useState<string | null>(null);
  const [view, setView] = useState<DemoParticipantView | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (token: string) => {
    const next = await getDemoParticipantView(token, crypto.randomUUID());
    setView(next);
    setError(null);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(participantTokenStorageKey(normalizedCode));
    if (stored === null) {
      setRestoring(false);
      return;
    }
    setParticipantToken(stored);
    void refresh(stored)
      .catch((caught) => {
        window.localStorage.removeItem(participantTokenStorageKey(normalizedCode));
        setParticipantToken(null);
        setError(displayError(caught));
      })
      .finally(() => setRestoring(false));
  }, [normalizedCode, refresh]);

  useEffect(() => {
    if (participantToken === null || view === null) return;
    const timer = window.setInterval(() => {
      void refresh(participantToken).catch((caught) => setError(displayError(caught)));
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [participantToken, refresh, view]);

  const join = async () => {
    const name = displayName.trim();
    if (name.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      let joinKey = window.localStorage.getItem(joinKeyStorageKey);
      if (joinKey === null) {
        joinKey = crypto.randomUUID();
        window.localStorage.setItem(joinKeyStorageKey, joinKey);
      }
      const joined = await joinDemoSession({
        joinCode: normalizedCode,
        displayName: name,
        joinKey,
        correlationId: crypto.randomUUID(),
      });
      window.localStorage.setItem(
        participantTokenStorageKey(normalizedCode),
        joined.participantToken,
      );
      setParticipantToken(joined.participantToken);
      await refresh(joined.participantToken);
    } catch (caught) {
      setError(displayError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-background px-4 py-8 text-foreground sm:py-14">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-teal/10 to-transparent" />
      <div className="relative mx-auto w-full max-w-lg">
        <header className="mb-5 text-center">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-teal"
          >
            <span className="flex size-8 items-center justify-center rounded-full border border-teal/15 bg-white/80 shadow-sm">
              <img
                src="/corti-hack-logo.png"
                alt=""
                aria-hidden="true"
                className="size-5 object-contain"
              />
            </span>
            <span>Fluence</span>
          </Link>
          <h1 className="mt-2 text-2xl font-medium tracking-tight">Join the live ward demo</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Enter as an audience group. If your group is selected, a real clinician-approved task
            will arrive here.
          </p>
        </header>

        <section className="overflow-hidden rounded-2xl border border-border bg-panel shadow-xl shadow-foreground/5">
          <div className="flex items-center justify-between gap-3 border-b border-border bg-tracking-soft/50 px-5 py-3">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Users className="size-4 text-teal" /> Audience room
            </span>
            <span className="rounded-full border border-border bg-panel px-2.5 py-1 text-xs font-semibold tracking-[0.12em]">
              {normalizedCode}
            </span>
          </div>

          {restoring ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-sm text-muted-foreground">
              <LoaderCircle className="size-5 animate-spin text-teal" /> Rejoining your group…
            </div>
          ) : view === null ? (
            <form
              className="space-y-4 px-5 py-5"
              onSubmit={(event) => {
                event.preventDefault();
                void join();
              }}
            >
              <div>
                <label htmlFor="display-name" className="text-xs font-medium text-foreground">
                  Your first name
                </label>
                <input
                  id="display-name"
                  autoComplete="given-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  minLength={2}
                  maxLength={48}
                  required
                  placeholder="e.g. Alex"
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-teal/25"
                />
              </div>
              <button
                type="submit"
                disabled={busy || displayName.trim().length < 2}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal px-4 py-2.5 text-sm font-medium text-panel disabled:opacity-45"
              >
                {busy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ArrowRight className="size-4" />
                )}
                {busy ? "Joining…" : "Join my group"}
              </button>
            </form>
          ) : (
            <div className="px-5 py-5">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-verified-soft text-verified-strong">
                  <CheckCircle2 className="size-5" />
                </span>
                <div>
                  <p className="text-sm font-medium">
                    You’re in {groupLabel(view.participant.groupId)}, {view.participant.displayName}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    Keep this page open—the next task assigned to you will arrive automatically.
                  </p>
                </div>
              </div>

              {view.assignments.length === 0 ? (
                <div className="mt-5 rounded-xl border border-dashed border-border bg-background px-4 py-7 text-center">
                  <LoaderCircle className="mx-auto size-5 animate-spin text-teal" />
                  <p className="mt-2 text-sm font-medium">Waiting for the clinician</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Your group is ready. Assignment stays under clinician control.
                  </p>
                </div>
              ) : (
                <div className="mt-5 space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Assigned follow-through
                  </p>
                  {view.assignments.map(({ assignment, task }) => (
                    <article
                      key={assignment.assignmentId}
                      className="rounded-xl border border-teal/30 bg-teal/5 p-4"
                    >
                      <span className="flex items-center gap-1.5 text-[11px] font-medium text-teal">
                        <ClipboardCheck className="size-3.5" /> Clinician approved
                      </span>
                      <h2 className="mt-1.5 text-base font-medium leading-snug">{task.summary}</h2>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>Due {dueLabel(task.dueBy)}</span>
                        <span className="capitalize">{task.state.replaceAll("_", " ")}</span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          {error !== null && (
            <p
              role="alert"
              className="border-t border-border px-5 py-3 text-xs text-escalated-strong"
            >
              {error}
            </p>
          )}
        </section>

        <p className="mt-4 flex items-start justify-center gap-1.5 text-center text-[11px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-teal" />
          Demo only · no patient record, clinical evidence, or integration credentials appear here.
        </p>
      </div>
    </main>
  );
}
