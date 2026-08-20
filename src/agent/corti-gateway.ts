import { randomUUID } from "node:crypto";

import { type Corti, CortiClient } from "@corti/sdk";

import type { AppConfig } from "../config.js";
import type { AgentGateway, AgentResult, AgentSendInput } from "./runner.js";

const TERMINAL_STATES = new Set([
  "completed",
  "failed",
  "canceled",
  "rejected",
  "input-required",
  "auth-required",
]);
const POLL_INTERVAL_MS = 1_000;
const POLL_TIMEOUT_MS = 180_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function creditsFrom(metadata: Record<string, unknown> | undefined) {
  const usage = metadata?.$usage;
  if (!isObject(usage) || typeof usage.credits !== "number") {
    return undefined;
  }
  return usage.credits;
}

function resultFromTask(task: Corti.AgentsTask): AgentResult {
  const credits = creditsFrom(task.metadata);
  return {
    contextId: task.contextId,
    taskId: task.id,
    state: task.status.state,
    ...(credits === undefined ? {} : { credits }),
  };
}

function requireCompleted(result: AgentResult): AgentResult {
  if (result.state !== "completed") {
    throw new Error(`Corti agent ended in ${result.state}`);
  }
  return result;
}

export class CortiSdkGateway implements AgentGateway {
  private readonly client: CortiClient;
  private readonly mcpName: string;

  constructor(
    private readonly agentId: string,
    config: AppConfig,
    mcpName = config.mcpName,
  ) {
    this.mcpName = mcpName;
    this.client = new CortiClient({
      environment: config.corti.environment,
      tenantName: config.corti.tenantName,
      auth: {
        clientId: config.corti.clientId,
        clientSecret: config.corti.clientSecret,
      },
      analytics: { examples_repo: "team-13-follow-through" },
    });
  }

  async send(input: AgentSendInput): Promise<AgentResult> {
    const parts: Corti.AgentsPart[] = [{ kind: "text", text: input.text }];
    if (input.data) {
      const safeData = { ...input.data };
      const mcpToken = safeData.mcpToken;
      delete safeData.mcpToken;
      if (Object.keys(safeData).length > 0) {
        parts.push({ kind: "data", data: safeData });
      }
      if (typeof mcpToken === "string") {
        parts.push({
          kind: "data",
          data: {
            type: "token",
            mcp_name: this.mcpName,
            token: mcpToken,
          },
        });
      }
    }
    const message: Corti.AgentsMessage = {
      role: "user",
      kind: "message",
      messageId: randomUUID(),
      parts,
      ...(input.contextId === undefined ? {} : { contextId: input.contextId }),
    };
    const response = await this.client.agents.messageSend(
      this.agentId,
      { message, configuration: { blocking: false } },
      { timeoutInSeconds: 60, maxRetries: 0 },
    );
    if (response.task) {
      return resultFromTask(response.task);
    }
    if (!response.message?.contextId) {
      throw new Error("Corti response omitted contextId");
    }
    return {
      contextId: response.message.contextId,
      taskId: null,
      state: "completed",
    };
  }

  async waitForCompletion(result: AgentResult): Promise<AgentResult> {
    if (!result.taskId) return requireCompleted(result);
    if (TERMINAL_STATES.has(result.state)) return requireCompleted(result);

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const task = await this.client.agents.getTask(
        this.agentId,
        result.taskId,
      );
      if (TERMINAL_STATES.has(task.status.state)) {
        return requireCompleted(resultFromTask(task));
      }
    }
    throw new Error("Corti agent stalled for 180 seconds");
  }
}
