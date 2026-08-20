import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

import { DomainError } from "../domain/errors.js";
import type {
  Actor,
  DomainEvent,
  Member,
  PriorityBreakdown,
  Task,
  Team,
  Thread,
} from "../domain/types.js";
import { inTransaction } from "./database.js";

export interface ApprovalRecord {
  approvalId: string;
  taskId: string;
  patientId: string;
  clinicianId: string;
  draftVersion: number;
  draftHash: string;
  approvedAt: string;
  approvalChannel: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface PatientRecordItem {
  itemId: string;
  patientId: string;
  itemType: string;
  text: string;
  sourceRef: string;
  recordedAt: string;
}

type SqlRow = Record<string, SQLOutputValue>;

function rowText(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new TypeError(`Expected ${key} to be text`);
  }
  return value;
}

function rowNumber(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number") {
    throw new TypeError(`Expected ${key} to be numeric`);
  }
  return value;
}

function rowOptionalText(row: SqlRow, key: string): string | null {
  const value = row[key];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new TypeError(`Expected ${key} to be nullable text`);
  }
  return value;
}

function parseJson(value: string): unknown {
  const parsed: unknown = JSON.parse(value);
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRecord(value: string): Record<string, unknown> {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) {
    throw new TypeError("Expected a JSON object");
  }
  return parsed;
}

function parseStrings(value: string): string[] {
  const parsed = parseJson(value);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => typeof item === "string")
  ) {
    throw new TypeError("Expected a JSON string array");
  }
  return parsed;
}

function parsePriorityBreakdown(value: string): PriorityBreakdown {
  const parsed = parseJson(value);
  if (
    !isRecord(parsed) ||
    typeof parsed.base !== "number" ||
    typeof parsed.deadlinePressure !== "number" ||
    typeof parsed.overdue !== "number" ||
    typeof parsed.failedOffers !== "number" ||
    typeof parsed.total !== "number" ||
    typeof parsed.activeTargetAt !== "string"
  ) {
    throw new TypeError("Expected a valid priority breakdown");
  }

  return {
    base: parsed.base,
    deadlinePressure: parsed.deadlinePressure,
    overdue: parsed.overdue,
    failedOffers: parsed.failedOffers,
    total: parsed.total,
    activeTargetAt: parsed.activeTargetAt,
  };
}

function parseTaskOrigin(value: string): Task["origin"] {
  if (value === "agent_suggested" || value === "clinician_created") {
    return value;
  }
  throw new TypeError("Expected a valid task origin");
}

function parseClinicalUrgency(value: string): Task["clinicalUrgency"] {
  if (value === "high" || value === "medium" || value === "routine") {
    return value;
  }
  throw new TypeError("Expected a valid clinical urgency");
}

function parseTaskState(value: string): Task["state"] {
  if (
    value === "draft" ||
    value === "offered_to_team" ||
    value === "assigned_to_member" ||
    value === "accepted" ||
    value === "completed" ||
    value === "verified" ||
    value === "escalated" ||
    value === "dismissed"
  ) {
    return value;
  }
  throw new TypeError("Expected a valid task state");
}

function parseThreadState(value: string): Thread["state"] {
  if (
    value === "awaiting_review" ||
    value === "tracking" ||
    value === "verified" ||
    value === "escalated" ||
    value === "dismissed"
  ) {
    return value;
  }
  throw new TypeError("Expected a valid thread state");
}

function isActorType(value: unknown): value is Actor["type"] {
  return (
    value === "agent" ||
    value === "clinician" ||
    value === "team_member" ||
    value === "router" ||
    value === "system"
  );
}

function parseActor(value: string): Actor {
  const parsed = parseJson(value);
  if (
    !isRecord(parsed) ||
    !isActorType(parsed.type) ||
    typeof parsed.id !== "string"
  ) {
    throw new TypeError("Expected a valid event actor");
  }
  return { type: parsed.type, id: parsed.id };
}

