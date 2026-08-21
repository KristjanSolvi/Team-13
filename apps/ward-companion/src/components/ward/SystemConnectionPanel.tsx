import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, PlugZap, RefreshCw } from "lucide-react";

import { getIntegrationReadiness, type IntegrationReadiness } from "@/lib/follow-through-api";

const serviceRows = [
  {
    key: "pipeline",
    label: "Corti clinical pipeline",
    detail: "Ambient · FactsR · Dictation · Text Generation · Medical Coding",
  },
  {
    key: "agentic",
    label: "Corti Agentic + scoped MCP",
    detail: "Task detection · grounded handover · ward-meeting reconciliation",
  },
  {
    key: "profile",
    label: "Patient profile",
    detail: "Identity · bed and bay · patient-flow context",
  },
  {
    key: "mockEhr",
    label: "Synthetic EHR",
    detail: "Reviewed drafts · version history · explicit filing",
  },
  {
    key: "downstream",
    label: "Task delivery + verification",
    detail: "Receiving-team delivery · independent completion readback",
  },
] as const;

export function SystemConnectionPanel() {
  const [readiness, setReadiness] = useState<IntegrationReadiness | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setReadiness(await getIntegrationReadiness());
    } catch {
      setReadiness(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const serviceReady = (key: (typeof serviceRows)[number]["key"]) =>
    readiness?.services[key]?.reachable === true &&
    (key !== "pipeline" || readiness.liveCortiReady);
  const readyCount = serviceRows.filter(({ key }) => serviceReady(key)).length;

  return (
    <section className="rounded-xl border border-border bg-background/65 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 rounded-lg bg-teal/10 p-1.5 text-teal">
            <PlugZap className="size-4" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[12px] font-semibold uppercase tracking-widest text-foreground">
                System wiring
              </h3>
              <span className="rounded-full border border-current/15 px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
                {loading
                  ? "Checking"
                  : readiness === null
                    ? "Unavailable"
                    : `${readyCount}/${serviceRows.length} services ready`}
              </span>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Every core demo API has a visible review surface; this status contains no patient
              content or credentials.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 py-1.5 text-[11.5px] font-medium text-foreground hover:bg-background disabled:opacity-45"
        >
          <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {serviceRows.map(({ key, label, detail }) => {
          const reachable = serviceReady(key);
          return (
            <li
              key={key}
              className="flex items-start gap-2 rounded-lg border border-border bg-panel/70 px-2.5 py-2"
            >
              {reachable ? (
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-verified-strong" />
              ) : (
                <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0">
                <span className="block text-[11.5px] font-medium text-foreground">{label}</span>
                <span className="block text-[10.5px] leading-snug text-muted-foreground">
                  {detail}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
