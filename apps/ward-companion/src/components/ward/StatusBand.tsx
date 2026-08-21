import type { Thread } from "@/data/ward";

function Tile({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "pending" | "escalated" | "tracking";
}) {
  const accents = {
    pending: "border-t-pending/40",
    escalated: "border-t-escalated/40",
    tracking: "border-t-tracking/40",
  } as const;
  return (
    <div
      className={`rounded-xl border border-border border-t-4 bg-background/60 px-4 py-3 backdrop-blur-sm ${accents[tone]}`}
    >
      <p className="text-[30px] font-medium leading-none tracking-tight tabular-nums text-foreground">
        {value}
      </p>
      <p className="mt-1.5 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

export function StatusBand({ threads }: { threads: Thread[] }) {
  const escalated = threads.filter(
    (thread) => thread.status === "escalated" || thread.due.toLowerCase().startsWith("yesterday"),
  ).length;
  const needsAction = threads.filter(
    (thread) => thread.status === "pending" && !thread.due.toLowerCase().startsWith("yesterday"),
  ).length;
  const inProgress = threads.filter((thread) => thread.status === "tracking").length;

  return (
    <section className="rounded-xl border border-border bg-panel/50 p-4 backdrop-blur-sm">
      <div className="grid grid-cols-3 gap-2">
        <Tile value={escalated} label="Escalated" tone="escalated" />
        <Tile value={needsAction} label="Needs action" tone="pending" />
        <Tile value={inProgress} label="In progress" tone="tracking" />
      </div>
    </section>
  );
}
