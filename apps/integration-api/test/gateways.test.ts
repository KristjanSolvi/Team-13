import { describe, expect, it, vi } from "vitest";

import {
  HttpAgenticGateway,
  HttpMockEhrGateway,
  HttpPipelineGateway,
  HttpProfileGateway,
} from "../src/gateways.js";

describe("HTTP gateways", () => {
  it("posts attributed handover lifecycle calls to encoded agentic paths", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ replayed: false }), { status: 201 }),
    );
    const gateway = new HttpAgenticGateway(
      "http://agentic.test",
      1_000,
      "server-only-token",
      fetchImpl,
    );
    const meta = {
      actorId: "clinician:karen",
      correlationId: "corr-handover-1",
    };

    await gateway.createHandoverDraft(
      "patient/with spaces",
      {
        reason: "assignment",
        focus: null,
        idempotencyKey: "handover-karen-001",
      },
      meta,
    );
    await gateway.finalizeHandover(
      "handover/with spaces",
      {
        expectedVersion: 2,
        sourceSnapshotHash: `sha256:${"a".repeat(64)}`,
        rendered: { title: "Current handover", sections: [] },
      },
      meta,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetchImpl.mock.calls) {
      expect(new Headers(options?.headers).get("authorization")).toBe(
        "Bearer server-only-token",
      );
      expect(new Headers(options?.headers).get("x-actor-id")).toBe(
        "clinician:karen",
      );
      expect(new Headers(options?.headers).get("x-correlation-id")).toBe(
        "corr-handover-1",
      );
      expect(options?.method).toBe("POST");
      expect(String(url)).not.toContain("server-only-token");
    }
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "http://agentic.test/api/patients/patient%2Fwith%20spaces/handover-drafts",
    );
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      "http://agentic.test/api/handovers/handover%2Fwith%20spaces/finalize",
    );
  });

  it("calls the internal renderer with metadata but never an agentic bearer", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ title: "Current handover", sections: [] }),
        { status: 200 },
      ),
    );
    const gateway = new HttpPipelineGateway(
      "http://pipeline.test",
      1_000,
      fetchImpl,
    );

    await gateway.renderHandover(
      { handoverId: "11111111-1111-4111-8111-111111111111" },
      {
        actorId: "clinician:karen",
        correlationId: "corr-handover-1",
      },
    );

    const [url, options] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "http://pipeline.test/api/corti/handovers/render",
    );
    const headers = new Headers(options?.headers);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.get("x-actor-id")).toBe("clinician:karen");
    expect(headers.get("x-correlation-id")).toBe("corr-handover-1");
    expect(options?.method).toBe("POST");
  });

  it("maps dedicated renderer 422 failures to a safe retryable gateway error", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "UNSAFE_RENDERED_HANDOVER",
            message: "hidden unsafe output included a private prompt",
            retryable: false,
          },
        }),
        { status: 422 },
      ),
    );
    const gateway = new HttpPipelineGateway(
      "http://pipeline.test",
      1_000,
      fetchImpl,
    );

    await expect(
      gateway.renderHandover(
        { handoverId: "11111111-1111-4111-8111-111111111111" },
        { correlationId: "corr-handover-1" },
      ),
    ).rejects.toMatchObject({
      code: "HANDOVER_RENDER_FAILED",
      message: "The handover renderer rejected its output",
      status: 502,
      retryable: true,
    });
  });

  it("preserves 422 errors for generic allow-listed pipeline requests", async () => {
    const gateway = new HttpPipelineGateway(
      "http://pipeline.test",
      1_000,
      vi.fn<typeof fetch>(async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "PIPELINE_VALIDATION_FAILED",
              message: "Candidate input was invalid",
              retryable: false,
            },
          }),
          { status: 422 },
        ),
      ),
    );

    await expect(
      gateway.request(
        "/api/corti/candidates/generate",
        {},
        { correlationId: "corr-generic-422" },
      ),
    ).rejects.toMatchObject({
      code: "PIPELINE_VALIDATION_FAILED",
      status: 422,
      retryable: false,
    });
  });

  it("keeps the agentic credential server-side and forwards request metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ signalEventId: "event-1" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
    const gateway = new HttpAgenticGateway(
      "http://agentic.test",
      1_000,
      "server-only-token",
      fetchImpl,
    );

    await gateway.submitSignal(
      {
        patientId: "synthetic-karen",
        interactionId: "interaction-karen-1",
        signalText: "Dizziness needs follow-through",
        evidenceRefs: ["encounter:candidate-1.1"],
        sourceEvidence: [
          {
            evidenceRef: "encounter:candidate-1.1",
            sourceQuote: "I feel dizzy when I stand up.",
            startSeconds: 10,
            endSeconds: 12,
          },
        ],
        idempotencyKey: "candidate-candidate-1",
      },
      {
        actorId: "pipeline:candidate-handoff",
        correlationId: "corr-karen-1",
      },
    );

    const [url, options] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://agentic.test/api/signals");
    expect(options?.method).toBe("POST");
    const headers = new Headers(options?.headers);
    expect(headers.get("authorization")).toBe("Bearer server-only-token");
    expect(headers.get("x-actor-id")).toBe("pipeline:candidate-handoff");
    expect(headers.get("x-correlation-id")).toBe("corr-karen-1");
    expect(JSON.parse(String(options?.body))).toEqual({
      patientId: "synthetic-karen",
      interactionId: "interaction-karen-1",
      signalText: "Dizziness needs follow-through",
      evidenceRefs: ["encounter:candidate-1.1"],
      sourceEvidence: [
        {
          evidenceRef: "encounter:candidate-1.1",
          sourceQuote: "I feel dizzy when I stand up.",
          startSeconds: 10,
          endSeconds: 12,
        },
      ],
      idempotencyKey: "candidate-candidate-1",
    });
    expect(String(options?.body)).not.toContain("server-only-token");
  });

  it("does not send the application credential to the public health route", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const gateway = new HttpAgenticGateway(
      "http://agentic.test",
      1_000,
      "server-only-token",
      fetchImpl,
    );

    await gateway.health();

    const [, options] = fetchImpl.mock.calls[0] ?? [];
    expect(new Headers(options?.headers).has("authorization")).toBe(false);
  });

  it("rejects malformed authoritative list responses", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ threads: "not-an-array" }), { status: 200 }),
    );
    const gateway = new HttpAgenticGateway(
      "http://agentic.test",
      1_000,
      "server-only-token",
      fetchImpl,
    );

    await expect(
      gateway.listThreads("synthetic-karen", { correlationId: "corr-1" }),
    ).rejects.toMatchObject({ code: "UPSTREAM_INVALID_RESPONSE", status: 502 });
  });

  it("validates the pipeline health contract", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          status: "ok",
          cortiConfigured: false,
          missingCortiVariables: ["CORTI_CLIENT_ID"],
        }),
        { status: 200 },
      ),
    );
    const gateway = new HttpPipelineGateway(
      "http://pipeline.test",
      1_000,
      fetchImpl,
    );

    await expect(gateway.health()).resolves.toEqual({
      status: "ok",
      cortiConfigured: false,
      missingCortiVariables: ["CORTI_CLIENT_ID"],
    });
  });

  it("forwards allow-listed pipeline calls without an application bearer", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    );
    const gateway = new HttpPipelineGateway(
      "http://pipeline.test",
      1_000,
      fetchImpl,
    );

    await expect(gateway.request(
      "/api/corti/candidates/generate",
      { patientId: "synthetic-karen" },
      { correlationId: "corr-pipeline-1" },
    )).resolves.toEqual({ status: 200, body: { candidates: [] } });

    const [url, options] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "http://pipeline.test/api/corti/candidates/generate",
    );
    const headers = new Headers(options?.headers);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.get("x-correlation-id")).toBe("corr-pipeline-1");
  });

  it("opens the event stream with server credentials and resume metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response("id: 43\nevent: task.approved\ndata: {}\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const gateway = new HttpAgenticGateway(
      "http://agentic.test",
      1_000,
      "server-only-token",
      fetchImpl,
    );

    const stream = await gateway.eventStream(
      "42",
      { correlationId: "corr-stream-1" },
      new AbortController().signal,
    );
    const chunk = await stream.getReader().read();

    expect(new TextDecoder().decode(chunk.value)).toContain("task.approved");
    const [url, options] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://agentic.test/api/events/stream");
    const headers = new Headers(options?.headers);
    expect(headers.get("authorization")).toBe("Bearer server-only-token");
    expect(headers.get("last-event-id")).toBe("42");
    expect(headers.get("x-correlation-id")).toBe("corr-stream-1");
  });

  it("keeps profile credentials server-side and forwards attributed PATCH metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ patientId: "synthetic-karen", version: 3 }), {
        status: 200,
      }),
    );
    const gateway = new HttpProfileGateway(
      "http://profile.test",
      1_000,
      "profile-private-token",
      fetchImpl,
    );
    const body = {
      expectedVersion: 2,
      idempotencyKey: "profile-update-001",
      reason: "Patient confirmed discharge plan",
      changes: { flow: { homeTomorrow: true } },
    };

    await gateway.updateProfile("synthetic-karen", body, {
      actorId: "clinician:marriott",
      correlationId: "corr-profile-1",
    });

    const [url, options] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "http://profile.test/api/patients/synthetic-karen/profile",
    );
    expect(options?.method).toBe("PATCH");
    const headers = new Headers(options?.headers);
    expect(headers.get("authorization")).toBe("Bearer profile-private-token");
    expect(headers.get("x-actor-id")).toBe("clinician:marriott");
    expect(headers.get("x-correlation-id")).toBe("corr-profile-1");
  });

  it("rejects a malformed profile response", async () => {
    const gateway = new HttpProfileGateway(
      "http://profile.test",
      1_000,
      "profile-private-token",
      vi.fn<typeof fetch>(async () =>
        new Response(JSON.stringify("not-an-object"), { status: 200 }),
      ),
    );

    await expect(
      gateway.getProfile("synthetic-karen", { correlationId: "corr-profile-1" }),
    ).rejects.toMatchObject({ code: "UPSTREAM_INVALID_RESPONSE", status: 502 });
  });

  it("validates mock-EHR document lists and keeps its credential private", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ documents: [{ documentId: "document-1" }] }), {
        status: 200,
      }),
    );
    const gateway = new HttpMockEhrGateway(
      "http://mock-ehr.test",
      1_000,
      "mock-ehr-private-token",
      fetchImpl,
    );

    await expect(
      gateway.listDocuments("synthetic-karen", { correlationId: "corr-ehr-1" }),
    ).resolves.toEqual([{ documentId: "document-1" }]);
    const [url, options] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "http://mock-ehr.test/api/patients/synthetic-karen/documents",
    );
    expect(new Headers(options?.headers).get("authorization")).toBe(
      "Bearer mock-ehr-private-token",
    );
  });
});
