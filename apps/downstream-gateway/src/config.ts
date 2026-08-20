import { z } from "zod";

const environmentSchema = z.object({
  DOWNSTREAM_PORT: z.coerce.number().int().min(1).max(65_535).default(8792),
  DOWNSTREAM_HOST: z.string().min(1).default("127.0.0.1"),
  DOWNSTREAM_DATABASE_PATH: z
    .string()
    .min(1)
    .default("./data/downstream.sqlite"),
  DOWNSTREAM_BEARER_TOKEN: z.string().min(16),
  DOWNSTREAM_SIMULATION_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export function parseConfig(environment: NodeJS.ProcessEnv) {
  const value = environmentSchema.parse(environment);
  return {
    port: value.DOWNSTREAM_PORT,
    host: value.DOWNSTREAM_HOST,
    databasePath: value.DOWNSTREAM_DATABASE_PATH,
    bearerToken: value.DOWNSTREAM_BEARER_TOKEN,
    simulationEnabled: value.DOWNSTREAM_SIMULATION_ENABLED,
  };
}
