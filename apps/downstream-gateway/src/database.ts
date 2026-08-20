import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDownstreamDatabase(databasePath: string): DatabaseSync {
  if (databasePath !== ":memory:") {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS downstream_deliveries (
      delivery_id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      request_hash TEXT NOT NULL,
      source_task_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      target_system TEXT NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      instructions TEXT,
      due_at TEXT NOT NULL,
      referral_snapshot_id TEXT,
      status TEXT NOT NULL,
      external_reference TEXT UNIQUE,
      outcome_reference TEXT,
      source_acknowledged_at TEXT,
      status_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      UNIQUE (source_task_id, target_system, kind)
    );

    CREATE TABLE IF NOT EXISTS downstream_delivery_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      delivery_id TEXT NOT NULL REFERENCES downstream_deliveries(delivery_id),
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      status TEXT NOT NULL,
      details_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS simulated_provider_items (
      external_reference TEXT PRIMARY KEY,
      delivery_id TEXT NOT NULL UNIQUE,
      target_system TEXT NOT NULL,
      status TEXT NOT NULL,
      outcome_reference TEXT,
      status_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS simulated_provider_commands (
      external_reference TEXT NOT NULL REFERENCES simulated_provider_items(external_reference),
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (external_reference, idempotency_key)
    );

    CREATE INDEX IF NOT EXISTS idx_deliveries_source_task
      ON downstream_deliveries(source_task_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_delivery_events_delivery
      ON downstream_delivery_events(delivery_id, sequence);
  `);
  const deliveryColumns = database
    .prepare("PRAGMA table_info(downstream_deliveries)")
    .all() as Array<{ name?: unknown }>;
  if (!deliveryColumns.some((column) => column.name === "source_acknowledged_at")) {
    database.exec(
      "ALTER TABLE downstream_deliveries ADD COLUMN source_acknowledged_at TEXT",
    );
  }
  return database;
}