function mapThread(row: SqlRow): Thread {
  return {
    threadId: rowText(row, "thread_id"),
    patientId: rowText(row, "patient_id"),
    interactionId: rowText(row, "interaction_id"),
    contextId: rowOptionalText(row, "context_id"),
    summary: rowText(row, "summary"),
    evidenceRefs: parseStrings(rowText(row, "evidence_refs_json")),
    state: parseThreadState(rowText(row, "state")),
    version: rowNumber(row, "version"),
    createdAt: rowText(row, "created_at"),
    updatedAt: rowText(row, "updated_at"),
  };
}

function mapTask(row: SqlRow): Task {
  return {
    taskId: rowText(row, "task_id"),
    threadId: rowText(row, "thread_id"),
    patientId: rowText(row, "patient_id"),
    origin: parseTaskOrigin(rowText(row, "origin")),
    summary: rowText(row, "summary"),
    taskType: rowText(row, "task_type"),
    evidenceRefs: parseStrings(rowText(row, "evidence_refs_json")),
    targetTeamId: rowText(row, "target_team_id"),
    requiredCapabilities: parseStrings(
      rowText(row, "required_capabilities_json"),
    ),
    clinicalUrgency: parseClinicalUrgency(rowText(row, "clinical_urgency")),
    operationalPriorityScore: rowNumber(row, "operational_priority_score"),
    priorityBreakdown: parsePriorityBreakdown(
      rowText(row, "priority_breakdown_json"),
    ),
    acceptBy: rowText(row, "accept_by"),
    dueBy: rowText(row, "due_by"),
    state: parseTaskState(rowText(row, "state")),
    assignedMemberId: rowOptionalText(row, "assigned_member_id"),
    failedOffers: rowNumber(row, "failed_offers"),
    version: rowNumber(row, "version"),
    createdAt: rowText(row, "created_at"),
    updatedAt: rowText(row, "updated_at"),
  };
}

export class SqliteStore {
  private transactionDepth = 0;

  constructor(private readonly database: DatabaseSync) {}

  close(): void {
    this.database.close();
  }

  transaction<T>(operation: () => T): T {
    const outermost = this.transactionDepth === 0;
    this.transactionDepth += 1;
    try {
      return outermost ? inTransaction(this.database, operation) : operation();
    } finally {
      this.transactionDepth -= 1;
    }
  }

  putPatient(patientId: string, displayName: string, record: unknown): void {
    this.database
      .prepare(`
        INSERT INTO patients (patient_id, display_name, record_json)
        VALUES (?, ?, ?)
        ON CONFLICT(patient_id) DO UPDATE SET
          display_name = excluded.display_name,
          record_json = excluded.record_json
      `)
      .run(patientId, displayName, JSON.stringify(record));
  }

  getPatient(
    patientId: string,
  ): { patientId: string; displayName: string; record: unknown } | null {
    const row = this.database
      .prepare(
        "SELECT patient_id, display_name, record_json FROM patients WHERE patient_id = ?",
      )
      .get(patientId);
    if (!row) {
      return null;
    }

    return {
      patientId: rowText(row, "patient_id"),
      displayName: rowText(row, "display_name"),
      record: parseJson(rowText(row, "record_json")),
    };
  }

  putRecordItem(item: PatientRecordItem): void {
    this.database
      .prepare(`
        INSERT INTO patient_record_items
          (item_id, patient_id, item_type, text, source_ref, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id) DO UPDATE SET
          patient_id = excluded.patient_id,
          item_type = excluded.item_type,
          text = excluded.text,
          source_ref = excluded.source_ref,
          recorded_at = excluded.recorded_at
      `)
      .run(
        item.itemId,
        item.patientId,
        item.itemType,
        item.text,
        item.sourceRef,
        item.recordedAt,
      );
  }

  listRecordItems(patientId: string): PatientRecordItem[] {
    const rows = this.database
      .prepare(`
        SELECT item_id, patient_id, item_type, text, source_ref, recorded_at
        FROM patient_record_items
        WHERE patient_id = ?
        ORDER BY recorded_at, item_id
      `)
      .all(patientId);

    return rows.map((row) => ({
      itemId: rowText(row, "item_id"),
      patientId: rowText(row, "patient_id"),
      itemType: rowText(row, "item_type"),
      text: rowText(row, "text"),
      sourceRef: rowText(row, "source_ref"),
      recordedAt: rowText(row, "recorded_at"),
    }));
  }

