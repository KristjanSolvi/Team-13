/**
 * Drives one complete ward-meeting reconciliation over the integration API:
 * start meeting -> open a patient segment -> append attributed transcript
 * evidence -> close the segment (which runs the ward-meeting Corti agent) ->
 * complete the meeting -> print the reconciliation.
 *
 * Requires the integration API (8790) and the agentic backend (3000) to be
 * running, plus CORTI_MEETING_AGENT_ID provisioned for the live agent step.
 *
 *   INTEGRATION_API_BEARER_TOKEN=... npm run demo:meeting
 */

const baseUrl = process.env.INTEGRATION_API_BASE_URL ?? "http://127.0.0.1:8790";
const patientId = process.env.MEETING_PATIENT_ID ?? "synthetic-karen";
const actorId = process.env.MEETING_ACTOR_ID ?? "clinician:demo";
const wardId = process.env.MEETING_WARD_ID ?? "north-wing-l4";
const bearerToken = process.env.INTEGRATION_API_BEARER_TOKEN;
if (bearerToken === undefined || bearerToken.length < 8) {
  throw new Error(
    "INTEGRATION_API_BEARER_TOKEN must contain at least 8 characters",
  );
}

const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(
      `Expected an object response, received: ${JSON.stringify(value)}`,
    );
  }
  return value as Record<string, unknown>;
}

function pick(value: unknown, ...path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    current = asRecord(current)[key];
  }
  return current;
}

async function request(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(new URL(path, baseUrl), {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${bearerToken}`,
      "content-type": "application/json",
      "x-actor-id": actorId,
      "x-correlation-id": `meeting-demo-${runId}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = asRecord(asRecord(payload).error ?? payload);
    const code =
      typeof error.code === "string" ? error.code : `HTTP_${response.status}`;
    if (code.includes("AGENT_NOT_CONFIGURED")) {
      throw new Error(
        "The ward-meeting Corti agent is not provisioned. Set CORTI_MEETING_AGENT_ID " +
          "on the agentic backend (npm run agent:provision) and restart it, then rerun.",
      );
    }
    throw new Error(
      `${path} failed with ${code}: ${typeof error.message === "string" ? error.message : response.status}`,
    );
  }
  return payload;
}

function step(title: string): void {
  console.log(`\n=== ${title} ===`);
}

// A short board-round exchange about the demo patient: one commitment the
// agent should draft, spoken plainly enough to quote verbatim as evidence.
const transcript = [
  {
    segmentKey: `meeting-${runId}-1`,
    text: "Next is Karen in bed four. Blood pressure has settled but she was dizzy again this morning when standing.",
    startSeconds: 0,
    endSeconds: 9,
    speakerId: 0,
    isFinal: true,
    audioQuality: "clear",
  },
  {
    segmentKey: `meeting-${runId}-2`,
    text: "Let's ask district nursing to repeat the standing blood pressure at home within two days of discharge.",
    startSeconds: 9,
    endSeconds: 17,
    speakerId: 1,
    isFinal: true,
    audioQuality: "clear",
  },
  {
    segmentKey: `meeting-${runId}-3`,
    text: "Agreed. Nothing else outstanding for her from this meeting.",
    startSeconds: 17,
    endSeconds: 21,
    speakerId: 0,
    isFinal: true,
    audioQuality: "clear",
  },
];

step("1 · Start ward meeting (creates a scoped Corti Ambient interaction)");
const started = await request("/api/ward-meetings", {
  wardId,
  idempotencyKey: `meeting-start-${runId}`,
});
const meetingId = String(pick(started, "meeting", "meetingId"));
let meetingVersion = Number(pick(started, "meeting", "version"));
console.log({
  meetingId,
  interactionId: pick(started, "meeting", "interactionId"),
  meetingVersion,
});

step(`2 · Open a patient segment · clinician explicitly selects ${patientId}`);
const opened = await request(`/api/ward-meetings/${meetingId}/segments`, {
  patientId,
  expectedMeetingVersion: meetingVersion,
  idempotencyKey: `segment-open-${runId}`,
});
const segmentId = String(pick(opened, "segment", "segmentId"));
meetingVersion = Number(pick(opened, "meeting", "version"));
const segmentVersion = Number(pick(opened, "segment", "version"));
console.log({ segmentId, segmentVersion, meetingVersion });

step("3 · Append the final transcript as patient-scoped evidence");
await request(`/api/ward-meetings/${meetingId}/transcript-segments`, {
  patientSegmentId: segmentId,
  segments: transcript,
  idempotencyKey: `transcript-${runId}`,
});
console.log({ appendedSegments: transcript.length });

step("4 · Close the segment · the ward-meeting Corti agent reconciles it");
console.log(
  "(fresh Agentic context, MCP tools, draft-only output — may take a moment)",
);
const closed = await request(
  `/api/ward-meetings/${meetingId}/segments/${segmentId}/close`,
  {
    expectedMeetingVersion: meetingVersion,
    expectedSegmentVersion: segmentVersion,
    idempotencyKey: `segment-close-${runId}`,
  },
);
console.log(JSON.stringify(asRecord(closed).reconciliation ?? closed, null, 2));

step("5 · Complete the meeting");
const latest = await request(`/api/ward-meetings/${meetingId}`);
const completed = await request(`/api/ward-meetings/${meetingId}/complete`, {
  expectedMeetingVersion: Number(pick(latest, "meeting", "version")),
  idempotencyKey: `meeting-complete-${runId}`,
});
console.log({ status: pick(completed, "meeting", "status") });

step("6 · Final meeting state");
const final = await request(`/api/ward-meetings/${meetingId}`);
console.log(JSON.stringify(final, null, 2));

console.log(
  "\nDone. Draft tasks proposed by the meeting agent remain unapproved: review",
  "and approve them in the ward UI to publish them to the receiving team.",
);
