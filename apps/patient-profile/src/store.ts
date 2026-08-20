import type { DatabaseSync } from "node:sqlite";

import type {
  PatientProfile,
  PatientProfileVersion,
  ReferralSnapshot,
} from "./contracts.js";
import { ProfileError } from "./errors.js";

export class PatientProfileStore {
  constructor(private readonly database: DatabaseSync) {}

  close(): void {
    this.database.close();
  }

  runIdempotent<T>(
    scope: string,
    key: string,
    requestHash: string,
    createdAt: string,
    operation: () => T,
  ): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.database
        .prepare(`
          SELECT request_hash, result_json
          FROM processed_profile_commands
          WHERE command_scope = ? AND idempotency_key = ?
        `)
        .get(scope, key);
      if (existing) {
        if (rowText(existing, "request_hash") !== requestHash) {
          throw new ProfileError(
            "IDEMPOTENCY_CONFLICT",
            "Idempotency key was already used for a different request",
            409,
          );
        }
        const replay = parseJson(rowText(existing, "result_json")) as T;
        this.database.exec("COMMIT");
        return replay;
      }

      const result = operation();
      this.database
        .prepare(`
          INSERT INTO processed_profile_commands
            (command_scope, idempotency_key, request_hash, result_json, created_at)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(scope, key, requestHash, JSON.stringify(result), createdAt);
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  createProfile(profile: PatientProfile, changeReason: string): void {
    try {
      this.database
        .prepare(`
          INSERT INTO patient_profiles
            (patient_id, profile_json, version, created_at, updated_at, updated_by)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          profile.patientId,
          JSON.stringify(profile.profile),
          profile.version,
          profile.createdAt,
          profile.updatedAt,
          profile.updatedBy,
        );
    } catch (error) {
      if (isSqliteConstraint(error)) {
        throw new ProfileError(
          "PROFILE_ALREADY_EXISTS",
          "Patient profile already exists",
          409,
        );
      }
      throw error;
    }
    this.insertVersion(profile, changeReason);
  }

  getProfile(patientId: string): PatientProfile | null {
    const row = this.database
      .prepare(`
        SELECT patient_id, profile_json, version, created_at, updated_at, updated_by
        FROM patient_profiles
        WHERE patient_id = ?
      `)
      .get(patientId);
    return row ? profileFromRow(row) : null;
  }

  replaceProfile(
    currentVersion: number,
    profile: PatientProfile,
    changeReason: string,
  ): void {
    const result = this.database
      .prepare(`
        UPDATE patient_profiles
        SET profile_json = ?, version = ?, updated_at = ?, updated_by = ?
        WHERE patient_id = ? AND version = ?
      `)
      .run(
        JSON.stringify(profile.profile),
        profile.version,
        profile.updatedAt,
        profile.updatedBy,
        profile.patientId,
        currentVersion,
      );
    if (Number(result.changes) !== 1) {
      throw new ProfileError(
        "VERSION_CONFLICT",
        "Patient profile changed before this update was applied",
        409,
      );
    }
    this.insertVersion(profile, changeReason);
  }

  listVersions(patientId: string): PatientProfileVersion[] {
    const rows = this.database
      .prepare(`
        SELECT patient_id, profile_json, version, created_at, updated_at,
               updated_by, change_reason
        FROM patient_profile_versions
        WHERE patient_id = ?
        ORDER BY version DESC
      `)
      .all(patientId);
    return rows.map((row) => ({
      ...profileFromRow(row),
      changeReason: rowText(row, "change_reason"),
    }));
  }

  insertReferralSnapshot(snapshot: ReferralSnapshot): void {
    this.database
      .prepare(`
        INSERT INTO referral_snapshots
          (referral_id, patient_id, referral_type, destination, clinical_reason,
           additional_instructions, profile_version, profile_json, created_at,
           created_by, correlation_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        snapshot.referralId,
        snapshot.patientId,
        snapshot.referralType,
        snapshot.destination,
        snapshot.clinicalReason,
        snapshot.additionalInstructions,
        snapshot.profileVersion,
        JSON.stringify(snapshot.patientProfile),
        snapshot.createdAt,
        snapshot.createdBy,
        snapshot.correlationId,
      );
  }

  getReferralSnapshot(referralId: string): ReferralSnapshot | null {
    const row = this.database
      .prepare(`
        SELECT referral_id, patient_id, referral_type, destination,
               clinical_reason, additional_instructions, profile_version,
               profile_json, created_at, created_by, correlation_id
        FROM referral_snapshots
        WHERE referral_id = ?
      `)
      .get(referralId);
    return row ? referralFromRow(row) : null;
  }

  listReferralSnapshots(patientId: string): ReferralSnapshot[] {
    return this.database
      .prepare(`
        SELECT referral_id, patient_id, referral_type, destination,
               clinical_reason, additional_instructions, profile_version,
               profile_json, created_at, created_by, correlation_id
        FROM referral_snapshots
        WHERE patient_id = ?
        ORDER BY created_at DESC, referral_id DESC
      `)
      .all(patientId)
      .map(referralFromRow);
  }

  private insertVersion(profile: PatientProfile, changeReason: string): void {
    this.database
      .prepare(`
        INSERT INTO patient_profile_versions
          (patient_id, version, profile_json, created_at, updated_at, updated_by,
           change_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        profile.patientId,
        profile.version,
        JSON.stringify(profile.profile),
        profile.createdAt,
        profile.updatedAt,
        profile.updatedBy,
        changeReason,
      );
  }
}

function profileFromRow(row: object): PatientProfile {
  return {
    schemaVersion: "1",
    patientId: rowText(row, "patient_id"),
    profile: parseJson(rowText(row, "profile_json")) as PatientProfile["profile"],
    version: rowNumber(row, "version"),
    createdAt: rowText(row, "created_at"),
    updatedAt: rowText(row, "updated_at"),
    updatedBy: rowText(row, "updated_by"),
  };
}

function referralFromRow(row: object): ReferralSnapshot {
  const additionalInstructions = rowValue(row, "additional_instructions");
  return {
    schemaVersion: "1",
    referralId: rowText(row, "referral_id"),
    patientId: rowText(row, "patient_id"),
    referralType: rowText(row, "referral_type"),
    destination: rowText(row, "destination"),
    clinicalReason: rowText(row, "clinical_reason"),
    additionalInstructions:
      additionalInstructions === null ? null : String(additionalInstructions),
    profileVersion: rowNumber(row, "profile_version"),
    patientProfile: parseJson(
      rowText(row, "profile_json"),
    ) as ReferralSnapshot["patientProfile"],
    createdAt: rowText(row, "created_at"),
    createdBy: rowText(row, "created_by"),
    correlationId: rowText(row, "correlation_id"),
  };
}

function rowValue(row: object, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

function rowText(row: object, key: string): string {
  const value = rowValue(row, key);
  if (typeof value !== "string") throw new Error(`Expected text column: ${key}`);
  return value;
}

function rowNumber(row: object, key: string): number {
  const value = rowValue(row, key);
  if (typeof value !== "number") throw new Error(`Expected number column: ${key}`);
  return value;
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function isSqliteConstraint(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const sqliteError = error as Error & {
    code?: unknown;
    errcode?: unknown;
  };
  const code = String(sqliteError.code ?? "");

  return (
    code.startsWith("ERR_SQLITE_CONSTRAINT") ||
    (code === "ERR_SQLITE_ERROR" &&
      (sqliteError.errcode === 1555 || sqliteError.errcode === 2067) &&
      error.message.startsWith("UNIQUE constraint failed:"))
  );
}
