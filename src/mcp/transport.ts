import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Request, Response, Router } from "express";

import { hasBearer } from "./auth.js";

type JsonRpcId = string | number | null;

interface StatefulTransport extends Transport {
  handleRequest(
    request: Request,
    response: Response,
    parsedBody?: unknown,
  ): Promise<void>;
}

interface StatefulTransportOptions {
  sessionIdGenerator: () => string;
  enableJsonResponse: boolean;
  onsessioninitialized: (sessionId: string) => void | Promise<void>;
  onsessionclosed: (sessionId: string) => void | Promise<void>;
}

interface StatefulTransportModule {
  StreamableHTTPServerTransport: new (
    options: StatefulTransportOptions,
  ) => StatefulTransport;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStatefulTransportModule(
  value: unknown,
): value is StatefulTransportModule {
  if (!isObject(value)) return false;
  const transportConstructor = value.StreamableHTTPServerTransport;
  if (typeof transportConstructor !== "function") return false;
  const prototype: unknown = Reflect.get(transportConstructor, "prototype");
  return (
    isObject(prototype) &&
    typeof prototype.start === "function" &&
    typeof prototype.send === "function" &&
    typeof prototype.close === "function" &&
    typeof prototype.handleRequest === "function"
  );
}

const requireSdk = createRequire(import.meta.url);
const loadedTransportModule: unknown = requireSdk(
  "@modelcontextprotocol/sdk/server/streamableHttp.js",
);
if (!isStatefulTransportModule(loadedTransportModule)) {
  throw new TypeError("MCP Streamable HTTP transport is unavailable");
}
const { StreamableHTTPServerTransport } = loadedTransportModule;

function requestId(body: unknown): JsonRpcId {
  if (!isObject(body)) return null;
  const id = body.id;
  return typeof id === "string" || typeof id === "number" || id === null
    ? id
    : null;
}

function jsonRpcError(
  response: Response,
  status: number,
  code: number,
  message: string,
  id: JsonRpcId,
): void {
  response.status(status).json({
    jsonrpc: "2.0",
    error: { code, message },
    id,
  });
}

export function mountMcp(
  router: Router,
  createServer: () => McpServer,
  bearerToken: string,
  routePath = "/mcp",
): void {
  const sessions = new Map<string, StatefulTransport>();

  const failInternal = (response: Response): void => {
    if (!response.headersSent) {
      jsonRpcError(response, 500, -32603, "Internal server error", null);
    } else if (!response.writableEnded) {
      response.end();
    }
  };

  const authorize = (
    request: Request,
    response: Response,
    body: unknown,
  ): boolean => {
    if (hasBearer(request, bearerToken)) return true;
    jsonRpcError(response, 401, -32001, "Unauthorized", requestId(body));
    return false;
  };

  const handlePost = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const body: unknown = request.body;
    if (!authorize(request, response, body)) return;

    const sessionId = request.header("mcp-session-id");
    const existing =
      sessionId === undefined ? undefined : sessions.get(sessionId);
    if (existing) {
      await existing.handleRequest(request, response, body);
      return;
    }

    if (sessionId !== undefined || !isInitializeRequest(body)) {
      jsonRpcError(
        response,
        400,
        -32000,
        "Invalid MCP session",
        requestId(body),
      );
      return;
    }

    let initializingTransport: StatefulTransport | undefined;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (initializedSessionId) => {
        if (!initializingTransport) {
          throw new Error("MCP transport initialization failed");
        }
        sessions.set(initializedSessionId, initializingTransport);
      },
      onsessionclosed: (closedSessionId) => {
        sessions.delete(closedSessionId);
      },
    });
    initializingTransport = transport;
    transport.onclose = () => {
      const closedSessionId = transport.sessionId;
      if (closedSessionId !== undefined) sessions.delete(closedSessionId);
    };
    await createServer().connect(transport);
    await transport.handleRequest(request, response, body);
  };

  router.post(routePath, (request, response) => {
    void handlePost(request, response).catch(() => failInternal(response));
  });

  const handleExisting = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const body: unknown = request.body;
    if (!authorize(request, response, body)) return;
    const sessionId = request.header("mcp-session-id") ?? "";
    const transport = sessions.get(sessionId);
    if (!transport) {
      jsonRpcError(response, 400, -32000, "Invalid MCP session", null);
      return;
    }
    await transport.handleRequest(request, response);
  };

  router.get(routePath, (request, response) => {
    void handleExisting(request, response).catch(() => failInternal(response));
  });
  router.delete(routePath, (request, response) => {
    void handleExisting(request, response).catch(() => failInternal(response));
  });
}
