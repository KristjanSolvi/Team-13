import { useMemo } from "react";
import type { Thread } from "@/data/ward";
import { bays, patients, staff, statusLabels } from "@/data/ward";

type Props = { threads: Thread[]; onOpenPatient: (id: string) => void };

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

function Bar({ value, total }: { value: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((value / total) * 100);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
      <div className="h-full rounded-full bg-teal" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Insights({ threads, onOpenPatient }: Props) {
  const done = threads.filter((t) => t.status === "verified");
  const open = threads.filter((t) => t.status !== "verified");
  const escalated = threads.filter((t) => t.status === "escalated");
  const unowned = open.filter((t) => !t.assignee);

  const teams = useMemo(() => {
    const map = new Map<string, { total: number; free: number }>();
    for (const s of staff) {
      const existing = map.get(s.team) ?? { total: 0, free: 0 };
      existing.total += 1;
      if (s.free) existing.free += 1;
      map.set(s.team, existing);
    }
    return Array.from(map.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  const goingHome = patients.filter((p) => p.homeTomorrow);
  const blocked = goingHome.filter((p) =>
    open.some((t) => t.patientId === p.id),
  );

  const occupied = bays.flatMap((b) => b.beds).filter((b) => b.patientId).length;
  const totalBeds = bays.flatMap((b) => b.beds).length;

  return (
    <div className="h-full space-y-4 overflow-y-auto p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Block title="Task completion today">
          <p className="text-2xl font-medium tracking-tight text-foreground">
            {done.length}
            <span className="text-base text-muted-foreground">/{threads.length} closed</span>
          </p>
          <div className="mt-3">
            <Bar value={done.length} total={threads.length} />
          </div>
          <dl className="mt-3 space-y-1 text-[12.5px] text-muted-foreground">
            <div className="flex justify-between">
              <dt>Still open</dt>
              <dd className="text-foreground">{open.length}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Median time to close</dt>
              <dd className="text-foreground">2h 10m</dd>
            </div>
            <div className="flex justify-between">
              <dt>Past their deadline</dt>
              <dd className="text-foreground">{escalated.length}</dd>
            </div>
          </dl>
        </Block>

        <Block title="Available staff">
          <ul className="space-y-2">
            {teams.map((team) => (
              <li key={team.name} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="truncate text-foreground">{team.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {team.free}/{team.total} free
                  </span>
                </div>
                <Bar value={team.free} total={team.total} />
              </li>
            ))}
          </ul>
          {unowned.length > 0 && (
            <p className="mt-3 text-[12.5px] text-muted-foreground">
              {unowned.length} task{unowned.length === 1 ? "" : "s"} with no owner yet — offer them
              to a free team.
            </p>
          )}
        </Block>

        <Block title="Patient flow">
          <dl className="space-y-1.5 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Beds occupied</dt>
              <dd className="text-foreground">
                {occupied}/{totalBeds}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Planned home tomorrow</dt>
              <dd className="text-foreground">{goingHome.length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Blocked by open work</dt>
              <dd className="text-foreground">{blocked.length}</dd>
            </div>
          </dl>
          <ul className="mt-3 space-y-1.5">
            {blocked.map((p) => {
              const blockers = open.filter((t) => t.patientId === p.id);
              return (
                <li key={p.id}>
                  <button
                    onClick={() => onOpenPatient(p.id)}
                    className="w-full rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-background"
                  >
                    <span className="block text-[13px] text-foreground">
                      Bed {p.bed} — {p.name}
                    </span>
                    <span className="block truncate text-[12.5px] text-muted-foreground">
                      waiting on {blockers.map((b) => b.title.toLowerCase()).join(", ")}
                    </span>
                  </button>
                </li>
              );
            })}
            {blocked.length === 0 && (
              <li className="text-[12.5px] text-muted-foreground">
                Nothing blocking tomorrow's discharges.
              </li>
            )}
          </ul>
        </Block>

        <Block title="Where work waits">
          <ul className="space-y-2">
            {(["escalated", "pending", "tracking"] as const).map((s) => {
              const group = threads.filter((t) => t.status === s);
              return (
                <li key={s} className="space-y-1">
                  <div className="flex items-baseline justify-between text-[13px]">
                    <span className="text-foreground">{statusLabels[s]}</span>
                    <span className="text-muted-foreground">{group.length}</span>
                  </div>
                  <Bar value={group.length} total={Math.max(1, threads.length)} />
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
            Longest wait sits with items needing a clinician's yes/no — surfacing them earlier
            shortens the whole chain.
          </p>
        </Block>
      </div>
    </div>
  );
}
