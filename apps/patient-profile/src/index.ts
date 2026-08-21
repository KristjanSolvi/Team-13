import "dotenv/config";

import { createPatientProfileApp } from "./app.js";
import { parseConfig } from "./config.js";
import { openProfileDatabase } from "./database.js";
import { seedSyntheticWardProfiles } from "./demo.js";
import { PatientProfileService } from "./service.js";
import { PatientProfileStore } from "./store.js";

const config = parseConfig(process.env);
const store = new PatientProfileStore(
  openProfileDatabase(config.databasePath),
);
const service = new PatientProfileService(store);
if (config.seedSyntheticKaren) {
  seedSyntheticWardProfiles(service, store);
}
const app = createPatientProfileApp({
  service,
  bearerToken: config.bearerToken,
});
const server = app.listen(config.port, config.host, () => {
  console.log(
    `Patient profile service listening on http://${config.host}:${config.port}`,
  );
});

function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
