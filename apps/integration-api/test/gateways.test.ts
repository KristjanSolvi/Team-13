import { describe, expect, it, vi } from "vitest";

import {
  HttpAgenticGateway,
  HttpPipelineGateway,
} from "../src/gateways.js";

describe("HTTP gateways", () => {
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
});
