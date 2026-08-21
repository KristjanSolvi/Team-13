import { Check, CircleSlash2, Gauge, Route, ShieldCheck } from "lucide-react";

import type {
  DemoParticipant,
  DemoRoutingCandidate,
  DemoRoutingDecision,
} from "@/lib/follow-through-api";

type Props = {
  decision: DemoRoutingDecision;
  participants?: DemoParticipant[];
  title?: string;
  triggerLabel?: string;
};

const exclusionLabels: Record<DemoRoutingCandidate["exclusionReasons"][number], string> = {
  wrong_team: "Different team",
  off_shift: "Off shift",
  unavailable: "Unavailable",
  at_capacity: "At capacity",
  missing_capability: "Capability mismatch",
};

function participantName(memberId: string, participants: DemoParticipant[]): string {
  const knownStaff: Record<string, string> = {
    "nurse-a": "Nurse Kelly O.",
    "nurse-b": "Nurse Ben Adeyemi",
  };
  return (
    participants.find((participant) => participant.memberId === memberId)?.displayName ??
    knownStaff[memberId] ??
    memberId
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function capabilityLabel(capability: string): string {
  return capability
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function RoutingReceipt({
  decision,
  participants = [],
  title = "Explainable routing receipt",
  triggerLabel,
}: Props) {
  const selected = decision.candidates.find(
    (candidate) => candidate.memberId === decision.selectedMemberId,
  );
  if (selected === undefined) return null;

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-teal/20 bg-teal/[0.035]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-teal/15 px-3 py-2">
        <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-teal">
          <Route className="size-3.5" /> {title}
        </p>
        <span className="text-[9.5px] text-muted-foreground">
          availability · capability · workload
        </span>
      </div>

      <div className="px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[12px] font-medium text-foreground">
              {participantName(selected.memberId, participants)} selected
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Rank #{selected.rank} · matches{" "}
              {decision.requiredCapabilities.map(capabilityLabel).join(" + ")}
            </p>
            {triggerLabel !== undefined && (
              <p className="mt-1 flex items-center gap-1 text-[10px] font-medium text-teal">
                <ShieldCheck className="size-3" /> {triggerLabel}
              </p>
            )}
          </div>
          <span className="flex items-center gap-1 rounded-full border border-verified-strong/20 bg-verified-soft px-2 py-1 text-[10px] font-medium text-verified-strong">
            <Gauge className="size-3" /> {selected.openTaskCount}/{selected.capacity} active
          </span>
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          {[
            [selected.checks.teamMatch, "Right team"],
            [selected.checks.onShift, "On shift"],
            [selected.checks.available, "Available now"],
            [selected.checks.capabilitiesMatch, "Right skill"],
            [selected.checks.hasCapacity, "Within capacity"],
          ].map(([passed, label]) => (
            <span
              key={String(label)}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-medium ${
                passed
                  ? "bg-verified-soft text-verified-strong"
                  : "bg-escalated-soft text-escalated-strong"
              }`}
            >
              {passed ? <Check className="size-2.5" /> : <CircleSlash2 className="size-2.5" />}
              {label}
            </span>
          ))}
        </div>

        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {decision.candidates.map((candidate) => (
            <li
              key={candidate.memberId}
              className="flex items-center justify-between gap-2 rounded-md bg-panel/80 px-2 py-1.5 text-[10px]"
            >
              <span className="truncate font-medium text-foreground">
                {participantName(candidate.memberId, participants)}
              </span>
              {candidate.eligible ? (
                <span className="flex shrink-0 items-center gap-1 text-verified-strong">
                  <Check className="size-3" />
                  {candidate.memberId === decision.selectedMemberId ? "Selected" : "Eligible"} ·
                  rank {candidate.rank}
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-1 text-escalated-strong">
                  <CircleSlash2 className="size-3" />
                  {candidate.exclusionReasons.map((reason) => exclusionLabels[reason]).join(", ")}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
