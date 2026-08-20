import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { DomainError } from "../domain/errors.js";
import { handoverPacketSchema } from "../domain/handover.js";
import type { HandoverService } from "../services/handover-service.js";
import type { RecordService } from "../services/record-service.js";
import { contextIdFromMeta } from "./auth.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function structured(value: unknown): Record<string, unknown> {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("Tool result is not JSON serializable");
  }
  const parsed: unknown = JSON.parse(serialized);
  if (!isObject(parsed)) {
    throw new TypeError("Tool result must be a JSON object");
  }
  return parsed;
}

function success(value: unknown): CallToolResult {
  const structuredContent = structured(value);
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function failure(error: unknown): CallToolResult {
  const domain =
    error instanceof DomainError
      ? error
      : new DomainError("INTERNAL_ERROR", "Tool failed", true, 500);
  const structuredContent = {
    code: domain.code,
    message: domain.message,
    retryable: domain.retryable,
  };
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
    isError: true,
  };
}

export function createHandoverMcp(
  records: RecordService,
  handovers: HandoverService,
): McpServer {
  const server = new McpServer({
    name: "follow-through-handover",
    version: "0.1.0",
  });

  server.registerTool(
    "get_patient_context",
    {
      description:
        "Retrieve patient-scoped record facts for a grounded handover. Missing information is unknown, never normal or safe.",
      inputSchema: { patientId: z.string().min(1).max(160) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ patientId }, extra) => {
      try {
        return success(
          records.getPatientContext(contextIdFromMeta(extra), patientId),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "list_open_threads",
    {
      description: "List current open threads within the patient context.",
      inputSchema: { patientId: z.string().min(1).max(160) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ patientId }, extra) => {
      try {
        return success({
          threads: records.listOpenThreads(contextIdFromMeta(extra), patientId),
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "list_patient_tasks",
    {
      description:
        "List every active authoritative task for the scoped patient, including completed tasks awaiting verification.",
      inputSchema: { patientId: z.string().min(1).max(160) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ patientId }, extra) => {
      try {
        return success({
          tasks: records.listPatientTasks(contextIdFromMeta(extra), patientId),
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_task",
    {
      description:
        "Read one active authoritative patient task without changing task state or audit history.",
      inputSchema: {
        patientId: z.string().min(1).max(160),
        taskId: z.string().uuid(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ patientId, taskId }, extra) => {
      try {
        const task = records
          .listPatientTasks(contextIdFromMeta(extra), patientId)
          .find((candidate) => candidate.taskId === taskId);
        if (!task) {
          throw new DomainError("TASK_NOT_FOUND", "Task not found", false, 404);
        }
        return success(task);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "save_handover_draft",
    {
      description:
        "Save one grounded handover draft. This cannot create, publish, assign, accept, complete, or verify clinical work.",
      inputSchema: {
        handoverId: z.string().uuid(),
        patientId: z.string().min(1).max(160),
        packet: handoverPacketSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ handoverId, patientId, packet }, extra) => {
      try {
        const contextId = contextIdFromMeta(extra);
        records.getPatientContext(contextId, patientId);
        return success(
          handovers.saveDraft({
            handoverId,
            patientId,
            contextId,
            packet,
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}
