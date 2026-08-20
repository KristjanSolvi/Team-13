import { beforeEach, describe, expect, it } from "vitest";

import { openMockEhrDatabase } from "../src/database.js";
import { MockEhrService } from "../src/service.js";
import { MockEhrStore } from "../src/store.js";

describe("mock EHR document service", () => {
  let service: MockEhrService;
  let tick: number;

  beforeEach(() => {
    tick = 0;
    service = new MockEhrService(
      new MockEhrStore(openMockEhrDatabase(":memory:")),
      () => new Date(`2026-08-20T12:00:0${tick++}.000Z`),
      () => "document-1",
    );
  });

  it("creates an attributed draft and lists it only for its patient", () => {
    const created = service.createDocument(
      "synthetic-karen",
      {
        idempotencyKey: "document-create-001",
        category: "medical",
        title: "Ward round note",
        content: "Improving on nebulisers; await CT chest.",
        source: "scribe",
      },
      "clinician:marriott",
      "corr-create-1",
    );

    expect(created).toMatchObject({
      schemaVersion: "1",
      documentId: "document-1",
      patientId: "synthetic-karen",
      category: "medical",
      status: "draft",
      version: 1,
      createdBy: "clinician:marriott",
      correlationId: "corr-create-1",
      filedAt: null,
      filedBy: null,
    });
    expect(service.listPatientDocuments("synthetic-karen")).toEqual([created]);
    expect(service.listPatientDocuments("synthetic-sarah")).toEqual([]);
  });

  it("revises a draft with optimistic versioning and retains its history", () => {
    service.createDocument(
      "synthetic-karen",
      {
        idempotencyKey: "document-create-001",
        category: "discharge",
        title: "Discharge summary",
        content: "Draft discharge plan.",
        source: "agent",
      },
      "agent:ward-threads",
      "corr-create-1",
    );

    const revised = service.reviseDocument(
      "document-1",
      {
        expectedVersion: 1,
        idempotencyKey: "document-revise-001",
        reason: "CT result added after clinical review",
        changes: { content: "Draft discharge plan. CT result reviewed." },
      },
      "clinician:marriott",
      "corr-revise-1",
    );

    expect(revised).toMatchObject({
      version: 2,
      content: "Draft discharge plan. CT result reviewed.",
      updatedBy: "clinician:marriott",
      correlationId: "corr-revise-1",
    });
    expect(service.listHistory("document-1")).toMatchObject([
      { version: 2, changeReason: "CT result added after clinical review" },
      { version: 1, changeReason: "Document draft created" },
    ]);
  });

  it("files the reviewed version idempotently and makes it immutable", () => {
    service.createDocument(
      "synthetic-karen",
      {
        idempotencyKey: "document-create-001",
        category: "medical",
        title: "Ward round note",
        content: "Reviewed clinical note.",
        source: "clinician",
      },
      "clinician:marriott",
      "corr-create-1",
    );
    const command = {
      expectedVersion: 1,
      idempotencyKey: "document-file-001",
      reason: "Clinician approved for the record",
    };

    const filed = service.fileDocument(
      "document-1",
      command,
      "clinician:marriott",
      "corr-file-1",
    );

    expect(filed).toMatchObject({
      status: "filed",
      version: 2,
      filedAt: "2026-08-20T12:00:01.000Z",
      filedBy: "clinician:marriott",
    });
    expect(
      service.fileDocument(
        "document-1",
        command,
        "clinician:marriott",
        "corr-file-1",
      ),
    ).toEqual(filed);
    expect(() =>
      service.reviseDocument(
        "document-1",
        {
          expectedVersion: 2,
          idempotencyKey: "document-revise-002",
          reason: "Attempt to alter filed note",
          changes: { content: "Changed after filing." },
        },
        "clinician:marriott",
        "corr-revise-2",
      ),
    ).toThrow(/filed document cannot be revised/i);
  });

  it("rejects stale writes and idempotency-key reuse with different input", () => {
    service.createDocument(
      "synthetic-karen",
      {
        idempotencyKey: "document-create-001",
        category: "medical",
        title: "Ward round note",
        content: "First draft.",
        source: "scribe",
      },
      "clinician:marriott",
      "corr-create-1",
    );
    const revision = {
      expectedVersion: 1,
      idempotencyKey: "document-revise-001",
      reason: "Clinician corrected wording",
      changes: { content: "Reviewed draft." },
    } as const;
    service.reviseDocument(
      "document-1",
      revision,
      "clinician:marriott",
      "corr-revise-1",
    );

    expect(() =>
      service.reviseDocument(
        "document-1",
        {
          ...revision,
          changes: { content: "Different content." },
        },
        "clinician:marriott",
        "corr-revise-1",
      ),
    ).toThrow(/different request/i);
    expect(() =>
      service.reviseDocument(
        "document-1",
        {
          ...revision,
          idempotencyKey: "document-revise-002",
        },
        "clinician:marriott",
        "corr-revise-2",
      ),
    ).toThrow(/changed before/i);
  });
});
