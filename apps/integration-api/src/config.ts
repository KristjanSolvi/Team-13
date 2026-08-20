import { z } from "zod";

const environmentSchema = z.object({
  INTEGRATION_API_PORT: z.coerce.number().int().min(1).max(65_535).default(8790),
  INTEGRATION_API_HOST: z.string().default("127.0.0.1"),
  AGENTIC_BASE_URL: z.url().default("http://127.0.0.1:3000"),
  PIPELINE_BASE_URL: z.url().default("http://127.0.0.1:8787"),
  AGENTIC_APP_BEARER_TOKEN: z.string().min(8),
  UI_ORIGINS: z.string().default("http://127.0.0.1:5173"),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(250).max(120_000).default(8_000),
});

export function parseConfig(environment: NodeJS.ProcessEnv) {
  const value = environmentSchema.parse(environment);
  return {
    port: value.INTEGRATION_API_PORT,
    host: value.INTEGRATION_API_HOST,
    agenticBaseUrl: value.AGENTIC_BASE_URL,
    pipelineBaseUrl: value.PIPELINE_BASE_URL,
    agenticBearerToken: value.AGENTIC_APP_BEARER_TOKEN,
    allowedOrigins: value.UI_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    upstreamTimeoutMs: value.UPSTREAM_TIMEOUT_MS,
  };
}
