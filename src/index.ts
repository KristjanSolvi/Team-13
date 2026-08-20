import { createAgentRunners } from "./agent/runtime.js";
import { parseConfig } from "./config.js";
import { seedKaren } from "./fixtures/karen.js";
import { createApp } from "./http/app.js";
import { DemoClock } from "./infra/clock.js";
import { openDatabase } from "./infra/database.js";
import { SqliteStore } from "./infra/store.js";
import { HandoverService } from "./services/handover-service.js";
import { LedgerService } from "./services/ledger-service.js";
import { RecordService } from "./services/record-service.js";
import { SchedulerService } from "./services/scheduler-service.js";

const config = parseConfig(process.env);
const store = new SqliteStore(openDatabase(config.databasePath));
if (!store.getPatient("synthetic-karen")) {
  seedKaren(store, new Date().toISOString());
}
const clock = new DemoClock(new Date(), config.demoMode);
const ledger = new LedgerService(store, clock, config.approvalHmacSecret);
const records = new RecordService(store);
const handovers = new HandoverService(store, clock);
const scheduler = new SchedulerService(store, clock);
scheduler.tick();
setInterval(() => scheduler.tick(), 15_000).unref();
const runners = createAgentRunners(config, store);

createApp({
  store,
  clock,
  ledger,
  handovers,
  records,
  scheduler,
  appBearerToken: config.appBearerToken,
  mcpBearerToken: config.mcpBearerToken,
  uiOrigin: config.uiOrigin,
  ...(runners.task ? { runner: runners.task } : {}),
}).listen(config.port, config.host, () => {
  console.error(
    `Follow-Through listening on http://${config.host}:${config.port}`,
  );
});
