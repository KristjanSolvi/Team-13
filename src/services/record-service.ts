import { DomainError } from "../domain/errors.js";
import type { Team, Thread } from "../domain/types.js";
import type {
  PatientRecordItem,
  SqliteStore,
} from "../infra/store.js";

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

export class RecordService {
  constructor(private readonly store: SqliteStore) {}

  private requirePatient(
    contextId: string,
    requestedPatientId: string,
  ): void {
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
        const members = this.store.listMembers(team.teamId);
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
