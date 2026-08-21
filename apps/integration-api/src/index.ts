import "dotenv/config";

import { createIntegrationApp } from "./app.js";
import { parseConfig } from "./config.js";
import {
  HttpAgenticGateway,
  HttpDownstreamGateway,
  HttpMockEhrGateway,
  HttpPipelineGateway,
  HttpProfileGateway,
} from "./gateways.js";
import { DownstreamReadbackReconciler } from "./reconciler.js";
import { IntegrationService } from "./service.js";

const config = parseConfig(process.env);
const agentic = new HttpAgenticGateway(
  config.agenticBaseUrl,
  config.upstreamTimeoutMs,
  config.agenticBearerToken,
  fetch,
  config.handoverUpstreamTimeoutMs,
);
const pipeline = new HttpPipelineGateway(
  config.pipelineBaseUrl,
  config.upstreamTimeoutMs,
  fetch,
  config.handoverUpstreamTimeoutMs,
);
const profile = new HttpProfileGateway(
  config.patientProfileBaseUrl,
  config.upstreamTimeoutMs,
  config.patientProfileBearerToken,
);
const mockEhr = new HttpMockEhrGateway(
  config.mockEhrBaseUrl,
  config.upstreamTimeoutMs,
  config.mockEhrBearerToken,
);
const downstream = new HttpDownstreamGateway(
  config.downstreamBaseUrl,
  config.upstreamTimeoutMs,
  config.downstreamBearerToken,
);
const service = new IntegrationService(agentic, pipeline, undefined, {
  profile,
  mockEhr,
}, downstream);
const app = createIntegrationApp({
  service,
  allowedOrigins: config.allowedOrigins,
  integrationApiBearerToken: config.integrationApiBearerToken,
});
const reconciler = new DownstreamReadbackReconciler(
  agentic,
  downstream,
  () => console.error("Downstream readback reconciliation failed"),
);
reconciler.start(config.downstreamReconcileIntervalMs);

app.listen(config.port, config.host, () => {
  console.error(
    `Fluence integration API listening on http://${config.host}:${config.port}`,
  );
});
