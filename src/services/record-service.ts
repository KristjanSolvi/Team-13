import { createHash, randomUUID } from "node:crypto";

import {
  type ChangeImpact,
  changeImpactSummary,
  evidenceContentHash,
  type SourceRevision,
  type SourceRevisionReason,
} from "../domain/change-radar.js";
import { DomainError } from "../domain/errors.js";
import { isHandoverTaskActive } from "../domain/handover.js";
import { isDemoAudienceMember } from "../domain/routing.js";
import type { Task, Team, Thread } from "../domain/types.js";
import type { PatientRecordItem, SqliteStore } from "../infra/store.js";

export interface PatientContext {
  patientId: string;
  displayName: string;
  record: unknown;
  recordItems: PatientRecordItem[];
}

export interface EligibleTeam extends Team {
  availability: {
    onShift: number;
    availableWithCapacity: number;
  };
}

export interface RecordSourceRevisionInput {
  patientId: string;
  sourceItemId: string;
  expectedSourceRef: string;
  newText: string;
  reason: SourceRevisionReason;
  changedBy: string;
  changedAt: string;
  correlationId: string;
  idempotencyKey: string;
}

export interface RecordSourceRevisionResult {
  revision: SourceRevision;
  impacts: ChangeImpact[];
  reviewRequiredCount: number;
  replayed: boolean;
}

export class RecordService {
  constructor(private readonly store: SqliteStore) {}

  private requirePatient(contextId: string, requestedPatientId: string): void {
    const scopedPatientId = this.store.patientForContext(contextId);
    if (!scopedPatientId || scopedPatientId !== requestedPatientId) {
      throw new DomainError(
        "PATIENT_SCOPE_DENIED",
        "Patient scope is unavailable",
        false,
        403,
      );
    }
  }

  requireInteraction(contextId: string, interactionId: string): void {
    if (this.store.contextForInteraction(interactionId) !== contextId) {
      throw new DomainError(
        "CONTEXT_INTERACTION_MISMATCH",
        "Interaction scope is unavailable",
        false,
        403,
      );
    }
  }

  getPatientContext(contextId: string, patientId: string): PatientContext {
    this.requirePatient(contextId, patientId);
    const patient = this.store.getPatient(patientId);
    if (!patient) {
      throw new DomainError(
        "RECORD_LOOKUP_FAILED",
        "Patient record could not be loaded",
        true,
        503,
      );
    }
    return {
      ...patient,
      recordItems: this.store.listRecordItems(patientId),
    };
  }

  listOpenThreads(contextId: string, patientId: string): Thread[] {
    this.requirePatient(contextId, patientId);
    return this.store.listOpenThreads(patientId);
  }

  listPatientTasks(contextId: string, patientId: string): Task[] {
    this.requirePatient(contextId, patientId);
    return this.store.listPatientTasks(patientId).filter(isHandoverTaskActive);
  }

  listChangeImpacts(patientId: string): ChangeImpact[] {
    if (!this.store.getPatient(patientId)) {
      throw new DomainError(
        "PATIENT_NOT_FOUND",
        "Patient not found",
        false,
        404,
      );
    }
    return this.store.listChangeImpacts(patientId);
  }

