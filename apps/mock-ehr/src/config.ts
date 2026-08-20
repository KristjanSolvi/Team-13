import { z } from "zod";

const environmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  HOST: z.string().min(1).optional(),
  MOCK_EHR_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  MOCK_EHR_HOST: z.string().min(1).optional(),
  MOCK_EHR_DATABASE_PATH: z.string().min(1).default("data/mock-ehr.sqlite"),
  MOCK_EHR_BEARER_TOKEN: z.string().min(16),
});

export function parseConfig(environment: NodeJS.ProcessEnv) {
  const value = environmentSchema.parse(environment);
  return {
    port: value.MOCK_EHR_PORT ?? value.PORT ?? 8793,
    host: value.MOCK_EHR_HOST ?? value.HOST ?? "127.0.0.1",
    databasePath: value.MOCK_EHR_DATABASE_PATH,
    bearerToken: value.MOCK_EHR_BEARER_TOKEN,
  };
}
