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
    patch.description === undefined
      ? null
      : { label: "Action", value: patch.description },
    patch.recipientTeamId === undefined
      ? null
      : { label: "Receiving team", value: patch.recipientTeamId },
    patch.ownerUserId === undefined
      ? null
      : {
          label: "Accountable owner",
          value: patch.ownerUserId ?? "Unassigned until acceptance",
        },
    patch.dueAt === undefined
      ? null
      : { label: "Deadline", value: patch.dueAt },
    patch.priority === undefined
      ? null
      : { label: "Priority", value: patch.priority },
  ];

  return fields.filter((field): field is PatchField => field !== null);
}
