import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openProfileDatabase(databasePath: string): DatabaseSync {
  if (databasePath !== ":memory:") {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS patient_profiles (
      patient_id TEXT PRIMARY KEY,
      profile_json TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS patient_profile_versions (
      patient_id TEXT NOT NULL REFERENCES patient_profiles(patient_id),
      version INTEGER NOT NULL,
      profile_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      change_reason TEXT NOT NULL,
      PRIMARY KEY (patient_id, version)
    );

    CREATE TABLE IF NOT EXISTS referral_snapshots (
      referral_id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patient_profiles(patient_id),
      referral_type TEXT NOT NULL,
      destination TEXT NOT NULL,
      clinical_reason TEXT NOT NULL,
      additional_instructions TEXT,
      profile_version INTEGER NOT NULL,
      profile_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      correlation_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS processed_profile_commands (
      command_scope TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (command_scope, idempotency_key)
    );

    CREATE INDEX IF NOT EXISTS idx_profile_versions_patient
      ON patient_profile_versions(patient_id, version);
    CREATE INDEX IF NOT EXISTS idx_referral_snapshots_patient
      ON referral_snapshots(patient_id, created_at, referral_id);
  `);
  return database;
}
