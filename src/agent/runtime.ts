import type { AppConfig } from "../config.js";
import type { SqliteStore } from "../infra/store.js";
import { CortiSdkGateway } from "./corti-gateway.js";
import { HandoverAgentRunner } from "./handover-runner.js";
import { type AgentGateway, AgentRunner } from "./runner.js";

export type AgentGatewayFactory = (
  agentId: string,
  mcpName: string,
) => AgentGateway;

export function createAgentRunners(
  config: AppConfig,
  store: SqliteStore,
  gatewayFactory: AgentGatewayFactory = (agentId, mcpName) =>
    new CortiSdkGateway(agentId, config, mcpName),
) {
  return {
    ...(config.cortiAgentId
      ? {
          task: new AgentRunner(
            gatewayFactory(config.cortiAgentId, config.mcpName),
            store,
            config.mcpBearerToken,
          ),
        }
      : {}),
    ...(config.cortiHandoverAgentId
      ? {
          handover: new HandoverAgentRunner(
            gatewayFactory(config.cortiHandoverAgentId, config.handoverMcpName),
            store,
            config.mcpBearerToken,
          ),
        }
      : {}),
  };
}
