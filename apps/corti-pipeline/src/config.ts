import { z } from "zod";

import { codingSystems, type CodingSystem } from "./contracts.js";

const runtimeSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  HOST: z.string().min(1).optional(),
  PIPELINE_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  PIPELINE_HOST: z.string().min(1).optional(),
  PIPELINE_ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  CORTI_ENVIRONMENT: z.enum(["eu", "us"]).default("eu"),
  CORTI_PRIMARY_LANGUAGE: z.string().min(2).default("en"),
  CORTI_OUTPUT_LANGUAGE: z.string().min(2).default("en"),
  CORTI_CODING_SYSTEM: z.enum(codingSystems).default("icd10int-outpatient"),
});

export interface CortiCredentials {
  tenantName: string;
  clientId: string;
  clientSecret: string;
  environment: "eu" | "us";
  primaryLanguage: string;
  outputLanguage: string;
  codingSystem: CodingSystem;
}

export interface RuntimeConfig {
  port: number;
  host: string;
  allowedOrigins: string[];
  corti: CortiCredentials | null;
  missingCortiVariables: string[];
}

const placeholders = new Set([
  "your_tenant_name_here",
  "your_client_id_here",
  "your_client_secret_here",
]);

function usableCredential(value: string | undefined): value is string {
  return value !== undefined && value.length > 0 && !placeholders.has(value);
}

export function readRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeConfig {
  const parsed = runtimeSchema.parse(environment);
  const required = {
    CORTI_TENANT_NAME: environment.CORTI_TENANT_NAME,
    CORTI_CLIENT_ID: environment.CORTI_CLIENT_ID,
    CORTI_CLIENT_SECRET: environment.CORTI_CLIENT_SECRET,
  };
  const missingCortiVariables = Object.entries(required)
    .filter(([, value]) => !usableCredential(value))
    .map(([name]) => name);

  const base = {
    port: parsed.PIPELINE_PORT ?? parsed.PORT ?? 8787,
    host: parsed.PIPELINE_HOST ?? parsed.HOST ?? "127.0.0.1",
    allowedOrigins: parsed.PIPELINE_ALLOWED_ORIGINS,
    missingCortiVariables,
  };

  if (missingCortiVariables.length > 0) {
    return { ...base, corti: null };
  }

  return {
    ...base,
    corti: {
      tenantName: required.CORTI_TENANT_NAME!,
      clientId: required.CORTI_CLIENT_ID!,
      clientSecret: required.CORTI_CLIENT_SECRET!,
      environment: parsed.CORTI_ENVIRONMENT,
      primaryLanguage: parsed.CORTI_PRIMARY_LANGUAGE,
      outputLanguage: parsed.CORTI_OUTPUT_LANGUAGE,
      codingSystem: parsed.CORTI_CODING_SYSTEM,
    },
  };
}
