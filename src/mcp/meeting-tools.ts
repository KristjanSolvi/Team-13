import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { DomainError } from "../domain/errors.js";
import type { MeetingService } from "../services/meeting-service.js";
import type { RecordService } from "../services/record-service.js";
import { contextIdFromMeta } from "./auth.js";

// Return a fresh schema for every nested array. Reusing one Zod instance makes
// the MCP converter emit a nested JSON Schema $ref, which Corti's function-tool
// validator rejects before the agent can run.
const evidenceReference = () =>
  z.string().regex(/^(encounter|record|dictation):[A-Za-z0-9._-]+$/);
const reconciliationScope = {
  reconciliationId: z.string().uuid(),
  patientId: z.string().min(1).max(160),
};

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

export function createMeetingReconciliationMcp(
  records: RecordService,
  meetings: MeetingService,
): McpServer {
  const server = new McpServer({
    name: "follow-through-meeting",
    version: "0.1.0",
  });

  server.registerTool(
    "get_meeting_segment",
    {
      description:
        "Read the exact final clear transcript evidence from the explicitly selected current patient segment.",
      inputSchema: reconciliationScope,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ reconciliationId, patientId }, extra) => {
      try {
        return success(
          meetings.getMeetingSegment(
            contextIdFromMeta(extra),
            reconciliationId,
            patientId,
          ),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_previous_patient_meeting",
    {
      description:
        "Read the same patient's most recent prior meeting segment, exact eligible transcript, and prior reconciliation decision.",
      inputSchema: reconciliationScope,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ reconciliationId, patientId }, extra) => {
      try {
        return success(
          meetings.getPreviousPatientMeetingContext(
            contextIdFromMeta(extra),
            reconciliationId,
            patientId,
          ),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_latest_patient_handover",
    {
      description:
        "Read the latest finalized grounded handover for context. It cannot by itself prove a new spoken commitment.",
      inputSchema: reconciliationScope,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ reconciliationId, patientId }, extra) => {
      try {
        return success(
          meetings.getLatestPatientHandover(
            contextIdFromMeta(extra),
            reconciliationId,
            patientId,
          ),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "list_patient_tasks",
    {
      description:
        "List every active authoritative task for duplicate and carry-forward reconciliation.",
      inputSchema: reconciliationScope,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ reconciliationId, patientId }, extra) => {
      try {
        const contextId = contextIdFromMeta(extra);
        meetings.getMeetingSegment(contextId, reconciliationId, patientId);
        return success({
          tasks: records.listPatientTasks(contextId, patientId),
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "list_eligible_teams",
    {
      description:
        "List patient-scoped teams whose declared capabilities satisfy the proposed draft requirements.",
      inputSchema: {
        ...reconciliationScope,
        requiredCapabilities: z.array(z.string().min(1).max(120)).max(20),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ reconciliationId, patientId, requiredCapabilities }, extra) => {
      try {
        const contextId = contextIdFromMeta(extra);
        meetings.getMeetingSegment(contextId, reconciliationId, patientId);
        return success({
          teams: records.listEligibleTeams(
            contextId,
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
    "get_task",
    {
      description:
        "Read one current authoritative patient task without changing task or audit state.",
      inputSchema: {
        ...reconciliationScope,
        taskId: z.string().uuid(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ reconciliationId, patientId, taskId }, extra) => {
      try {
        const contextId = contextIdFromMeta(extra);
        meetings.getMeetingSegment(contextId, reconciliationId, patientId);
        const task = records
          .listPatientTasks(contextId, patientId)
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
    "save_meeting_reconciliation",
    {
      description:
        "Atomically save grounded new-task proposals, revisions of active tasks, and carry-forward warnings. New and revised work returns to draft review and cannot be published or accepted here.",
      inputSchema: {
        ...reconciliationScope,
        expectedVersion: z.number().int().positive(),
        sourceSnapshotHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        proposals: z
          .array(
            z
              .object({
                summary: z.string().trim().min(1).max(240),
                sourceQuote: z.string().min(1).max(4_000),
                taskType: z.string().min(1).max(120),
                evidenceRefs: z
                  .array(evidenceReference())
                  .min(1)
                  .max(20)
                  .refine((refs) => new Set(refs).size === refs.length),
                targetTeamId: z.string().min(1).max(160),
                requiredCapabilities: z
                  .array(z.string().min(1).max(120))
                  .max(20),
                clinicalUrgency: z.enum(["high", "medium", "routine"]),
                dueInMs: z.number().int().positive(),
              })
              .strict(),
          )
          .max(50),
        taskRevisions: z
          .array(
            z
              .object({
                taskRef: z.string().regex(/^task:[0-9a-f-]{36}@[1-9][0-9]*$/),
                summary: z.string().trim().min(1).max(240),
                sourceQuote: z.string().min(1).max(4_000),
                evidenceRefs: z
                  .array(evidenceReference())
                  .min(1)
                  .max(20)
                  .refine((refs) => new Set(refs).size === refs.length),
                clinicalUrgency: z.enum(["high", "medium", "routine"]),
                dueInMs: z.number().int().positive(),
              })
              .strict(),
          )
          .max(50)
          .default([]),
        carryForwards: z
          .array(
            z
              .object({
                taskRef: z.string().regex(/^task:[0-9a-f-]{36}@[1-9][0-9]*$/),
                reason: z.enum(["unresolved", "not_discussed", "overdue"]),
                sourceRefs: z.array(evidenceReference()).max(20),
              })
              .strict(),
          )
          .max(50),
        idempotencyKey: z.string().min(8).max(200),
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
        return success(
          meetings.saveReconciliation({
            ...input,
            contextId,
            actor: { type: "agent", id: "corti-meeting" },
            correlationId: `meeting-mcp:${input.reconciliationId}`,
          }),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}
