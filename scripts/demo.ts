import "dotenv/config";

import type { Task } from "../src/domain/types.js";

const appToken = process.env.APP_BEARER_TOKEN;
if (!appToken) throw new Error("APP_BEARER_TOKEN is required");

const base = (
  process.env.API_BASE_URL ??
  `http://127.0.0.1:${process.env.PORT ?? "3000"}`
).replace(/\/+$/, "");
const runId = Date.now().toString(36);
const failure = process.argv.includes("--failure");

async function request<T>(
  path: string,
  init: RequestInit = {},
  actorId = "demo-operator",
): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${appToken}`,
      "x-actor-id": actorId,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      `${path}: ${response.status} ${JSON.stringify(body)}`,
    );
  }
  return body as T;
}

const before = await request<{ tasks: Task[] }>(
  "/api/patients/synthetic-karen/tasks",
);
const existingTaskIds = new Set(before.tasks.map((task) => task.taskId));
const interactionId = `interaction-karen-${runId}`;
const evidenceRef = `encounter:candidate-${runId}.1`;
const signal = await request<Record<string, unknown>>(
  "/api/signals",
  {
    method: "POST",
    body: JSON.stringify({
      patientId: "synthetic-karen",
      interactionId,
      signalText:
        "Karen reports dizziness since a medication change; her daughter does not know who will check blood pressure.",
      evidenceRefs: [evidenceRef],
      sourceEvidence: [
        {
          evidenceRef,
          sourceQuote:
            "I've been dizzy since the medication changed, and nobody has arranged a blood pressure check.",
          startSeconds: 42.1,
          endSeconds: 48.6,
          speakerId: 1,
        },
      ],
      idempotencyKey: `signal-${runId}`,
    }),
  },
  "pipeline:candidate-handoff",
);
console.log("signal", signal);

const patientTasks = await request<{ tasks: Task[] }>(
  "/api/patients/synthetic-karen/tasks",
);
const draft = patientTasks.tasks
  .toReversed()
  .find(
    (task) => task.state === "draft" && !existingTaskIds.has(task.taskId),
  );
if (!draft) {
  throw new Error(
    "The signal was retained, but no new draft exists. Configure CORTI_AGENT_ID or create the clinician task through /api/tasks/manual.",
  );
}

const approved = await request<{ task: Task }>(
  `/api/tasks/${draft.taskId}/approve`,
  {
    method: "POST",
    body: JSON.stringify({
      expectedVersion: draft.version,
      approvalChannel: "app_one_tap",
      idempotencyKey: `approve-${runId}`,
    }),
  },
  "clinician-1",
);
console.log("approved-and-published", approved.task);

if (failure) {
  await request<{ now: string }>("/api/demo/advance-clock", {
    method: "POST",
    body: JSON.stringify({
      milliseconds: 30 * 60_000,
      idempotencyKey: `clock-${runId}`,
    }),
  });
  console.log(
    "timeout-assignment",
    await request<Task>(`/api/tasks/${draft.taskId}`),
  );
} else {
  const accepted = await request<Task>(
    `/api/tasks/${draft.taskId}/accept`,
    {
      method: "POST",
      body: JSON.stringify({
        expectedVersion: approved.task.version,
        idempotencyKey: `accept-${runId}`,
      }),
    },
    "nurse-a",
  );
  const outcomeRef = `record:mock-bp-${runId}`;
  const completed = await request<Task>(
    `/api/tasks/${draft.taskId}/complete`,
    {
      method: "POST",
      body: JSON.stringify({
        expectedVersion: accepted.version,
        outcomeRef,
        idempotencyKey: `complete-${runId}`,
      }),
    },
    "nurse-a",
  );
  const verified = await request<Task>(
    `/api/tasks/${draft.taskId}/verify`,
    {
      method: "POST",
      body: JSON.stringify({
        expectedVersion: completed.version,
        outcomeRef,
        idempotencyKey: `verify-${runId}`,
      }),
    },
    "downstream:mock-bp-system",
  );
  console.log("verified", verified);
}

console.log(
  "events",
  await request<Record<string, unknown>>("/api/events?after=0"),
);
