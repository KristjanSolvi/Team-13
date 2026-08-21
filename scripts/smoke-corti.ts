import { randomUUID } from "node:crypto";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || value.startsWith("replace-with-")) {
    throw new Error(`${name} must be configured before the paid smoke test`);
  }
  return value;
}

const appBearerToken = required("APP_BEARER_TOKEN");
required("CORTI_AGENT_ID");
const port = Number(process.env.PORT ?? "3000");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be a valid TCP port");
}

const runId = randomUUID();
const evidenceRef = `encounter:corti-smoke-${runId}`;
const response = await fetch(`http://127.0.0.1:${port}/api/signals`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${appBearerToken}`,
    "content-type": "application/json",
    "x-actor-id": "corti-smoke",
    "x-correlation-id": `corti-smoke-${runId}`,
  },
  body: JSON.stringify({
    patientId: "synthetic-karen",
    interactionId: `interaction-corti-smoke-${runId}`,
    signalText:
      "Synthetic patient reports dizziness after a medication change and may need a blood-pressure check.",
    evidenceRefs: [evidenceRef],
    sourceEvidence: [
      {
        evidenceRef,
        sourceQuote:
          "I still feel dizzy when I stand up since the medication changed.",
        startSeconds: 10,
        endSeconds: 14,
        speakerId: 1,
      },
    ],
    idempotencyKey: `corti-smoke-${runId}`,
  }),
  signal: AbortSignal.timeout(190_000),
});

if (!response.ok) {
  throw new Error(`Corti smoke request failed with HTTP ${response.status}`);
}

const result: unknown = await response.json();
if (
  typeof result !== "object" ||
  result === null ||
  typeof (result as Record<string, unknown>).contextId !== "string" ||
  typeof (result as Record<string, unknown>).agentState !== "string"
) {
  throw new Error("Corti smoke response did not contain an agent result");
}
const record = result as Record<string, unknown>;
console.log(
  JSON.stringify(
    {
      contextId: record.contextId,
      taskId:
        typeof record.cortiTaskId === "string" ? record.cortiTaskId : null,
      state: record.agentState,
      credits: typeof record.credits === "number" ? record.credits : null,
    },
    null,
    2,
  ),
);
