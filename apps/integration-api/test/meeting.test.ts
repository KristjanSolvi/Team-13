import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createIntegrationApp } from "../src/app.js";
import type {
  AgenticGateway,
  PipelineGateway,
  RequestMeta,
} from "../src/gateways.js";
import { IntegrationService } from "../src/service.js";

const PUBLIC_TOKEN = "meeting-public-token";
const MEETING_ID = "11111111-1111-4111-8111-111111111111";
const SEGMENT_ID = "22222222-2222-4222-8222-222222222222";

type MeetingAgenticGateway = AgenticGateway & {
  startWardMeeting(body: unknown, meta: RequestMeta): Promise<unknown>;
  openMeetingSegment(
    meetingId: string,
    body: unknown,
    meta: RequestMeta,
  ): Promise<unknown>;
  appendMeetingTranscript(
    meetingId: string,
    body: unknown,
    meta: RequestMeta,
  ): Promise<unknown>;
  closeMeetingSegment(
    meetingId: string,
    segmentId: string,
    body: unknown,
    meta: RequestMeta,
  ): Promise<unknown>;
  reconcileMeetingSegment(
    meetingId: string,
    segmentId: string,
    body: unknown,
    meta: RequestMeta,
  ): Promise<unknown>;
  completeWardMeeting(
    meetingId: string,
    body: unknown,
    meta: RequestMeta,
  ): Promise<unknown>;
  getWardMeeting(meetingId: string, meta: RequestMeta): Promise<unknown>;
};

function harness() {
  const calls: string[] = [];
  const meeting = {
    meetingId: MEETING_ID,
    wardId: "ward-13",
    interactionId: "interaction-meeting-13",
    status: "recording",
    startedBy: "clinician:evelyn",
    startedAt: "2026-08-20T10:00:00.000Z",
    completedAt: null,
    version: 1,
  };
  const segment = {
    segmentId: SEGMENT_ID,
    meetingId: MEETING_ID,
    patientId: "synthetic-karen",
    status: "recording",
    openedBy: "clinician:evelyn",
    openedAt: "2026-08-20T10:01:00.000Z",
    closedAt: null,
    version: 1,
  };
  const agentic: MeetingAgenticGateway = {
    health: vi.fn(async () => ({ ok: true })),
    submitSignal: vi.fn(async () => ({})),
    listThreads: vi.fn(async () => []),
    listTasks: vi.fn(async () => []),
    taskCommand: vi.fn(async () => ({})),
    verifyExternal: vi.fn(async () => ({})),
    createDemoSession: vi.fn(async () => ({})),
    getDemoSession: vi.fn(async () => ({})),
    joinDemoSession: vi.fn(async () => ({})),
    assignDemoTask: vi.fn(async () => ({})),
    demoParticipantView: vi.fn(async () => ({})),
    eventStream: vi.fn(async () => new ReadableStream<Uint8Array>()),
    startWardMeeting: vi.fn(async () => {
      calls.push("start");
      return { meeting, replayed: false };
    }),
    openMeetingSegment: vi.fn(async () => {
      calls.push("open");
      return { meeting: { ...meeting, version: 2 }, segment, replayed: false };
    }),
    appendMeetingTranscript: vi.fn(async () => {
      calls.push("transcript");
      return { evidence: [], ignoredInterimCount: 1, replayed: false };
    }),
    closeMeetingSegment: vi.fn(async () => {
      calls.push("close");
      return {
        meeting: { ...meeting, version: 3 },
        segment: { ...segment, status: "closed", version: 2 },
        replayed: false,
      };
    }),
    reconcileMeetingSegment: vi.fn(async () => {
      calls.push("reconcile");
      return {
        replayed: false,
        reconciliation: {
          reconciliationId: "33333333-3333-4333-8333-333333333333",
          meetingId: MEETING_ID,
          patientSegmentId: SEGMENT_ID,
          patientId: "synthetic-karen",
          status: "saved",
          newDraftTaskIds: [],
          carryForwardTaskRefs: [],
          version: 2,
        },
        newDraftTasks: [],
        carryForwards: [],
      };
    }),
    completeWardMeeting: vi.fn(async () => {
      calls.push("complete");
      return {
        meeting: {
          ...meeting,
          status: "completed",
          completedAt: "2026-08-20T10:10:00.000Z",
          version: 4,
        },
        replayed: false,
      };
    }),
    getWardMeeting: vi.fn(async () => {
      calls.push("get");
      return { meeting, segments: [], unscopedTranscriptCount: 0 };
    }),
  };
  const pipeline: PipelineGateway = {
    health: vi.fn(async () => ({
      status: "ok",
      cortiConfigured: true,
      missingCortiVariables: [],
    })),
    request: vi.fn(async (path) => {
      calls.push("ambient");
      expect(path).toBe("/api/corti/ambient/session");
      return {
        status: 201,
        body: {
          interactionId: "interaction-meeting-13",
          accessToken: "ambient-browser-token",
          expiresIn: 300,
          tenantName: "tenant",
          environment: "eu",
          primaryLanguage: "en",
          outputLanguage: "en",
        },
      };
    }),
  };
  const app = createIntegrationApp({
    service: new IntegrationService(agentic, pipeline),
    integrationApiBearerToken: PUBLIC_TOKEN,
  });
  return { agentic, pipeline, app, calls };
}

