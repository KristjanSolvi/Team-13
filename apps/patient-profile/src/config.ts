import { z } from "zod";

const environmentSchema = z.object({
  PATIENT_PROFILE_PORT: z.coerce.number().int().min(1).max(65_535).default(8791),
  PATIENT_PROFILE_HOST: z.string().min(1).default("127.0.0.1"),
  PATIENT_PROFILE_DATABASE_PATH: z
    .string()
    .min(1)
    .default("./data/patient-profiles.sqlite"),
  PATIENT_PROFILE_BEARER_TOKEN: z.string().min(16),
});

export function parseConfig(environment: NodeJS.ProcessEnv) {
  const value = environmentSchema.parse(environment);
  return {
    port: value.PATIENT_PROFILE_PORT,
    host: value.PATIENT_PROFILE_HOST,
    databasePath: value.PATIENT_PROFILE_DATABASE_PATH,
    bearerToken: value.PATIENT_PROFILE_BEARER_TOKEN,
  };
}
