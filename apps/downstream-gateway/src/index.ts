import "dotenv/config";

import { createDownstreamApp } from "./app.js";
import { parseConfig } from "./config.js";
import { openDownstreamDatabase } from "./database.js";
import { UnconfiguredDownstreamProvider } from "./provider.js";
import { DownstreamGatewayService } from "./service.js";
import { SqliteSimulatedProvider } from "./simulated-provider.js";
import { DownstreamStore } from "./store.js";

const config = parseConfig(process.env);
const store = new DownstreamStore(
  openDownstreamDatabase(config.databasePath),
);
const simulatedProvider = new SqliteSimulatedProvider(store);
const provider = config.simulationEnabled
  ? simulatedProvider
  : new UnconfiguredDownstreamProvider();
const service = new DownstreamGatewayService(
  store,
  provider,
  config.simulationEnabled ? simulatedProvider : null,
);
const app = createDownstreamApp({ service, bearerToken: config.bearerToken });
const server = app.listen(config.port, config.host, () => {
  console.log(
    `Downstream gateway listening on http://${config.host}:${config.port}`,
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
