import type { Corti } from "@corti/sdk";

import type { AppConfig } from "../config.js";
import { HANDOVER_PROMPT } from "./handover-prompt.js";
import { FOLLOW_THROUGH_PROMPT } from "./prompt.js";

export function buildAgentDefinitions(config: AppConfig) {
  const taskMcpServer: Corti.AgentsCreateMcpServer = {
    name: config.mcpName,
    description:
      "Six patient-scoped tools for record investigation and clinician-approved team-task publication.",
    transportType: "streamable_http",
    authorizationType: "bearer",
    url: config.mcpPublicUrl,
  };
  const handoverMcpServer: Corti.AgentsCreateMcpServer = {
    name: config.handoverMcpName,
    description:
      "Five patient-scoped, non-actionable tools for grounded handover reads and draft persistence.",
    transportType: "streamable_http",
    authorizationType: "bearer",
    url: config.handoverMcpPublicUrl,
  };
  return {
    task: {
      name: "Follow-Through Orchestrator",
      description:
        "Investigates registered conversation evidence and creates clinician-approved team tasks.",
      systemPrompt: FOLLOW_THROUGH_PROMPT,
      mcpServers: [taskMcpServer],
    },
    handover: {
      name: "Follow-Through Patient Handover",
      description:
        "Creates one current, evidence-grounded patient handover draft without changing clinical work.",
      systemPrompt: HANDOVER_PROMPT,
      mcpServers: [handoverMcpServer],
    },
  };
}

export function buildProvisioningSummary(
  config: AppConfig,
  taskAgentId: string,
  handoverAgentId: string,
) {
  return {
    taskAgentId,
    handoverAgentId,
    taskMcpUrl: config.mcpPublicUrl,
    handoverMcpUrl: config.handoverMcpPublicUrl,
  };
}