  hasRecordEvidence(patientId: string, evidenceRefs: string[]): boolean {
    const knownReferences = new Set(
      this.listRecordItems(patientId).map((item) => item.sourceRef),
    );
    return evidenceRefs.every((reference) => knownReferences.has(reference));
  }

  putTeam(team: Team): void {
    this.database
      .prepare(`
        INSERT INTO teams (team_id, name, capabilities_json)
        VALUES (?, ?, ?)
        ON CONFLICT(team_id) DO UPDATE SET
          name = excluded.name,
          capabilities_json = excluded.capabilities_json
      `)
      .run(team.teamId, team.name, JSON.stringify(team.capabilities));
  }

  putMember(member: Member): void {
    this.database
      .prepare(`
        INSERT INTO members
          (member_id, team_id, capabilities_json, on_shift, available,
           open_task_count, capacity, tie_break_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(member_id) DO UPDATE SET
          team_id = excluded.team_id,
          capabilities_json = excluded.capabilities_json,
          on_shift = excluded.on_shift,
          available = excluded.available,
          open_task_count = excluded.open_task_count,
          capacity = excluded.capacity,
          tie_break_key = excluded.tie_break_key
      `)
      .run(
        member.memberId,
        member.teamId,
        JSON.stringify(member.capabilities),
        Number(member.onShift),
        Number(member.available),
        member.openTaskCount,
        member.capacity,
        member.tieBreakKey,
      );
  }

  listTeams(): Team[] {
    const rows = this.database
      .prepare(`
        SELECT team_id, name, capabilities_json
        FROM teams
        ORDER BY team_id
      `)
      .all();

    return rows.map((row) => ({
      teamId: rowText(row, "team_id"),
      name: rowText(row, "name"),
      capabilities: parseStrings(rowText(row, "capabilities_json")),
    }));
  }

  listMembers(teamId: string): Member[] {
    const rows = this.database
      .prepare(`
        SELECT member_id, team_id, capabilities_json, on_shift, available,
               open_task_count, capacity, tie_break_key
        FROM members
        WHERE team_id = ?
        ORDER BY tie_break_key, member_id
      `)
      .all(teamId);

    return rows.map((row) => ({
      memberId: rowText(row, "member_id"),
      teamId: rowText(row, "team_id"),
      capabilities: parseStrings(rowText(row, "capabilities_json")),
      onShift: Boolean(rowNumber(row, "on_shift")),
      available: Boolean(rowNumber(row, "available")),
      openTaskCount: rowNumber(row, "open_task_count"),
      capacity: rowNumber(row, "capacity"),
      tieBreakKey: rowText(row, "tie_break_key"),
    }));
  }

  putContextMapping(
    contextId: string,
    interactionId: string,
    patientId: string,
    createdAt: string,
  ): void {
    this.database
      .prepare(`
        INSERT INTO context_mappings
          (context_id, interaction_id, patient_id, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(context_id) DO UPDATE SET
          interaction_id = excluded.interaction_id,
          patient_id = excluded.patient_id,
          created_at = excluded.created_at
      `)
      .run(contextId, interactionId, patientId, createdAt);
  }

  patientForContext(contextId: string): string | null {
    const row = this.database
      .prepare("SELECT patient_id FROM context_mappings WHERE context_id = ?")
      .get(contextId);
    return row ? rowText(row, "patient_id") : null;
  }

  contextForInteraction(interactionId: string): string | null {
    const row = this.database
      .prepare(
        "SELECT context_id FROM context_mappings WHERE interaction_id = ?",
      )
      .get(interactionId);
    return row ? rowText(row, "context_id") : null;
  }

