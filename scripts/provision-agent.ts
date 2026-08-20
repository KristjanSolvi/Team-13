import { type Corti, CortiClient } from "@corti/sdk";
import { HANDOVER_PROMPT } from "../src/agent/handover-prompt.js";
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
const taskMcpServer: Corti.AgentsCreateMcpServer = {
  name: config.mcpName,
  description:
    "Six patient-scoped tools for record investigation and clinician-approved team-task publication.",
  transportType: "streamable_http",
  authorizationType: "bearer",
  url: config.mcpPublicUrl,
};
const taskDefinition = {
  name: "Follow-Through Orchestrator",
  description:
    "Investigates registered conversation evidence and creates clinician-approved team tasks.",
  systemPrompt: FOLLOW_THROUGH_PROMPT,
  mcpServers: [taskMcpServer],
};
const handoverMcpServer: Corti.AgentsCreateMcpServer = {
  name: config.handoverMcpName,
  description:
    "Five patient-scoped, non-actionable tools for grounded handover reads and draft persistence.",
  transportType: "streamable_http",
  authorizationType: "bearer",
  url: config.handoverMcpPublicUrl,
};
const handoverDefinition = {
  name: "Follow-Through Patient Handover",
  description:
    "Creates one current, evidence-grounded patient handover draft without changing clinical work.",
  systemPrompt: HANDOVER_PROMPT,
  mcpServers: [handoverMcpServer],
};
const taskAgent = config.cortiAgentId
  ? await client.agents.update(config.cortiAgentId, taskDefinition)
  : await client.agents.create(taskDefinition);
const handoverAgent = config.cortiHandoverAgentId
  ? await client.agents.update(config.cortiHandoverAgentId, handoverDefinition)
  : await client.agents.create(handoverDefinition);

console.log(
  JSON.stringify(
    {
      taskAgentId: taskAgent.id,
      handoverAgentId: handoverAgent.id,
      taskMcpUrl: config.mcpPublicUrl,
      handoverMcpUrl: config.handoverMcpPublicUrl,
    },
    null,
    2,
  ),
);
