import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openMockEhrDatabase(databasePath: string): DatabaseSync {
  if (databasePath !== ":memory:") {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS clinical_documents (
      document_id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      filed_at TEXT,
      filed_by TEXT,
      correlation_id TEXT NOT NULL,
      coding_review_json TEXT
    );

    CREATE TABLE IF NOT EXISTS clinical_document_versions (
      document_id TEXT NOT NULL REFERENCES clinical_documents(document_id),
      patient_id TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      filed_at TEXT,
      filed_by TEXT,
      correlation_id TEXT NOT NULL,
      coding_review_json TEXT,
      change_reason TEXT NOT NULL,
      PRIMARY KEY (document_id, version)
    );

    CREATE TABLE IF NOT EXISTS processed_ehr_commands (
      command_scope TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (command_scope, idempotency_key)
    );

    CREATE INDEX IF NOT EXISTS idx_clinical_documents_patient
      ON clinical_documents(patient_id, updated_at, document_id);
    CREATE INDEX IF NOT EXISTS idx_document_versions_document
      ON clinical_document_versions(document_id, version);
  `);
  ensureColumn(database, "clinical_documents", "coding_review_json", "TEXT");
  ensureColumn(database, "clinical_document_versions", "coding_review_json", "TEXT");
  return database;
}

function ensureColumn(
  database: DatabaseSync,
  table: "clinical_documents" | "clinical_document_versions",
  column: string,
  definition: string,
): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all();
  const exists = columns.some(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      (value as Record<string, unknown>)["name"] === column,
  );
  if (!exists) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