  appendEvent(
    input: Omit<DomainEvent, "schemaVersion" | "eventId">,
  ): DomainEvent {
    const event: DomainEvent = {
      schemaVersion: "1",
      eventId: randomUUID(),
      ...input,
    };
    this.database
      .prepare(`
        INSERT INTO audit_events
          (event_id, event_type, occurred_at, correlation_id, patient_id,
           interaction_id, context_id, actor_json, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        event.eventId,
        event.eventType,
        event.occurredAt,
        event.correlationId,
        event.patientId,
        event.interactionId,
        event.contextId,
        JSON.stringify(event.actor),
        JSON.stringify(event.payload),
      );
    return event;
  }

  listEvents(afterSequence: number): Array<DomainEvent & { sequence: number }> {
    const rows = this.database
      .prepare(`
        SELECT sequence, event_id, event_type, occurred_at, correlation_id,
               patient_id, interaction_id, context_id, actor_json, payload_json
        FROM audit_events
        WHERE sequence > ?
        ORDER BY sequence
      `)
      .all(afterSequence);

    return rows.map((row) => ({
      schemaVersion: "1",
      sequence: rowNumber(row, "sequence"),
      eventId: rowText(row, "event_id"),
      eventType: rowText(row, "event_type"),
      occurredAt: rowText(row, "occurred_at"),
      correlationId: rowText(row, "correlation_id"),
      patientId: rowText(row, "patient_id"),
      interactionId: rowText(row, "interaction_id"),
      contextId: rowOptionalText(row, "context_id"),
      actor: parseActor(rowText(row, "actor_json")),
      payload: parseRecord(rowText(row, "payload_json")),
    }));
  }

  putThread(thread: Thread): void {
    this.database
      .prepare(`
        INSERT INTO threads
          (thread_id, patient_id, interaction_id, context_id, summary,
           evidence_refs_json, state, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          patient_id = excluded.patient_id,
          interaction_id = excluded.interaction_id,
          context_id = excluded.context_id,
          summary = excluded.summary,
          evidence_refs_json = excluded.evidence_refs_json,
          state = excluded.state,
          version = excluded.version,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `)
      .run(
        thread.threadId,
        thread.patientId,
        thread.interactionId,
        thread.contextId,
        thread.summary,
        JSON.stringify(thread.evidenceRefs),
        thread.state,
        thread.version,
        thread.createdAt,
        thread.updatedAt,
      );
  }

  getThread(threadId: string): Thread | null {
    const row = this.database
      .prepare("SELECT * FROM threads WHERE thread_id = ?")
      .get(threadId);
    return row ? mapThread(row) : null;
  }

  listOpenThreads(patientId: string): Thread[] {
    const rows = this.database
      .prepare(`
        SELECT *
        FROM threads
        WHERE patient_id = ? AND state NOT IN ('verified', 'dismissed')
        ORDER BY created_at, thread_id
      `)
      .all(patientId);
    return rows.map(mapThread);
  }

  putTask(task: Task): void {
    this.database
      .prepare(`
        INSERT INTO tasks
          (task_id, thread_id, patient_id, origin, summary, task_type,
           evidence_refs_json, target_team_id, required_capabilities_json,
           clinical_urgency, operational_priority_score, priority_breakdown_json,
           accept_by, due_by, state, assigned_member_id, failed_offers, version,
           created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET
          thread_id = excluded.thread_id,
          patient_id = excluded.patient_id,
          origin = excluded.origin,
          summary = excluded.summary,
          task_type = excluded.task_type,
          evidence_refs_json = excluded.evidence_refs_json,
          target_team_id = excluded.target_team_id,
          required_capabilities_json = excluded.required_capabilities_json,
          clinical_urgency = excluded.clinical_urgency,
          operational_priority_score = excluded.operational_priority_score,
          priority_breakdown_json = excluded.priority_breakdown_json,
          accept_by = excluded.accept_by,
          due_by = excluded.due_by,
          state = excluded.state,
          assigned_member_id = excluded.assigned_member_id,
          failed_offers = excluded.failed_offers,
          version = excluded.version,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `)
      .run(
        task.taskId,
        task.threadId,
        task.patientId,
        task.origin,
        task.summary,
        task.taskType,
        JSON.stringify(task.evidenceRefs),
        task.targetTeamId,
        JSON.stringify(task.requiredCapabilities),
        task.clinicalUrgency,
        task.operationalPriorityScore,
        JSON.stringify(task.priorityBreakdown),
        task.acceptBy,
        task.dueBy,
        task.state,
        task.assignedMemberId,
        task.failedOffers,
        task.version,
        task.createdAt,
        task.updatedAt,
      );
  }

  getTask(taskId: string): Task | null {
    const row = this.database
      .prepare("SELECT * FROM tasks WHERE task_id = ?")
      .get(taskId);
    return row ? mapTask(row) : null;
  }

  listTeamTasks(teamId: string): Task[] {
    const rows = this.database
      .prepare(`
        SELECT *
        FROM tasks
        WHERE target_team_id = ?
          AND state NOT IN ('draft', 'verified', 'dismissed')
        ORDER BY operational_priority_score DESC, due_by, task_id
      `)
      .all(teamId);
    return rows.map(mapTask);
  }

  listPatientTasks(patientId: string): Task[] {
    const rows = this.database
      .prepare(`
        SELECT *
        FROM tasks
        WHERE patient_id = ?
        ORDER BY created_at, task_id
      `)
      .all(patientId);
    return rows.map(mapTask);
  }

  saveApproval(value: ApprovalRecord): void {
    this.database
      .prepare(`
        INSERT INTO approvals
          (approval_id, task_id, patient_id, clinician_id, draft_version,
           draft_hash, approved_at, approval_channel, expires_at, consumed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        value.approvalId,
        value.taskId,
        value.patientId,
        value.clinicianId,
        value.draftVersion,
        value.draftHash,
        value.approvedAt,
        value.approvalChannel,
        value.expiresAt,
        value.consumedAt,
      );
  }

  getApproval(approvalId: string): ApprovalRecord | null {
    const row = this.database
      .prepare("SELECT * FROM approvals WHERE approval_id = ?")
      .get(approvalId);
    if (!row) {
      return null;
    }

    return {
      approvalId: rowText(row, "approval_id"),
      taskId: rowText(row, "task_id"),
      patientId: rowText(row, "patient_id"),
      clinicianId: rowText(row, "clinician_id"),
      draftVersion: rowNumber(row, "draft_version"),
      draftHash: rowText(row, "draft_hash"),
      approvedAt: rowText(row, "approved_at"),
      approvalChannel: rowText(row, "approval_channel"),
      expiresAt: rowText(row, "expires_at"),
      consumedAt: rowOptionalText(row, "consumed_at"),
    };
  }

  consumeApproval(approvalId: string, consumedAt: string): void {
    this.database
      .prepare(`
        UPDATE approvals
        SET consumed_at = ?
        WHERE approval_id = ? AND consumed_at IS NULL
      `)
      .run(consumedAt, approvalId);
  }

  getProcessedCommand(
    scope: string,
    key: string,
  ): Record<string, unknown> | null {
    const row = this.database
      .prepare(`
        SELECT result_json
        FROM processed_commands
        WHERE command_scope = ? AND idempotency_key = ?
      `)
      .get(scope, key);
    return row ? parseRecord(rowText(row, "result_json")) : null;
  }

  saveProcessedCommand(
    scope: string,
    key: string,
    result: unknown,
    createdAt: string,
  ): void {
    this.database
      .prepare(`
        INSERT INTO processed_commands
          (command_scope, idempotency_key, result_json, created_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(scope, key, JSON.stringify(result), createdAt);
  }

  runTaskCommand(
    scope: string,
    key: string,
    createdAt: string,
    operation: () => Task,
  ): Task {
    return this.transaction(() => {
      const replay = this.getProcessedCommand(scope, key);
      if (replay) {
        const taskId = typeof replay.taskId === "string" ? replay.taskId : "";
        const task = this.getTask(taskId);
        if (!task) {
          throw new DomainError(
            "TASK_NOT_FOUND",
            "Idempotent task result is unavailable",
            false,
            404,
          );
        }
        return task;
      }

      const task = operation();
      this.saveProcessedCommand(scope, key, { taskId: task.taskId }, createdAt);
      return task;
    });
  }
}
