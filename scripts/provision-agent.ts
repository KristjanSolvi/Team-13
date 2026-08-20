import { type Corti, CortiClient } from "@corti/sdk";

import { FOLLOW_THROUGH_PROMPT } from "../src/agent/prompt.js";
import { parseConfig } from "../src/config.js";

const config = parseConfig(process.env);
const client = new CortiClient({
  environment: config.corti.environment,
  tenantName: config.corti.tenantName,
  auth: {
    clientId: config.corti.clientId,
    clientSecret: config.corti.clientSecret,
  },
  analytics: { examples_repo: "team-13-follow-through" },
});
const mcpServer: Corti.AgentsCreateMcpServer = {
  name: config.mcpName,
  description:
    "Six patient-scoped tools for record investigation and clinician-approved team-task publication.",
  transportType: "streamable_http",
  authorizationType: "bearer",
  url: config.mcpPublicUrl,
};
const definition = {
  name: "Follow-Through Orchestrator",
  description:
    "Investigates registered conversation evidence and creates clinician-approved team tasks.",
  systemPrompt: FOLLOW_THROUGH_PROMPT,
  mcpServers: [mcpServer],
};
const agent = config.cortiAgentId
  ? await client.agents.update(config.cortiAgentId, definition)
  : await client.agents.create(definition);

console.log(
  JSON.stringify({ agentId: agent.id, mcpUrl: config.mcpPublicUrl }, null, 2),
);
