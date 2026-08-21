import { useEffect, useState } from "react";
import { Check, ChevronDown, CircleAlert, LoaderCircle, ReceiptText } from "lucide-react";

import {
  cortiActivityEvent,
  cortiProductDefinitions,
  readCortiActivity,
  type CortiActivityEntry,
  type CortiActivitySnapshot,
} from "@/lib/corti-activity";

function timeLabel(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function CortiActivityReceipt() {
  const [activity, setActivity] = useState<CortiActivitySnapshot>({});

  useEffect(() => {
    setActivity(readCortiActivity());
    const onActivity = (event: Event) => {
      const entry = (event as CustomEvent<CortiActivityEntry>).detail;
      setActivity((current) => ({ ...current, [entry.product]: entry }));
    };
    const onStorage = () => setActivity(readCortiActivity());
    window.addEventListener(cortiActivityEvent, onActivity);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(cortiActivityEvent, onActivity);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const evidenced = cortiProductDefinitions.filter(
    (product) => activity[product.id]?.status !== undefined,
  ).length;

  return (
    <details className="group border-b border-white/20 bg-white/[0.07]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-2 text-[11.5px] text-muted-foreground [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 font-medium text-foreground">
          <ReceiptText className="size-3.5 text-teal" aria-hidden="true" />
          Live Corti activity receipt
          <span className="font-normal text-muted-foreground">
            {evidenced}/{cortiProductDefinitions.length} products evidenced in this browser
          </span>
        </span>
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="grid gap-px border-t border-white/15 bg-white/15 sm:grid-cols-2 lg:grid-cols-3">
        {cortiProductDefinitions.map((product) => {
          const entry = activity[product.id];
          return (
            <div key={product.id} className="bg-panel/95 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-foreground">
                  Corti {product.label}
                </span>
                {entry?.status === "active" ? (
                  <LoaderCircle className="size-3 animate-spin text-teal" aria-label="Active" />
                ) : entry?.status === "completed" ? (
                  <Check className="size-3 text-verified-strong" aria-label="Completed" />
                ) : entry?.status === "unavailable" ? (
                  <CircleAlert className="size-3 text-escalated-strong" aria-label="Unavailable" />
                ) : (
                  <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                    Not run
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {entry?.action ?? product.role}
              </p>
              {entry !== undefined && (
                <p className="mt-0.5 text-[9px] text-muted-foreground">
                  {timeLabel(entry.occurredAt)}
                  {entry.credits === undefined ? "" : ` · ${entry.credits.toFixed(4)} credits`}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="border-t border-white/15 px-5 py-1.5 text-[9px] text-muted-foreground">
        Updates only after a real API response or live SDK event. Agentic uses our authenticated,
        patient-scoped remote MCP connector.
      </p>
    </details>
  );
}
