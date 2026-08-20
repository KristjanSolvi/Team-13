import "dotenv/config";

import { createIntegrationApp } from "./app.js";
import { parseConfig } from "./config.js";
import {
  HttpAgenticGateway,
  HttpMockEhrGateway,
  HttpPipelineGateway,
  HttpProfileGateway,
} from "./gateways.js";
import { IntegrationService } from "./service.js";

const config = parseConfig(process.env);
const agentic = new HttpAgenticGateway(
  config.agenticBaseUrl,
  config.upstreamTimeoutMs,
  config.agenticBearerToken,
);
const pipeline = new HttpPipelineGateway(
  config.pipelineBaseUrl,
  config.upstreamTimeoutMs,
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
const service = new IntegrationService(agentic, pipeline, undefined, {
  profile,
  mockEhr,
});
const app = createIntegrationApp({
  service,
  allowedOrigins: config.allowedOrigins,
});

app.listen(config.port, config.host, () => {
  console.error(
    `Follow-Through integration API listening on http://${config.host}:${config.port}`,
  );
});
