import type { Thread } from "@/data/ward";

function Tile({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "pending" | "escalated" | "tracking" | "verified";
}) {
  const accents = {
    pending: "border-t-pending/40",
    escalated: "border-t-escalated/40",
    tracking: "border-t-tracking/40",
    verified: "border-t-verified/40",
  } as const;

  return (
    <div
      className={`rounded-xl border border-border border-t-4 bg-background/60 px-4 py-3 backdrop-blur-sm ${accents[tone]}`}
      aria-label={`${value} ${label}`}
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
  const pending = threads.filter((thread) => thread.status === "pending").length;
  const escalated = threads.filter((thread) => thread.status === "escalated").length;
  const tracking = threads.filter((thread) => thread.status === "tracking").length;
  const verified = threads.filter((thread) => thread.status === "verified").length;

  return (
    <section
      className="rounded-xl border border-border bg-panel/50 p-4 backdrop-blur-sm"
      aria-label="Ward follow-through status"
    >
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile value={escalated} label="Overdue / escalated" tone="escalated" />
        <Tile value={pending} label="Needs action" tone="pending" />
        <Tile value={tracking} label="In progress" tone="tracking" />
        <Tile value={verified} label="Verified" tone="verified" />
      </div>
    </section>
  );
}
