import { z } from "zod";

const environmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  HOST: z.string().min(1).optional(),
  INTEGRATION_API_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  INTEGRATION_API_HOST: z.string().min(1).optional(),
  AGENTIC_BASE_URL: z.url().default("http://127.0.0.1:3000"),
  PIPELINE_BASE_URL: z.url().default("http://127.0.0.1:8787"),
  PATIENT_PROFILE_BASE_URL: z.url().default("http://127.0.0.1:8791"),
  MOCK_EHR_BASE_URL: z.url().default("http://127.0.0.1:8793"),
  INTEGRATION_API_BEARER_TOKEN: z.string().min(8),
  AGENTIC_APP_BEARER_TOKEN: z.string().min(8),
  PATIENT_PROFILE_BEARER_TOKEN: z.string().min(8),
  MOCK_EHR_BEARER_TOKEN: z.string().min(8),
  UI_ORIGINS: z
    .string()
    .default("http://127.0.0.1:5173,http://localhost:5173"),
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(250).max(120_000).default(8_000),
});

export function parseConfig(environment: NodeJS.ProcessEnv) {
  const value = environmentSchema.parse(environment);
  const allowedOrigins = value.UI_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      const url = new URL(origin);
      if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
        throw new Error(`UI origin must contain only scheme, host, and port: ${origin}`);
      }
      return url.origin;
    });
  return {
    port: value.INTEGRATION_API_PORT ?? value.PORT ?? 8790,
    host: value.INTEGRATION_API_HOST ?? value.HOST ?? "127.0.0.1",
    agenticBaseUrl: value.AGENTIC_BASE_URL,
    pipelineBaseUrl: value.PIPELINE_BASE_URL,
    patientProfileBaseUrl: value.PATIENT_PROFILE_BASE_URL,
    mockEhrBaseUrl: value.MOCK_EHR_BASE_URL,
    integrationApiBearerToken: value.INTEGRATION_API_BEARER_TOKEN,
    agenticBearerToken: value.AGENTIC_APP_BEARER_TOKEN,
    patientProfileBearerToken: value.PATIENT_PROFILE_BEARER_TOKEN,
    mockEhrBearerToken: value.MOCK_EHR_BEARER_TOKEN,
    allowedOrigins,
    upstreamTimeoutMs: value.UPSTREAM_TIMEOUT_MS,
  };
}
