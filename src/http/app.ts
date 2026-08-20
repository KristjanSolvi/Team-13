import express, { type Express } from "express";

import type { HandoverAgentRunner } from "../agent/handover-runner.js";
import type { MeetingAgentRunner } from "../agent/meeting-runner.js";
import type { AgentRunner } from "../agent/runner.js";
import type { DemoClock } from "../infra/clock.js";
import type { SqliteStore } from "../infra/store.js";
import { createHandoverMcp } from "../mcp/handover-tools.js";
import { createMeetingReconciliationMcp } from "../mcp/meeting-tools.js";
import { createFollowThroughMcp } from "../mcp/tools.js";
import { mountMcp } from "../mcp/transport.js";
import type { DemoAudienceService } from "../services/demo-audience-service.js";
import type { HandoverService } from "../services/handover-service.js";
import type { LedgerService } from "../services/ledger-service.js";
import type { MeetingService } from "../services/meeting-service.js";
import type { RecordService } from "../services/record-service.js";
import type { SchedulerService } from "../services/scheduler-service.js";
import { mountRoutes } from "./routes.js";

export interface AppDependencies {
  store: SqliteStore;
  clock: DemoClock;
  ledger: LedgerService;
  handovers: HandoverService;
  meetings: MeetingService;
  records: RecordService;
  scheduler: SchedulerService;
  demoAudience: DemoAudienceService;
  uiOrigin: string;
  appBearerToken: string;
  mcpBearerToken: string;
  runner?: AgentRunner;
  handoverRunner?: Pick<HandoverAgentRunner, "generate">;
  meetingRunner?: Pick<MeetingAgentRunner, "generate">;
}

export function createApp(dependencies: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    if (request.header("origin") === dependencies.uiOrigin) {
      response.setHeader("access-control-allow-origin", dependencies.uiOrigin);
      response.setHeader("vary", "origin");
      response.setHeader(
        "access-control-allow-headers",
        "authorization,content-type,x-actor-id,x-correlation-id,last-event-id,mcp-session-id",
      );
      response.setHeader(
        "access-control-allow-methods",
        "GET,POST,DELETE,OPTIONS",
      );
    }
    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  app.get("/healthz", (_request, response) => {
    response.json({ ok: true });
  });
  mountMcp(
    app,
    () =>
      createFollowThroughMcp(
        dependencies.records,
        dependencies.ledger,
        dependencies.store,
      ),
    dependencies.mcpBearerToken,
  );
  mountMcp(
    app,
    () => createHandoverMcp(dependencies.records, dependencies.handovers),
    dependencies.mcpBearerToken,
    "/mcp/handover",
  );
  mountMcp(
    app,
    () =>
      createMeetingReconciliationMcp(
        dependencies.records,
        dependencies.meetings,
      ),
    dependencies.mcpBearerToken,
    "/mcp/meeting",
  );
  mountRoutes(app, dependencies);
  return app;
}
