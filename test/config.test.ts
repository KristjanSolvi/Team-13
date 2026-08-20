import assert from "node:assert/strict";
import test from "node:test";

import { parseConfig } from "../src/config.js";

function requiredEnvironment(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    APP_BEARER_TOKEN: "app-token",
    MCP_BEARER_TOKEN: "mcp-token",
    APPROVAL_HMAC_SECRET: "approval-secret-at-least-32-characters",
    MCP_PUBLIC_URL: "https://follow-through.example/mcp",
    CORTI_TENANT_NAME: "tenant-name",
    CORTI_CLIENT_ID: "client-id",
    CORTI_CLIENT_SECRET: "client-secret",
    CORTI_ENVIRONMENT: "eu",
    DEMO_MODE: "true",
    ...overrides,
  };
}

test("applies defaults to a minimal required environment", () => {
  const config = parseConfig(requiredEnvironment());

  assert.equal(config.port, 3000);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.uiOrigin, "http://127.0.0.1:5173");
  assert.equal(config.databasePath, "./data/follow-through.sqlite");
  assert.equal(config.mcpName, "follow-through-ledger");
  assert.equal(
    config.handoverMcpPublicUrl,
    "https://follow-through.example/mcp/handover",
  );
  assert.equal(config.handoverMcpName, "follow-through-handover");
  assert.equal(config.demoMode, true);
  assert.equal(config.cortiAgentId, undefined);
  assert.equal(config.cortiHandoverAgentId, undefined);
  assert.equal(Object.hasOwn(config, "cortiAgentId"), true);
  assert.deepEqual(config.corti, {
    tenantName: "tenant-name",
    clientId: "client-id",
    clientSecret: "client-secret",
    environment: "eu",
  });
});

test("accepts explicit handover agent and normalized MCP URL overrides", () => {
  const config = parseConfig(
    requiredEnvironment({
      MCP_PUBLIC_URL: "https://follow-through.example/mcp/",
      HANDOVER_MCP_PUBLIC_URL: "https://handover.example/tools",
      HANDOVER_MCP_NAME: "custom-handover",
      CORTI_HANDOVER_AGENT_ID: "agent-handover",
    }),
  );

  assert.equal(config.mcpPublicUrl, "https://follow-through.example/mcp/");
  assert.equal(config.handoverMcpPublicUrl, "https://handover.example/tools");
  assert.equal(config.handoverMcpName, "custom-handover");
  assert.equal(config.cortiHandoverAgentId, "agent-handover");
});

test("derives a normalized handover URL when the override is blank", () => {
  const config = parseConfig(
    requiredEnvironment({
      MCP_PUBLIC_URL: "https://example.test/mcp/",
      HANDOVER_MCP_PUBLIC_URL: "",
    }),
  );

  assert.equal(
    config.handoverMcpPublicUrl,
    "https://example.test/mcp/handover",
  );
});

test("accepts a blank pre-provisioning agent ID", () => {
  const config = parseConfig(requiredEnvironment({ CORTI_AGENT_ID: "" }));

  assert.equal(config.cortiAgentId, "");
});

test("exposes a populated agent ID at the top level", () => {
  const config = parseConfig(
    requiredEnvironment({ CORTI_AGENT_ID: "agent-id" }),
  );

  assert.equal(config.cortiAgentId, "agent-id");
  assert.equal("agentId" in config.corti, false);
});

test("parses the US environment with demo mode disabled", () => {
  const config = parseConfig(
    requiredEnvironment({ CORTI_ENVIRONMENT: "us", DEMO_MODE: "false" }),
  );

  assert.equal(config.corti.environment, "us");
  assert.equal(config.demoMode, false);
});

test("accepts a cloud host and platform port", () => {
  const config = parseConfig(
    requiredEnvironment({ HOST: "0.0.0.0", PORT: "8080" }),
  );

  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 8080);
});

const invalidConfigurations: ReadonlyArray<{
  name: string;
  overrides: NodeJS.ProcessEnv;
  expectedField: RegExp;
}> = [
  {
    name: "missing application bearer token",
    overrides: { APP_BEARER_TOKEN: undefined },
    expectedField: /APP_BEARER_TOKEN/,
  },
  {
    name: "short application bearer token",
    overrides: { APP_BEARER_TOKEN: "short" },
    expectedField: /APP_BEARER_TOKEN/,
  },
  {
    name: "missing MCP bearer token",
    overrides: { MCP_BEARER_TOKEN: undefined },
    expectedField: /MCP_BEARER_TOKEN/,
  },
  {
    name: "short MCP bearer token",
    overrides: { MCP_BEARER_TOKEN: "short" },
    expectedField: /MCP_BEARER_TOKEN/,
  },
  {
    name: "missing approval HMAC secret",
    overrides: { APPROVAL_HMAC_SECRET: undefined },
    expectedField: /APPROVAL_HMAC_SECRET/,
  },
  {
    name: "short approval HMAC secret",
    overrides: { APPROVAL_HMAC_SECRET: "short" },
    expectedField: /APPROVAL_HMAC_SECRET/,
  },
  {
    name: "invalid UI origin",
    overrides: { UI_ORIGIN: "not-a-url" },
    expectedField: /UI_ORIGIN/,
  },
  {
    name: "missing MCP public URL",
    overrides: { MCP_PUBLIC_URL: undefined },
    expectedField: /MCP_PUBLIC_URL/,
  },
  {
    name: "invalid MCP public URL",
    overrides: { MCP_PUBLIC_URL: "not-a-url" },
    expectedField: /MCP_PUBLIC_URL/,
  },
  {
    name: "missing Corti tenant name",
    overrides: { CORTI_TENANT_NAME: undefined },
    expectedField: /CORTI_TENANT_NAME/,
  },
  {
    name: "blank Corti tenant name",
    overrides: { CORTI_TENANT_NAME: "" },
    expectedField: /CORTI_TENANT_NAME/,
  },
  {
    name: "missing Corti client ID",
    overrides: { CORTI_CLIENT_ID: undefined },
    expectedField: /CORTI_CLIENT_ID/,
  },
  {
    name: "blank Corti client ID",
    overrides: { CORTI_CLIENT_ID: "" },
    expectedField: /CORTI_CLIENT_ID/,
  },
  {
    name: "missing Corti client secret",
    overrides: { CORTI_CLIENT_SECRET: undefined },
    expectedField: /CORTI_CLIENT_SECRET/,
  },
  {
    name: "blank Corti client secret",
    overrides: { CORTI_CLIENT_SECRET: "" },
    expectedField: /CORTI_CLIENT_SECRET/,
  },
  {
    name: "invalid Corti environment",
    overrides: { CORTI_ENVIRONMENT: "apac" },
    expectedField: /CORTI_ENVIRONMENT/,
  },
  {
    name: "invalid demo mode",
    overrides: { DEMO_MODE: "1" },
    expectedField: /DEMO_MODE/,
  },
];

for (const { name, overrides, expectedField } of invalidConfigurations) {
  test(`rejects ${name}`, () => {
    assert.throws(
      () => parseConfig(requiredEnvironment(overrides)),
      expectedField,
    );
  });
}