  recordSourceRevision(
    input: RecordSourceRevisionInput,
  ): RecordSourceRevisionResult {
    const commandScope = `source-revision:${input.patientId}:${input.sourceItemId}`;
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          patientId: input.patientId,
          sourceItemId: input.sourceItemId,
          expectedSourceRef: input.expectedSourceRef,
          newText: input.newText,
          reason: input.reason,
          changedBy: input.changedBy,
        }),
      )
      .digest("hex");

    return this.store.transaction(() => {
      const replay = this.store.getProcessedCommand(
        commandScope,
        input.idempotencyKey,
      );
      if (replay) {
        if (replay.requestHash !== requestHash) {
          throw new DomainError(
            "IDEMPOTENCY_CONFLICT",
            "Idempotency key was used for a different source revision",
            false,
            409,
          );
        }
        const revisionId =
          typeof replay.revisionId === "string" ? replay.revisionId : "";
        const revision = this.store.getSourceRevision(revisionId);
        if (!revision) {
          throw new DomainError(
            "SOURCE_REVISION_NOT_FOUND",
            "Idempotent source revision result is unavailable",
            false,
            404,
          );
        }
        const impacts = this.store.listChangeImpacts(
          input.patientId,
          revision.revisionId,
        );
        return {
          revision,
          impacts,
          reviewRequiredCount: impacts.length,
          replayed: true,
        };
      }

      const current = this.store.getRecordItem(
        input.patientId,
        input.sourceItemId,
      );
      if (!current) {
        throw new DomainError(
          "SOURCE_ITEM_NOT_FOUND",
          "Source record item not found",
          false,
          404,
        );
      }
      if (current.sourceRef !== input.expectedSourceRef) {
        throw new DomainError(
          "SOURCE_SCOPE_MISMATCH",
          "Source reference does not match the record item",
          false,
          409,
        );
      }
      if (current.text === input.newText) {
        throw new DomainError(
          "SOURCE_UNCHANGED",
          "Source content has not changed",
          false,
          409,
        );
      }

      const revision: SourceRevision = {
        revisionId: randomUUID(),
        patientId: input.patientId,
        sourceItemId: current.itemId,
        sourceRef: current.sourceRef,
        previousHash: evidenceContentHash(current.text),
        currentHash: evidenceContentHash(input.newText),
        reason: input.reason,
        changedAt: input.changedAt,
        changedBy: input.changedBy,
      };
      this.store.putRecordItem({
        ...current,
        text: input.newText,
        recordedAt: input.changedAt,
      });
      this.store.putSourceRevision(revision);

      const impacts = this.store
        .listEvidenceDependencies(input.patientId, current.sourceRef)
        .filter((dependency) => dependency.sourceHash !== revision.currentHash)
        .map(
          (dependency): ChangeImpact => ({
            impactId: randomUUID(),
            revisionId: revision.revisionId,
            dependencyId: dependency.dependencyId,
            patientId: input.patientId,
            sourceItemId: current.itemId,
            sourceRef: current.sourceRef,
            artifactKind: dependency.artifactKind,
            artifactId: dependency.artifactId,
            artifactVersion: dependency.artifactVersion,
            status: "review_required",
            summary: changeImpactSummary(dependency.artifactKind),
            detectedAt: input.changedAt,
            changedAt: input.changedAt,
            changedBy: input.changedBy,
            reason: input.reason,
          }),
        );
      for (const impact of impacts) this.store.putChangeImpact(impact);

      const interactionId = `record-revision:${revision.revisionId}`;
      this.store.appendEvent({
        eventType: "record.source_revised",
        occurredAt: input.changedAt,
        correlationId: input.correlationId,
        patientId: input.patientId,
        interactionId,
        contextId: null,
        actor: { type: "clinician", id: input.changedBy },
        payload: {
          revisionId: revision.revisionId,
          sourceItemId: revision.sourceItemId,
          sourceRef: revision.sourceRef,
          previousHash: revision.previousHash,
          currentHash: revision.currentHash,
          reason: revision.reason,
          impactCount: impacts.length,
        },
      });
      for (const impact of impacts) {
        this.store.appendEvent({
          eventType: "change_radar.impact_detected",
          occurredAt: input.changedAt,
          correlationId: input.correlationId,
          patientId: input.patientId,
          interactionId,
          contextId: null,
          actor: { type: "system", id: "change-radar" },
          payload: {
            impactId: impact.impactId,
            revisionId: impact.revisionId,
            dependencyId: impact.dependencyId,
            sourceRef: impact.sourceRef,
            artifactKind: impact.artifactKind,
            artifactId: impact.artifactId,
            artifactVersion: impact.artifactVersion,
            status: impact.status,
          },
        });
      }
      this.store.saveProcessedCommand(
        commandScope,
        input.idempotencyKey,
        { revisionId: revision.revisionId, requestHash },
        input.changedAt,
      );
      return {
        revision,
        impacts,
        reviewRequiredCount: impacts.length,
        replayed: false,
      };
    });
  }

  listEligibleTeams(
    contextId: string,
    patientId: string,
    requiredCapabilities: string[],
  ): EligibleTeam[] {
    this.requirePatient(contextId, patientId);
    return this.store
      .listTeams()
      .filter((team) =>
        requiredCapabilities.every((capability) =>
          team.capabilities.includes(capability),
        ),
      )
      .map((team) => {
        const members = this.store
          .listMembers(team.teamId)
          .filter((member) => !isDemoAudienceMember(member.memberId));
        return {
          ...team,
          availability: {
            onShift: members.filter((member) => member.onShift).length,
            availableWithCapacity: members.filter(
              (member) =>
                member.onShift &&
                member.available &&
                member.openTaskCount < member.capacity,
            ).length,
          },
        };
      });
  }
}
