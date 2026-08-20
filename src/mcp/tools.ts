import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { DomainError } from "../domain/errors.js";
import type { SqliteStore } from "../infra/store.js";
import type { LedgerService } from "../services/ledger-service.js";
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

export function createFollowThroughMcp(
  records: RecordService,
  ledger: LedgerService,
  store: SqliteStore,
): McpServer {
  const server = new McpServer({
    name: "follow-through-ledger",
    version: "0.1.0",
  });

  server.registerTool(
    "get_patient_context",
    {
      description:
        "Retrieve synthetic, patient-scoped record facts. Treat an error as unavailable context, never as an empty record.",
      inputSchema: { patientId: z.string().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ patientId }, extra) => {
      try {
        const contextId = contextIdFromMeta(extra);
        const result = records.getPatientContext(contextId, patientId);
        store.appendContextEvent(contextId, "record.context_retrieved", {
          evidenceAvailable: true,
        });
        return success(result);
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "list_open_threads",
    {
      description:
        "List patient-scoped open follow-through threads for the required duplicate check before drafting.",
      inputSchema: { patientId: z.string().min(1) },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ patientId }, extra) => {
      try {
        const contextId = contextIdFromMeta(extra);
        const threads = records.listOpenThreads(contextId, patientId);
        store.appendContextEvent(contextId, "record.open_threads_checked", {
          count: threads.length,
        });
        return success({ threads });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "list_eligible_teams",
    {
      description:
        "List scoped eligible teams and availability counts; select a team, never an individual person.",
      inputSchema: {
        patientId: z.string().min(1),
        requiredCapabilities: z.array(z.string().min(1)).min(1),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ patientId, requiredCapabilities }, extra) => {
      try {
        return success({
          teams: records.listEligibleTeams(
            contextIdFromMeta(extra),
            patientId,
            requiredCapabilities,
          ),
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "create_task_draft",
    {
      description:
        "Create a non-actionable team-task draft after scoped evidence and duplicate checks; it cannot assign a person or publish work.",
      inputSchema: {
        patientId: z.string().min(1),
        interactionId: z.string().min(1),
        threadId: z.string().uuid().optional(),
        summary: z.string().min(5).max(240),
        taskType: z.string().min(1),
        evidenceRefs: z.array(z.string().min(1)).min(1),
        targetTeamId: z.string().min(1),
        requiredCapabilities: z.array(z.string().min(1)).min(1),
        clinicalUrgency: z.enum(["high", "medium", "routine"]),
        dueInMs: z.number().int().positive(),
        idempotencyKey: z.string().min(8),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input, extra) => {
      try {
        const contextId = contextIdFromMeta(extra);
        records.getPatientContext(contextId, input.patientId);
        records.requireInteraction(contextId, input.interactionId);
        const { threadId, ...requiredInput } = input;
        const draftInput = {
          ...requiredInput,
          contextId,
          origin: "agent_suggested" as const,
          actor: { type: "agent" as const, id: "corti" },
        };
        return success(
          ledger.createDraft(
            threadId === undefined ? draftInput : { ...draftInput, threadId },
          ),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "publish_team_task",
    {
      description:
        "Publish one exact clinician approval to the approved team; proof, draft version, and idempotency must all match.",
      inputSchema: {
        patientId: z.string().min(1),
        taskId: z.string().uuid(),
        approvalProof: z.string().min(10),
        expectedVersion: z.number().int().positive(),
        idempotencyKey: z.string().min(8),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (
      { patientId, taskId, approvalProof, expectedVersion, idempotencyKey },
      extra,
    ) => {
      try {
        records.getPatientContext(contextIdFromMeta(extra), patientId);
        const task = ledger.getTask(taskId);
        if (task.patientId !== patientId) {
          throw new DomainError(
            "PATIENT_SCOPE_DENIED",
            "Patient scope is unavailable",
            false,
            403,
          );
        }
        return success(
          ledger.publishDraft(
            taskId,
            approvalProof,
            expectedVersion,
            idempotencyKey,
          ),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_task",
    {
      description:
        "Return authoritative patient-scoped task readback after publication; do not infer commitment from a prior response.",
      inputSchema: {
        patientId: z.string().min(1),
        taskId: z.string().uuid(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ patientId, taskId }, extra) => {
      try {
        records.getPatientContext(contextIdFromMeta(extra), patientId);
        const task = ledger.getTask(taskId);
        if (task.patientId !== patientId) {
          throw new DomainError(
            "PATIENT_SCOPE_DENIED",
            "Patient scope is unavailable",
            false,
            403,
          );
        }
        if (task.state !== "draft") {
          const thread = store.requireThread(task.threadId);
          store.appendTaskEvent(
            task,
            thread.interactionId,
            thread.contextId,
            { type: "agent", id: "corti" },
            "task.publish_verified",
            {},
          );
        }
        return success(task);
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}