const headers = {
  authorization: `Bearer ${PUBLIC_TOKEN}`,
  "x-actor-id": "clinician:evelyn",
  "x-correlation-id": "corr-meeting-public",
};

describe("public ward meeting lifecycle", () => {
  it("publishes the authenticated meeting surface in OpenAPI", async () => {
    const { app } = harness();
    const response = await request(app).get("/openapi.json").expect(200);

    for (const path of [
      "/api/ward-meetings",
      "/api/ward-meetings/{meetingId}",
      "/api/ward-meetings/{meetingId}/segments",
      "/api/ward-meetings/{meetingId}/transcript-segments",
      "/api/ward-meetings/{meetingId}/segments/{segmentId}/close",
      "/api/ward-meetings/{meetingId}/complete",
    ]) {
      expect(response.body.paths).toHaveProperty(path);
    }
    expect(response.body.paths["/api/ward-meetings"].post.security).toEqual([
      { integrationBearer: [] },
    ]);
    expect(response.body.components.schemas).toHaveProperty("WardMeeting");
    expect(response.body.components.schemas).toHaveProperty(
      "PatientMeetingSegment",
    );
  });

  it("authenticates before starting Ambient or changing meeting state", async () => {
    const { agentic, pipeline, app } = harness();

    await request(app)
      .post("/api/ward-meetings")
      .send({ wardId: "ward-13", idempotencyKey: "meeting-public-start" })
      .expect(401);

    expect(pipeline.request).not.toHaveBeenCalled();
    expect(agentic.startWardMeeting).not.toHaveBeenCalled();
  });

  it("reuses the original ledger interaction on an Ambient start retry", async () => {
    const { agentic, pipeline, app } = harness();
    vi.mocked(pipeline.request).mockResolvedValueOnce({
      status: 201,
      body: {
        interactionId: "replacement-corti-interaction",
        accessToken: "replacement-ambient-token",
        expiresIn: 300,
        tenantName: "tenant",
        environment: "eu",
        primaryLanguage: "en",
        outputLanguage: "en",
      },
    });
    vi.mocked(agentic.startWardMeeting).mockResolvedValueOnce({
      replayed: true,
      meeting: {
        meetingId: MEETING_ID,
        wardId: "ward-13",
        interactionId: "original-corti-interaction",
        status: "recording",
        startedBy: "clinician:evelyn",
        startedAt: "2026-08-20T10:00:00.000Z",
        completedAt: null,
        version: 1,
      },
    });

    const response = await request(app)
      .post("/api/ward-meetings")
      .set(headers)
      .send({ wardId: "ward-13", idempotencyKey: "meeting-public-start" })
      .expect(200);

    expect(response.body.meeting.interactionId).toBe(
      "original-corti-interaction",
    );
    expect(response.body.ambientSession).toMatchObject({
      interactionId: "original-corti-interaction",
      accessToken: "replacement-ambient-token",
    });
  });

  it("starts Ambient, keeps patient selection explicit, and reconciles automatically on close", async () => {
    const { agentic, pipeline, app, calls } = harness();

    const started = await request(app)
      .post("/api/ward-meetings")
      .set(headers)
      .send({
        wardId: "ward-13",
        encounterIdentifier: "ward-13-board-round",
        idempotencyKey: "meeting-public-start",
      })
      .expect(201);
    expect(started.body.ambientSession.accessToken).toBe(
      "ambient-browser-token",
    );
    expect(started.body.meeting.interactionId).toBe(
      started.body.ambientSession.interactionId,
    );

    await request(app)
      .post(`/api/ward-meetings/${MEETING_ID}/segments`)
      .set(headers)
      .send({
        patientId: "synthetic-karen",
        expectedMeetingVersion: 1,
        idempotencyKey: "meeting-public-open",
      })
      .expect(201);

    await request(app)
      .post(`/api/ward-meetings/${MEETING_ID}/transcript-segments`)
      .set(headers)
      .send({
        patientSegmentId: SEGMENT_ID,
        idempotencyKey: "meeting-public-transcript",
        segments: [
          {
            segmentKey: "interaction-meeting-13:1",
            text: "Please ask pharmacy to review the medicines.",
            startSeconds: 1,
            endSeconds: 4,
            isFinal: true,
            audioQuality: "clear",
          },
        ],
      })
      .expect(201);

    const closed = await request(app)
      .post(`/api/ward-meetings/${MEETING_ID}/segments/${SEGMENT_ID}/close`)
      .set(headers)
      .send({
        expectedMeetingVersion: 2,
        expectedSegmentVersion: 1,
        idempotencyKey: "meeting-public-close",
      })
      .expect(201);

    expect(closed.body.segment.status).toBe("closed");
    expect(closed.body.reconciliation.status).toBe("saved");
    expect(calls).toEqual([
      "ambient",
      "start",
      "open",
      "transcript",
      "close",
      "reconcile",
    ]);
    expect(agentic.reconcileMeetingSegment).toHaveBeenCalledWith(
      MEETING_ID,
      SEGMENT_ID,
      {
        expectedSegmentVersion: 2,
        idempotencyKey: expect.stringMatching(/^meeting-close:/),
      },
      {
        actorId: "clinician:evelyn",
        correlationId: "corr-meeting-public",
      },
    );

    await request(app)
      .post(`/api/ward-meetings/${MEETING_ID}/complete`)
      .set(headers)
      .send({
        expectedMeetingVersion: 3,
        idempotencyKey: "meeting-public-complete",
      })
      .expect(200);
    await request(app)
      .get(`/api/ward-meetings/${MEETING_ID}`)
      .set(headers)
      .expect(200);

    expect(pipeline.request).toHaveBeenCalledWith(
      "/api/corti/ambient/session",
      { encounterIdentifier: "ward-13-board-round" },
      {
        actorId: "clinician:evelyn",
        correlationId: "corr-meeting-public",
      },
    );
  });

  it("resumes reconciliation when a close replay observes the segment already reconciling", async () => {
    const { agentic, app } = harness();
    vi.mocked(agentic.closeMeetingSegment).mockResolvedValueOnce({
      meeting: {
        meetingId: MEETING_ID,
        wardId: "ward-13",
        interactionId: "interaction-meeting-13",
        status: "recording",
        startedBy: "clinician:evelyn",
        startedAt: "2026-08-20T10:00:00.000Z",
        completedAt: null,
        version: 3,
      },
      segment: {
        segmentId: SEGMENT_ID,
        meetingId: MEETING_ID,
        patientId: "synthetic-karen",
        status: "reconciling",
        openedBy: "clinician:evelyn",
        openedAt: "2026-08-20T10:01:00.000Z",
        closedAt: "2026-08-20T10:05:00.000Z",
        version: 3,
      },
      replayed: true,
    });
    vi.mocked(agentic.reconcileMeetingSegment).mockResolvedValueOnce({
      replayed: true,
      reconciliation: {
        reconciliationId: "33333333-3333-4333-8333-333333333333",
        meetingId: MEETING_ID,
        patientSegmentId: SEGMENT_ID,
        patientId: "synthetic-karen",
        status: "saved",
        newDraftTaskIds: [],
        carryForwardTaskRefs: [],
        version: 2,
      },
      newDraftTasks: [],
      carryForwards: [],
    });

    const response = await request(app)
      .post(`/api/ward-meetings/${MEETING_ID}/segments/${SEGMENT_ID}/close`)
      .set(headers)
      .send({
        expectedMeetingVersion: 2,
        expectedSegmentVersion: 1,
        idempotencyKey: "meeting-public-close",
      })
      .expect(200);

    expect(response.body.segment.status).toBe("reconciling");
    expect(response.body.reconciliation.status).toBe("saved");
    expect(agentic.reconcileMeetingSegment).toHaveBeenCalledWith(
      MEETING_ID,
      SEGMENT_ID,
      expect.objectContaining({ expectedSegmentVersion: 3 }),
      expect.objectContaining({ actorId: "clinician:evelyn" }),
    );
  });
});
