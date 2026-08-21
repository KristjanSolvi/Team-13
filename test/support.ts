import type { Server } from "node:http";

import type { GenerateHandoverInput } from "../src/agent/handover-runner.js";
import type { GenerateMeetingReconciliationInput } from "../src/agent/meeting-runner.js";
import type { HandoverRecord } from "../src/domain/handover.js";
import type { MeetingReconciliation } from "../src/domain/meeting.js";
import { seedKaren } from "../src/fixtures/karen.js";
import { createApp } from "../src/http/app.js";
import { DemoClock } from "../src/infra/clock.js";
import { openDatabase } from "../src/infra/database.js";
import { SqliteStore } from "../src/infra/store.js";
import { DemoAudienceService } from "../src/services/demo-audience-service.js";
import { HandoverService } from "../src/services/handover-service.js";
import { LedgerService } from "../src/services/ledger-service.js";
import { MeetingService } from "../src/services/meeting-service.js";
import { RecordService } from "../src/services/record-service.js";
import { SchedulerService } from "../src/services/scheduler-service.js";

export const APP_TOKEN = "app-secret";
export const MCP_TOKEN = "mcp-secret";
export const UI_ORIGIN = "http://127.0.0.1:5173";

export function createAppHarness(
  options: {
    demoMode?: boolean;
    handoverRunner?: {
      generate(input: GenerateHandoverInput): Promise<HandoverRecord>;
    };
    meetingRunner?: {
      generate(
        input: GenerateMeetingReconciliationInput,
      ): Promise<MeetingReconciliation>;
    };
  } = {},
) {
  const store = new SqliteStore(openDatabase(":memory:"));
  seedKaren(store, "2026-08-20T10:00:00.000Z");
  store.putContextMapping(
    "ctx-karen",
    "interaction-karen-1",
    "synthetic-karen",
    "2026-08-20T10:00:00.000Z",
  );
  const clock = new DemoClock(
    new Date("2026-08-20T10:00:00.000Z"),
    options.demoMode ?? true,
  );
  const ledger = new LedgerService(
    store,
    clock,
    "approval-secret-with-at-least-32-bytes",
  );
  const records = new RecordService(store);
  const handovers = new HandoverService(store, clock);
  const meetings = new MeetingService(store, clock, ledger);
  const scheduler = new SchedulerService(store, clock);
  const demoAudience = new DemoAudienceService(store, clock);
  const app = createApp({
    store,
    clock,
    ledger,
    handovers,
    meetings,
    records,
    scheduler,
    demoAudience,
    uiOrigin: UI_ORIGIN,
    appBearerToken: APP_TOKEN,
    mcpBearerToken: MCP_TOKEN,
    ...(options.handoverRunner
      ? { handoverRunner: options.handoverRunner }
      : {}),
    ...(options.meetingRunner ? { meetingRunner: options.meetingRunner } : {}),
  });
  return {
    app,
    store,
    clock,
    ledger,
    handovers,
    meetings,
    records,
    scheduler,
    demoAudience,
  };
}

export async function listen(app: ReturnType<typeof createApp>) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected a TCP server address");
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

export async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export function appHeaders(actorId?: string): Record<string, string> {
  return {
    authorization: `Bearer ${APP_TOKEN}`,
    "content-type": "application/json",
    ...(actorId ? { "x-actor-id": actorId } : {}),
  };
}
