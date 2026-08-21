const baseUrl = process.env.INTEGRATION_API_BASE_URL ?? "http://127.0.0.1:8790";
const patientId = process.env.HANDOVER_PATIENT_ID ?? "synthetic-karen";
const actorId = process.env.HANDOVER_ACTOR_ID ?? "clinician:demo";
const bearerToken = process.env.INTEGRATION_API_BEARER_TOKEN;
if (bearerToken === undefined || bearerToken.length < 8) {
  throw new Error(
    "INTEGRATION_API_BEARER_TOKEN must contain at least 8 characters",
  );
}

const response = await fetch(
  new URL(`/api/patients/${encodeURIComponent(patientId)}/handovers`, baseUrl),
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${bearerToken}`,
      "content-type": "application/json",
      "x-actor-id": actorId,
      "x-correlation-id": "handover-smoke-1",
    },
    body: JSON.stringify({
      idempotencyKey: "handover-smoke-1",
      reason: "on_demand",
      focus: null,
    }),
  },
);
const body: unknown = await response.json();
if (!response.ok || typeof body !== "object" || body === null) {
  throw new Error(`Handover smoke failed with HTTP ${response.status}`);
}
const value = body as Record<string, unknown>;
console.log(
  JSON.stringify(
    {
      handoverId: value.handoverId,
      patientId: value.patientId,
      status: value.status,
      sourceSnapshotHash: value.sourceSnapshotHash,
    },
    null,
    2,
  ),
);
