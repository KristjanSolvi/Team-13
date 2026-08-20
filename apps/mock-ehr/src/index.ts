import "dotenv/config";

import { createMockEhrApp } from "./app.js";
import { parseConfig } from "./config.js";
import { openMockEhrDatabase } from "./database.js";
import { MockEhrService } from "./service.js";
import { MockEhrStore } from "./store.js";

const config = parseConfig(process.env);
const store = new MockEhrStore(openMockEhrDatabase(config.databasePath));
const app = createMockEhrApp({
  service: new MockEhrService(store),
  bearerToken: config.bearerToken,
});
const server = app.listen(config.port, config.host, () => {
  console.log(`Synthetic mock EHR listening on http://${config.host}:${config.port}`);
});

function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
