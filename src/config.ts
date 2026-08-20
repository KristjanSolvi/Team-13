import "dotenv/config";

import { z } from "zod";

const environmentSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default("127.0.0.1"),
  UI_ORIGIN: z.string().url().default("http://127.0.0.1:5173"),
  DATABASE_PATH: z.string().min(1).default("./data/follow-through.sqlite"),
  APP_BEARER_TOKEN: z.string().min(8),
  MCP_BEARER_TOKEN: z.string().min(8),
  APPROVAL_HMAC_SECRET: z.string().min(32),
  MCP_PUBLIC_URL: z.string().url(),
  MCP_NAME: z.string().min(1).default("follow-through-ledger"),
  CORTI_AGENT_ID: z.string().optional(),
  CORTI_TENANT_NAME: z.string().min(1),
  CORTI_CLIENT_ID: z.string().min(1),
  CORTI_CLIENT_SECRET: z.string().min(1),
  CORTI_ENVIRONMENT: z.enum(["eu", "us"]),
  DEMO_MODE: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export function parseConfig(environment: NodeJS.ProcessEnv) {
  const parsed = environmentSchema.parse(environment);

  return {
    port: parsed.PORT,
    host: parsed.HOST,
    uiOrigin: parsed.UI_ORIGIN,
    databasePath: parsed.DATABASE_PATH,
    appBearerToken: parsed.APP_BEARER_TOKEN,
    mcpBearerToken: parsed.MCP_BEARER_TOKEN,
    approvalHmacSecret: parsed.APPROVAL_HMAC_SECRET,
    mcpPublicUrl: parsed.MCP_PUBLIC_URL,
    mcpName: parsed.MCP_NAME,
    cortiAgentId: parsed.CORTI_AGENT_ID,
    demoMode: parsed.DEMO_MODE,
    corti: {
      tenantName: parsed.CORTI_TENANT_NAME,
      clientId: parsed.CORTI_CLIENT_ID,
      clientSecret: parsed.CORTI_CLIENT_SECRET,
      environment: parsed.CORTI_ENVIRONMENT,
    },
  };
}

export type AppConfig = ReturnType<typeof parseConfig>;
