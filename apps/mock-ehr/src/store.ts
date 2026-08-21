import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import type {
  ClinicalCodingReview,
  ClinicalDocument,
  ClinicalDocumentVersion,
} from "./contracts.js";
import { MockEhrError } from "./errors.js";

export class MockEhrStore {
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
          FROM processed_ehr_commands
          WHERE command_scope = ? AND idempotency_key = ?
        `)
        .get(scope, key);
      if (existing) {
        if (rowText(existing, "request_hash") !== requestHash) {
          throw new MockEhrError(
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
          INSERT INTO processed_ehr_commands
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

  insertDocument(document: ClinicalDocument, changeReason: string): void {
    this.database
      .prepare(`
        INSERT INTO clinical_documents
          (document_id, patient_id, category, title, content, source, status,
           version, created_at, created_by, updated_at, updated_by, filed_at,
           filed_by, correlation_id, coding_review_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(...documentValues(document));
    this.insertVersion(document, changeReason);
  }

  getDocument(documentId: string): ClinicalDocument | null {
    const row = this.database
      .prepare(`
        SELECT document_id, patient_id, category, title, content, source,
               status, version, created_at, created_by, updated_at, updated_by,
               filed_at, filed_by, correlation_id, coding_review_json
        FROM clinical_documents
        WHERE document_id = ?
      `)
      .get(documentId);
    return row ? documentFromRow(row) : null;
  }

  listPatientDocuments(patientId: string): ClinicalDocument[] {
    return this.database
      .prepare(`
        SELECT document_id, patient_id, category, title, content, source,
               status, version, created_at, created_by, updated_at, updated_by,
               filed_at, filed_by, correlation_id, coding_review_json
        FROM clinical_documents
        WHERE patient_id = ?
        ORDER BY updated_at DESC, document_id DESC
      `)
      .all(patientId)
      .map(documentFromRow);
  }

  replaceDocument(currentVersion: number, document: ClinicalDocument, changeReason: string): void {
    const result = this.database
      .prepare(`
        UPDATE clinical_documents
        SET category = ?, title = ?, content = ?, source = ?, status = ?,
            version = ?, created_at = ?, created_by = ?, updated_at = ?,
            updated_by = ?, filed_at = ?, filed_by = ?, correlation_id = ?,
            coding_review_json = ?
        WHERE document_id = ? AND version = ?
      `)
      .run(
        document.category,
        document.title,
        document.content,
        document.source,
        document.status,
        document.version,
        document.createdAt,
        document.createdBy,
        document.updatedAt,
        document.updatedBy,
        document.filedAt,
        document.filedBy,
        document.correlationId,
        codingReviewValue(document.codingReview),
        document.documentId,
        currentVersion,
      );
    if (Number(result.changes) !== 1) {
      throw new MockEhrError(
        "VERSION_CONFLICT",
        "Clinical document changed before this update was applied",
        409,
      );
    }
    this.insertVersion(document, changeReason);
  }

  listVersions(documentId: string): ClinicalDocumentVersion[] {
    return this.database
      .prepare(`
        SELECT document_id, patient_id, category, title, content, source,
               status, version, created_at, created_by, updated_at, updated_by,
               filed_at, filed_by, correlation_id, coding_review_json, change_reason
        FROM clinical_document_versions
        WHERE document_id = ?
        ORDER BY version DESC
      `)
      .all(documentId)
      .map((row) => ({
        ...documentFromRow(row),
        changeReason: rowText(row, "change_reason"),
      }));
  }

  private insertVersion(document: ClinicalDocument, changeReason: string): void {
    this.database
      .prepare(`
        INSERT INTO clinical_document_versions
          (document_id, patient_id, category, title, content, source, status,
           version, created_at, created_by, updated_at, updated_by, filed_at,
           filed_by, correlation_id, coding_review_json, change_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(...documentValues(document), changeReason);
  }
}

function documentValues(document: ClinicalDocument): SQLInputValue[] {
  return [
    document.documentId,
    document.patientId,
    document.category,
    document.title,
    document.content,
    document.source,
    document.status,
    document.version,
    document.createdAt,
    document.createdBy,
    document.updatedAt,
    document.updatedBy,
    document.filedAt,
    document.filedBy,
    document.correlationId,
    codingReviewValue(document.codingReview),
  ];
}

function documentFromRow(row: object): ClinicalDocument {
  return {
    schemaVersion: "1",
    documentId: rowText(row, "document_id"),
    patientId: rowText(row, "patient_id"),
    category: rowText(row, "category") as ClinicalDocument["category"],
    title: rowText(row, "title"),
    content: rowText(row, "content"),
    source: rowText(row, "source") as ClinicalDocument["source"],
    status: rowText(row, "status") as ClinicalDocument["status"],
    version: rowNumber(row, "version"),
    createdAt: rowText(row, "created_at"),
    createdBy: rowText(row, "created_by"),
    updatedAt: rowText(row, "updated_at"),
    updatedBy: rowText(row, "updated_by"),
    filedAt: rowNullableText(row, "filed_at"),
    filedBy: rowNullableText(row, "filed_by"),
    correlationId: rowText(row, "correlation_id"),
    codingReview: codingReviewFromRow(row),
  };
}

function codingReviewValue(review: ClinicalCodingReview | null): string | null {
  return review === null ? null : JSON.stringify(review);
}

function codingReviewFromRow(row: object): ClinicalCodingReview | null {
  const value = rowNullableText(row, "coding_review_json");
  return value === null ? null : (parseJson(value) as ClinicalCodingReview);
}

function rowValue(row: object, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

function rowText(row: object, key: string): string {
  const value = rowValue(row, key);
  if (typeof value !== "string") throw new Error(`Expected text column: ${key}`);
  return value;
}

function rowNullableText(row: object, key: string): string | null {
  const value = rowValue(row, key);
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`Expected nullable text column: ${key}`);
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
