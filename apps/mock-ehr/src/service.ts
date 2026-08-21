import { createHash, randomUUID } from "node:crypto";

import type {
  ClinicalCodingReview,
  ClinicalDocument,
  ClinicalDocumentVersion,
  CreateDocumentInput,
  FileDocumentInput,
  ReviseDocumentInput,
} from "./contracts.js";
import { MockEhrError } from "./errors.js";
import type { MockEhrStore } from "./store.js";

export class MockEhrService {
  constructor(
    private readonly store: MockEhrStore,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
  ) {}

  createDocument(
    patientId: string,
    input: CreateDocumentInput,
    actorId: string,
    correlationId: string,
  ): ClinicalDocument {
    const occurredAt = this.now().toISOString();
    return this.store.runIdempotent(
      `document:create:${patientId}`,
      input.idempotencyKey,
      requestHash(input),
      occurredAt,
      () => {
        const document: ClinicalDocument = {
          schemaVersion: "1",
          documentId: this.newId(),
          patientId,
          category: input.category,
          title: input.title,
          content: input.content,
          source: input.source,
          status: "draft",
          version: 1,
          createdAt: occurredAt,
          createdBy: actorId,
          updatedAt: occurredAt,
          updatedBy: actorId,
          filedAt: null,
          filedBy: null,
          correlationId,
          codingReview: stampCodingReview(input.codingReview, actorId, occurredAt),
        };
        this.store.insertDocument(document, "Document draft created");
        return document;
      },
    );
  }

  getDocument(documentId: string): ClinicalDocument {
    return this.requireDocument(documentId);
  }

  listPatientDocuments(patientId: string): ClinicalDocument[] {
    return this.store.listPatientDocuments(patientId);
  }

  reviseDocument(
    documentId: string,
    input: ReviseDocumentInput,
    actorId: string,
    correlationId: string,
  ): ClinicalDocument {
    const occurredAt = this.now().toISOString();
    return this.store.runIdempotent(
      `document:revise:${documentId}`,
      input.idempotencyKey,
      requestHash(input),
      occurredAt,
      () => {
        const current = this.requireDocument(documentId);
        this.requireExpectedVersion(current, input.expectedVersion);
        if (current.status === "filed") {
          throw new MockEhrError(
            "DOCUMENT_FILED",
            "A filed document cannot be revised",
            409,
          );
        }
        const title = input.changes.title ?? current.title;
        const content = input.changes.content ?? current.content;
        const codingReview =
          input.changes.codingReview === undefined
            ? current.codingReview
            : stampCodingReview(input.changes.codingReview, actorId, occurredAt);
        if (
          title === current.title &&
          content === current.content &&
          JSON.stringify(codingReview) === JSON.stringify(current.codingReview)
        ) {
          throw new MockEhrError(
            "NO_DOCUMENT_CHANGES",
            "Document revision does not change any values",
          );
        }
        const updated: ClinicalDocument = {
          ...current,
          title,
          content,
          codingReview,
          version: current.version + 1,
          updatedAt: occurredAt,
          updatedBy: actorId,
          correlationId,
        };
        this.store.replaceDocument(current.version, updated, input.reason);
        return updated;
      },
    );
  }

  fileDocument(
    documentId: string,
    input: FileDocumentInput,
    actorId: string,
    correlationId: string,
  ): ClinicalDocument {
    const occurredAt = this.now().toISOString();
    return this.store.runIdempotent(
      `document:file:${documentId}`,
      input.idempotencyKey,
      requestHash(input),
      occurredAt,
      () => {
        const current = this.requireDocument(documentId);
        this.requireExpectedVersion(current, input.expectedVersion);
        if (current.status === "filed") {
          throw new MockEhrError(
            "DOCUMENT_ALREADY_FILED",
            "Clinical document is already filed",
            409,
          );
        }
        const filed: ClinicalDocument = {
          ...current,
          status: "filed",
          version: current.version + 1,
          updatedAt: occurredAt,
          updatedBy: actorId,
          filedAt: occurredAt,
          filedBy: actorId,
          correlationId,
        };
        this.store.replaceDocument(current.version, filed, input.reason);
        return filed;
      },
    );
  }

  listHistory(documentId: string): ClinicalDocumentVersion[] {
    this.requireDocument(documentId);
    return this.store.listVersions(documentId);
  }

  private requireDocument(documentId: string): ClinicalDocument {
    const document = this.store.getDocument(documentId);
    if (!document) {
      throw new MockEhrError(
        "DOCUMENT_NOT_FOUND",
        "Clinical document not found",
        404,
      );
    }
    return document;
  }

  private requireExpectedVersion(document: ClinicalDocument, expectedVersion: number): void {
    if (document.version !== expectedVersion) {
      throw new MockEhrError(
        "VERSION_CONFLICT",
        "Clinical document changed before this update was applied",
        409,
      );
    }
  }
}

function stampCodingReview(
  review: CreateDocumentInput["codingReview"] | null | undefined,
  actorId: string,
  reviewedAt: string,
): ClinicalCodingReview | null {
  return review == null ? null : { ...review, reviewedAt, reviewedBy: actorId };
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
