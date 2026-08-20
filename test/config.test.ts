import assert from "node:assert/strict";
import test from "node:test";

import { parseConfig } from "../src/config.js";

function completeEnvironment(): NodeJS.ProcessEnv {
  return {
    PORT: "3000",
    UI_ORIGIN: "http://localhost:5173",
    DATABASE_PATH: "./data/follow-through.sqlite",
    APP_BEARER_TOKEN: "app-token",
    MCP_BEARER_TOKEN: "mcp-token",
    APPROVAL_HMAC_SECRET: "approval-secret-at-least-32-characters",
    MCP_PUBLIC_URL: "https://follow-through.example/mcp",
    MCP_NAME: "follow-through-ledger",
    CORTI_AGENT_ID: "agent-id",
    CORTI_TENANT_NAME: "tenant-name",
    CORTI_CLIENT_ID: "client-id",
    CORTI_CLIENT_SECRET: "client-secret",
    CORTI_ENVIRONMENT: "eu",
    DEMO_MODE: "true",
    NGROK_AUTHTOKEN: "ngrok-token",
  };
}

test("rejects a missing application bearer token", () => {
  const environment = completeEnvironment();
  delete environment.APP_BEARER_TOKEN;

  assert.throws(() => parseConfig(environment), /APP_BEARER_TOKEN/);
});

test("parses a complete demo environment", () => {
  const config = parseConfig(completeEnvironment());

  assert.equal(config.port, 3000);
  assert.equal(config.corti.environment, "eu");
  assert.equal(config.demoMode, true);
});
