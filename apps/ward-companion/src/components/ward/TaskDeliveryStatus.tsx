import { useEffect, useState } from "react";
import { Check, CircleAlert, LoaderCircle, RefreshCw, Send } from "lucide-react";

import { getTaskDeliveries, type DownstreamDelivery } from "@/lib/follow-through-api";

type Props = {
  taskId: string;
  taskVersion: number;
};

const statusLabels: Record<DownstreamDelivery["status"], string> = {
  pending_submission: "Waiting to submit",
  submission_failed: "Submission failed",
  submitted: "Submitted",
  accepted: "Accepted by receiving system",
  completed: "Completed by receiving system",
  rejected: "Rejected by receiving system",
};

function terminal(status: DownstreamDelivery["status"]): boolean {
  return status === "completed" || status === "rejected";
}

export function TaskDeliveryStatus({ taskId, taskVersion }: Props) {
  const [deliveries, setDeliveries] = useState<DownstreamDelivery[] | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    const refresh = async () => {
      setRefreshing(true);
      try {
        const result = await getTaskDeliveries(taskId, crypto.randomUUID());
        if (!active) return;
        setDeliveries(result.deliveries);
        setError(false);
        if (result.deliveries.some((delivery) => !terminal(delivery.status))) {
          timer = window.setTimeout(() => void refresh(), 5_000);
        }
      } catch {
        if (!active) return;
        setError(true);
      } finally {
        if (active) setRefreshing(false);
      }
    };

    void refresh();
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [taskId, taskVersion]);

  if (deliveries === null && !error) {
    return (
      <p className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <LoaderCircle className="size-3 animate-spin" /> Checking receiving-system delivery…
      </p>
    );
  }

  if (error) {
    return (
      <p className="flex items-center gap-1.5 text-[10.5px] text-escalated-strong">
        <CircleAlert className="size-3" /> Delivery status unavailable; task state is unchanged.
      </p>
    );
  }

  if (deliveries?.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        <Send className="size-3" /> No receiving-system delivery has been created for this task.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-panel px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[10.5px] font-medium text-foreground">
          <Send className="size-3 text-teal" /> Receiving-system delivery
        </p>
        {refreshing && <RefreshCw className="size-3 animate-spin text-muted-foreground" />}
      </div>
      <ul className="mt-1.5 space-y-1.5">
        {deliveries?.map((delivery) => (
          <li key={delivery.deliveryId} className="text-[10.5px] text-muted-foreground">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              {delivery.status === "completed" && delivery.sourceAcknowledgedAt !== null ? (
                <Check className="size-3 text-verified-strong" />
              ) : (
                <span className="size-1.5 rounded-full bg-tracking" />
              )}
              {delivery.targetSystem} · {statusLabels[delivery.status]}
            </span>
            {delivery.status === "completed" && delivery.sourceAcknowledgedAt === null && (
              <span className="mt-0.5 block pl-4">
                Provider completed · awaiting independent ledger verification
              </span>
            )}
            {delivery.statusReason !== null && (
              <span className="mt-0.5 block pl-4">{delivery.statusReason}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
