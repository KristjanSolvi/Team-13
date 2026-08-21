import { useEffect, useState } from "react";
import { CircleAlert, LoaderCircle, Route, ShieldCheck, TimerReset } from "lucide-react";

import {
  demoActors,
  getTaskRoutingReceipt,
  routeDemoTaskNow,
  type TaskRoutingReceipt,
} from "@/lib/follow-through-api";
import { RoutingReceipt } from "./RoutingReceipt";

type Props = {
  taskId: string;
  taskVersion: number;
  taskState: "offered_to_team" | "assigned_to_member" | "accepted" | "completed" | "verified";
  onRouted: () => Promise<void>;
};

const routingChecks = [
  "Right team",
  "On shift",
  "Available now",
  "Right skill",
  "Within capacity",
] as const;

const triggerLabels: Record<TaskRoutingReceipt["trigger"], string> = {
  team_acceptance_timeout: "No one claimed it before the team deadline",
  member_declined: "The previous owner declined, so Fluence safely rerouted it",
  audience_demo: "Chosen from the clinician-selected audience group",
};

export function SmartRoutingPanel({ taskId, taskVersion, taskState, onRouted }: Props) {
  const [receipt, setReceipt] = useState<TaskRoutingReceipt | null>(null);
  const [loading, setLoading] = useState(taskState !== "offered_to_team");
  const [routing, setRouting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (taskState === "offered_to_team") {
      setReceipt(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void getTaskRoutingReceipt(taskId, crypto.randomUUID())
      .then((result) => {
        if (!active) return;
        setReceipt(result.receipt);
        setError(null);
      })
      .catch(() => {
        if (active) setError("The assignment receipt could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [taskId, taskState, taskVersion]);

  const routeNow = async () => {
    setRouting(true);
    setError(null);
    try {
      const result = await routeDemoTaskNow({
        taskId,
        actorId: demoActors.clinician,
        idempotencyKey: `smart-route-${crypto.randomUUID()}`,
        correlationId: crypto.randomUUID(),
      });
      setReceipt(result.receipt);
      await onRouted();
    } catch {
      setError("Smart assignment could not run. Refresh the task and try once more.");
    } finally {
      setRouting(false);
    }
  };

  if (taskState === "offered_to_team") {
    return (
      <section className="overflow-hidden rounded-lg border border-teal/25 bg-teal/[0.035]">
        <div className="flex flex-wrap items-start justify-between gap-3 px-3 py-3">
          <div className="max-w-lg">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
              <Route className="size-3.5 text-teal" /> Smart assignment is armed
            </p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
              If nobody claims this team task, Fluence evaluates the live roster and assigns the
              most appropriate available person. It never picks randomly.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void routeNow()}
            disabled={routing}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-teal px-3 py-2 text-[11px] font-medium text-panel disabled:opacity-45"
          >
            {routing ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <TimerReset className="size-3.5" />
            )}
            {routing ? "Evaluating roster…" : "Demo smart assignment"}
          </button>
        </div>
        <div className="flex flex-wrap gap-1 border-t border-teal/15 px-3 py-2">
          {routingChecks.map((check) => (
            <span
              key={check}
              className="flex items-center gap-1 rounded-full bg-panel px-2 py-0.5 text-[9.5px] font-medium text-muted-foreground"
            >
              <ShieldCheck className="size-2.5 text-teal" /> {check}
            </span>
          ))}
          <span className="ml-auto self-center text-[9px] text-muted-foreground">
            Demo control advances synthetic time to the existing team deadline
          </span>
        </div>
        {error !== null && (
          <p className="flex items-center gap-1.5 border-t border-border px-3 py-2 text-[10.5px] text-escalated-strong">
            <CircleAlert className="size-3" /> {error}
          </p>
        )}
      </section>
    );
  }

  if (loading) {
    return (
      <p className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[10.5px] text-muted-foreground">
        <LoaderCircle className="size-3 animate-spin" /> Loading assignment reasoning…
      </p>
    );
  }

  if (receipt === null) {
    return error === null ? null : (
      <p className="flex items-center gap-1.5 text-[10.5px] text-escalated-strong">
        <CircleAlert className="size-3" /> {error}
      </p>
    );
  }

  return (
    <RoutingReceipt
      decision={receipt.routingDecision}
      title="Why Fluence chose this owner"
      triggerLabel={triggerLabels[receipt.trigger]}
    />
  );
}
