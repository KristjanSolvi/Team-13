import { createHash } from "node:crypto";

export const sourceRevisionReasons = [
  "new_result",
  "medication_update",
  "clinical_note_revision",
  "other",
] as const;

export type SourceRevisionReason = (typeof sourceRevisionReasons)[number];
export type EvidenceArtifactKind = "task" | "handover";

export interface EvidenceDependency {
  dependencyId: string;
  patientId: string;
  sourceItemId: string;
  sourceRef: string;
  sourceHash: string;
  artifactKind: EvidenceArtifactKind;
  artifactId: string;
  artifactVersion: number;
  registeredAt: string;
}

export interface SourceRevision {
  revisionId: string;
  patientId: string;
  sourceItemId: string;
  sourceRef: string;
  previousHash: string;
  currentHash: string;
  reason: SourceRevisionReason;
  changedAt: string;
  changedBy: string;
}

export interface ChangeImpact {
  impactId: string;
  revisionId: string;
  dependencyId: string;
  patientId: string;
  sourceItemId: string;
  sourceRef: string;
  artifactKind: EvidenceArtifactKind;
  artifactId: string;
  artifactVersion: number;
  status: "review_required";
  summary: string;
  detectedAt: string;
  changedAt: string;
  changedBy: string;
  reason: SourceRevisionReason;
}

export function evidenceContentHash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function changeImpactSummary(
  artifactKind: EvidenceArtifactKind,
): string {
  return artifactKind === "task"
    ? "Linked evidence changed after this task was created. Review the task against the latest source; tracked work is unchanged."
    : "Linked evidence changed after this handover was generated. Review the handover against the latest source; tracked work is unchanged.";
}
