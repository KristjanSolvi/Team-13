import "dotenv/config";

import { createPipelineApp } from "./app.js";
import { readRuntimeConfig } from "./config.js";
import { CortiSdkGateway } from "./corti-gateway.js";

const config = readRuntimeConfig();
const gateway = config.corti === null ? null : new CortiSdkGateway(config.corti);
const app = createPipelineApp({
  gateway,
  allowedOrigins: config.allowedOrigins,
  missingCortiVariables: config.missingCortiVariables,
});

app.listen(config.port, config.host, () => {
  const cortiStatus = gateway === null ? "not configured" : "configured";
  console.log(
    `Follow-Through Corti pipeline listening on http://${config.host}:${config.port} (${cortiStatus})`,
  );
});
