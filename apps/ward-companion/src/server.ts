import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import {
  authorizeDemoHostAccessRequest,
  authorizeDemoHostMutation,
  createDemoHostSession,
  demoHostCookieHeader,
} from "./lib/demo-host-session";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

const integrationProxyPrefix = "/follow-through-api";
const demoHostSessionPath = "/api/demo/host/session";
const demoRouteNowPath = /^\/api\/demo\/tasks\/[^/]+\/route-now$/;

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * Railway serves fingerprinted assets, but the document choosing those assets
 * must always be revalidated after a deploy. This also covers browser refreshes
 * that identify the request as a document before SSR has set a content type.
 */
function preventStaleDocumentCaching(request: Request, response: Response): Response {
  const contentType = response.headers.get("content-type") ?? "";
  const isDocument =
    contentType.includes("text/html") || request.headers.get("sec-fetch-dest") === "document";
  if (!isDocument) return response;

  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store, no-cache, must-revalidate, max-age=0");
  headers.set("cdn-cache-control", "no-store");
  headers.set("surrogate-control", "no-store");
  headers.set("pragma", "no-cache");
  headers.set("expires", "0");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

function proxyConfigurationError(message: string): Response {
  return Response.json(
    {
      error: {
        code: "INTEGRATION_PROXY_UNAVAILABLE",
        message,
        retryable: true,
      },
    },
    { status: 503, headers: { "cache-control": "no-store" } },
  );
}

/**
 * Keep the Integration API as the browser's only backend without exposing
 * service locations or the privileged handover bearer in the client bundle.
 * Vite owns this same path during local development; this handler is the
 * equivalent boundary in the built Railway server.
 */
async function proxyIntegrationRequest(request: Request): Promise<Response | null> {
  const incoming = new URL(request.url);
  if (
    incoming.pathname !== integrationProxyPrefix &&
    !incoming.pathname.startsWith(`${integrationProxyPrefix}/`)
  ) {
    return null;
  }

  const upstreamPath = incoming.pathname.slice(integrationProxyPrefix.length) || "/";
  const integrationBearer = process.env["INTEGRATION_API_BEARER_TOKEN"]?.trim() ?? "";
  if (upstreamPath === demoHostSessionPath) {
    const accessError = await authorizeDemoHostAccessRequest(
      request,
      process.env["DEMO_HOST_ACCESS_KEY"]?.trim() ?? "",
    );
    if (accessError !== null) return accessError;
    if (integrationBearer.length < 8) {
      return proxyConfigurationError("The server-side integration credential is not configured.");
    }
    const session = await createDemoHostSession(integrationBearer);
    return Response.json(
      { authorized: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt },
      {
        headers: {
          "cache-control": "no-store",
          "set-cookie": demoHostCookieHeader(
            session.token,
            incoming.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
          ),
        },
      },
    );
  }
  if (demoRouteNowPath.test(upstreamPath)) {
    if (integrationBearer.length < 8) {
      return proxyConfigurationError("The server-side integration credential is not configured.");
    }
    const authorizationError = await authorizeDemoHostMutation(request, integrationBearer);
    if (authorizationError !== null) return authorizationError;
  }

  const configuredTarget = process.env["INTEGRATION_API_URL"]?.trim();
  if (!configuredTarget) {
    return proxyConfigurationError("The server-side Integration API target is not configured.");
  }

  let target: URL;
  try {
    const upstreamPath = incoming.pathname.slice(integrationProxyPrefix.length) || "/";
    target = new URL(`${upstreamPath}${incoming.search}`, configuredTarget);
  } catch {
    return proxyConfigurationError("The server-side Integration API target is invalid.");
  }

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("cookie");
  headers.delete("x-demo-csrf");
  headers.delete("x-demo-host-key");
  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", incoming.protocol.slice(0, -1));

  const requiresIntegrationBearer =
    /^\/api\/patients\/[^/]+\/handovers$/.test(upstreamPath) ||
    /^\/api\/ward-meetings(?:\/|$)/.test(upstreamPath) ||
    demoRouteNowPath.test(upstreamPath);
  if (requiresIntegrationBearer) {
    if (integrationBearer.length < 8) {
      return proxyConfigurationError("The server-side integration credential is not configured.");
    }
    headers.set("authorization", `Bearer ${integrationBearer}`);
  }

  try {
    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer();
    const response = await fetch(target, {
      method: request.method,
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: "manual",
    });
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");
    responseHeaders.set("cache-control", "no-store");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch {
    return proxyConfigurationError("The Integration API could not be reached.");
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const proxied = await proxyIntegrationRequest(request);
      if (proxied !== null) return proxied;
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return preventStaleDocumentCaching(request, await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return preventStaleDocumentCaching(
        request,
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
