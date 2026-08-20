import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDatabase(databasePath: string): DatabaseSync {
  if (databasePath !== ":memory:") {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS patients (
      patient_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      record_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS patient_record_items (
      item_id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(patient_id),
      item_type TEXT NOT NULL,
      text TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS context_mappings (
      context_id TEXT PRIMARY KEY,
      interaction_id TEXT NOT NULL UNIQUE,
      patient_id TEXT NOT NULL REFERENCES patients(patient_id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teams (
      team_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      capabilities_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS members (
      member_id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(team_id),
      capabilities_json TEXT NOT NULL,
      on_shift INTEGER NOT NULL,
      available INTEGER NOT NULL,
      open_task_count INTEGER NOT NULL,
      capacity INTEGER NOT NULL,
      tie_break_key TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS threads (
      thread_id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(patient_id),
      interaction_id TEXT NOT NULL,
      context_id TEXT,
      summary TEXT NOT NULL,
      evidence_refs_json TEXT NOT NULL,
      state TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(thread_id),
      patient_id TEXT NOT NULL REFERENCES patients(patient_id),
      origin TEXT NOT NULL,
      summary TEXT NOT NULL,
      task_type TEXT NOT NULL,
      evidence_refs_json TEXT NOT NULL,
      target_team_id TEXT NOT NULL REFERENCES teams(team_id),
      required_capabilities_json TEXT NOT NULL,
      clinical_urgency TEXT NOT NULL,
      operational_priority_score INTEGER NOT NULL,
      priority_breakdown_json TEXT NOT NULL,
      accept_by TEXT NOT NULL,
      due_by TEXT NOT NULL,
      state TEXT NOT NULL,
      assigned_member_id TEXT,
      failed_offers INTEGER NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS demo_sessions (
      session_id TEXT PRIMARY KEY,
      join_code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      scenario TEXT NOT NULL,
      group_size INTEGER NOT NULL,
      target_team_id TEXT NOT NULL REFERENCES teams(team_id),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS demo_participants (
      participant_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES demo_sessions(session_id),
      group_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      member_id TEXT NOT NULL UNIQUE REFERENCES members(member_id),
      join_key TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      joined_at TEXT NOT NULL,
      UNIQUE (session_id, join_key)
    );

    CREATE TABLE IF NOT EXISTS demo_assignments (
      assignment_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES demo_sessions(session_id),
      group_id TEXT NOT NULL,
      participant_id TEXT NOT NULL REFERENCES demo_participants(participant_id),
      task_id TEXT NOT NULL UNIQUE REFERENCES tasks(task_id),
      assigned_by TEXT NOT NULL,
      assigned_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approvals (
      approval_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(task_id),
      patient_id TEXT NOT NULL,
      clinician_id TEXT NOT NULL,
      draft_version INTEGER NOT NULL,
      draft_hash TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      approval_channel TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS processed_commands (
      command_scope TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (command_scope, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS handovers (
      handover_id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(patient_id),
      interaction_id TEXT NOT NULL UNIQUE,
      context_id TEXT,
      requested_by TEXT NOT NULL,
      reason TEXT NOT NULL,
      focus TEXT,
      correlation_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      version INTEGER NOT NULL,
      packet_json TEXT,
      rendered_json TEXT,
      source_snapshot_json TEXT,
      source_snapshot_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      generated_at TEXT,
      UNIQUE (requested_by, idempotency_key)
    );

    CREATE INDEX IF NOT EXISTS idx_handovers_patient_created
      ON handovers(patient_id, created_at, handover_id);

    CREATE TABLE IF NOT EXISTS task_declines (
      task_id TEXT NOT NULL REFERENCES tasks(task_id),
      member_id TEXT NOT NULL,
      declined_at TEXT NOT NULL,
      PRIMARY KEY (task_id, member_id)
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      interaction_id TEXT NOT NULL,
      context_id TEXT,
      actor_json TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_team_state
      ON tasks(target_team_id, state);
    CREATE INDEX IF NOT EXISTS idx_tasks_deadlines
      ON tasks(accept_by, due_by);
    CREATE INDEX IF NOT EXISTS idx_demo_participants_session_group
      ON demo_participants(session_id, group_id, joined_at);
    CREATE INDEX IF NOT EXISTS idx_demo_assignments_participant
      ON demo_assignments(session_id, participant_id, assigned_at);
    CREATE INDEX IF NOT EXISTS idx_events_sequence
      ON audit_events(sequence);
  `);

  return database;
}

export function inTransaction<T>(
  database: DatabaseSync,
  operation: () => T,
): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
