import { useMemo } from "react";
import type { Thread, ThreadStatus } from "@/data/ward";

type Props = { threads: Thread[] };

const workLabels: Record<Exclude<ThreadStatus, "verified">, string> = {
  escalated: "Needs help",
  pending: "Needs owner",
  tracking: "In progress",
};

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-panel p-4">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Bar({ value, total, label }: { value: number; total: number; label: string }) {
  const pct = total === 0 ? 0 : Math.round((value / total) * 100);
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-background"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={value}
    >
      <div className="h-full rounded-full bg-teal" style={{ width: `${pct}%` }} />
    </div>
  );
}

function clockMinutes(value: string) {
  if (value.toLowerCase().includes("yesterday")) return null;
  const match = value.match(/\b([01]\d|2[0-3]):([0-5]\d)\b/);
  if (!match) return null;
  const [, hours, minutes] = match;
  if (hours === undefined || minutes === undefined) return null;
  return Number(hours) * 60 + Number(minutes);
}

function closeDuration(thread: Thread) {
  const times = thread.activity
    .map((entry) => clockMinutes(entry.at))
    .filter((value): value is number => value !== null);
  if (times.length < 2) return null;
  const duration = times.at(-1)! - times[0]!;
  return duration > 0 ? duration : null;
}

function formatDuration(minutes: number | null) {
  if (minutes === null) return "Not enough data";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours === 0 ? `${remainder}m` : `${hours}h ${remainder}m`;
}

export function Insights({ threads }: Props) {
  const done = threads.filter((thread) => thread.status === "verified");
  const open = threads.filter((thread) => thread.status !== "verified");
  const escalated = threads.filter((thread) => thread.status === "escalated");
  const unowned = open.filter((thread) => !thread.assignee);
  const assigned = open.length - unowned.length;
  const trackedPatients = new Set(threads.map((thread) => thread.patientId)).size;
  const owners = new Set(
    open
      .map((thread) => thread.assignee)
      .filter((assignee): assignee is string => assignee !== null),
  ).size;

  const averageCloseMinutes = useMemo(() => {
    const durations = done
      .map(closeDuration)
      .filter((duration): duration is number => duration !== null);
    if (durations.length === 0) return null;
    return Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length);
  }, [done]);

  const workGroups = (["escalated", "pending", "tracking"] as const).map((status) => ({
    status,
    count: threads.filter((thread) => thread.status === status).length,
  }));
  const busiestGroup = [...workGroups].sort((left, right) => right.count - left.count)[0];

  if (threads.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-5">
        <section className="max-w-sm rounded-xl border border-dashed border-border bg-panel/50 px-6 py-8 text-center">
          <h2 className="text-[15px] font-medium text-foreground">No live ward threads yet</h2>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
            Insights will appear after Ambient capture or a clinician-created task adds tracked
            work.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Block title="Task completion today">
          <p className="text-2xl font-medium tracking-tight text-foreground">
            {done.length}
            <span className="text-base text-muted-foreground">/{threads.length} closed</span>
          </p>
          <div className="mt-3">
            <Bar value={done.length} total={threads.length} label="Verified work" />
          </div>
          <dl className="mt-3 space-y-1 text-[12.5px] text-muted-foreground">
            <div className="flex justify-between gap-3">
              <dt>Still open</dt>
              <dd className="text-foreground">{open.length}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Average time to close</dt>
              <dd className="text-right text-foreground">{formatDuration(averageCloseMinutes)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Past their deadline</dt>
              <dd className="text-foreground">{escalated.length}</dd>
            </div>
          </dl>
        </Block>

        <Block title="Ownership">
          <dl className="space-y-1.5 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Assigned open work</dt>
              <dd className="text-foreground">{assigned}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Needs an owner</dt>
              <dd className="text-foreground">{unowned.length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Active owners</dt>
              <dd className="text-foreground">{owners}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Patients with tracked work</dt>
              <dd className="text-foreground">{trackedPatients}</dd>
            </div>
          </dl>
        </Block>

        <Block title="Where work waits">
          <ul className="space-y-2">
            {workGroups.map(({ status, count }) => (
              <li key={status} className="space-y-1">
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="text-foreground">{workLabels[status]}</span>
                  <span className="text-muted-foreground">{count}</span>
                </div>
                <Bar
                  value={count}
                  total={Math.max(1, open.length)}
                  label={`${workLabels[status]} tasks`}
                />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
            {busiestGroup && busiestGroup.count > 0
              ? `${workLabels[busiestGroup.status]} is the largest open queue with ${busiestGroup.count} item${busiestGroup.count === 1 ? "" : "s"}.`
              : "No open work is waiting on the ward."}
          </p>
        </Block>
      </div>
    </div>
  );
}
