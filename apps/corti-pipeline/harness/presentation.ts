import type { RevisionPatch } from "../src/contracts.js";

export interface PatchField {
  label: string;
  value: string;
}

export function appendFinalTranscript(current: string, incoming: string): string {
  return [current.trim(), incoming.trim()].filter(Boolean).join(" ");
}

export function presentRevisionPatch(patch: RevisionPatch): PatchField[] {
  const fields: Array<PatchField | null> = [
    patch.summary === undefined
      ? null
      : { label: "Action", value: patch.summary },
    patch.targetTeamId === undefined
      ? null
      : { label: "Receiving team", value: patch.targetTeamId },
    patch.dueInMs === undefined
      ? null
      : {
          label: "Deadline",
          value: `${Math.round(patch.dueInMs / 3_600_000)} hours from approval`,
        },
    patch.clinicalUrgency === undefined
      ? null
      : { label: "Clinical urgency", value: patch.clinicalUrgency },
  ];

  return fields.filter((field): field is PatchField => field !== null);
}
