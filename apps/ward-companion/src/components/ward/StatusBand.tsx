import type { Thread } from "@/data/ward";

function Ring({ pct }: { pct: number }) {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg
      viewBox="0 0 72 72"
      className="h-[72px] w-[72px] -rotate-90"
      role="img"
      aria-label={`${pct}% of tracked work verified`}
    >
      <circle
        cx="36"
        cy="36"
        r={radius}
        fill="none"
        strokeWidth="8"
        className="stroke-background"
      />
      <circle
        cx="36"
        cy="36"
        r={radius}
        fill="none"
        strokeWidth="8"
        strokeLinecap="round"
        className="stroke-verified transition-[stroke-dashoffset] duration-700"
        strokeDasharray={circumference}
        strokeDashoffset={circumference - (circumference * pct) / 100}
      />
    </svg>
  );
}

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
      className={`rounded-xl border border-border border-t-2 bg-background/60 px-4 py-3 backdrop-blur-sm ${accents[tone]}`}
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
  const done = threads.filter((thread) => thread.status === "verified").length;
  const pending = threads.filter((thread) => thread.status === "pending").length;
  const escalated = threads.filter((thread) => thread.status === "escalated").length;
  const tracking = threads.filter((thread) => thread.status === "tracking").length;
  const pct = threads.length ? Math.round((done / threads.length) * 100) : 0;

  return (
    <section
      className="flex items-center gap-4 rounded-xl border border-border bg-panel/50 p-4 backdrop-blur-sm"
      aria-label="Ward follow-through status"
    >
      <div className="relative shrink-0">
        <Ring pct={pct} />
        <span
          className="absolute inset-0 flex items-center justify-center text-[17px] font-medium tabular-nums text-foreground"
          aria-hidden="true"
        >
          {pct}%
        </span>
      </div>
      <div className="grid flex-1 grid-cols-3 gap-2">
        <Tile value={tracking} label="In progress" tone="tracking" />
        <Tile value={pending} label="Needs owner" tone="pending" />
        <Tile value={escalated} label="Needs help" tone="escalated" />
      </div>
    </section>
  );
}
