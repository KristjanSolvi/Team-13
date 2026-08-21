// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

import {
  authorizeDemoHostAccessRequest,
  authorizeDemoHostMutation,
  createDemoHostSession,
  demoHostCookieHeader,
} from "./src/lib/demo-host-session.ts";

const demoHostSessionPath = "/follow-through-api/api/demo/host/session";
const demoRouteNowPath = /^\/follow-through-api\/api\/demo\/tasks\/[^/]+\/route-now$/;
const authorizedDemoHostRequests = new WeakSet<IncomingMessage>();

function webRequest(request: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) headers.set(name, value.join(", "));
    else if (value !== undefined) headers.set(name, value);
  }
  return new Request(`http://${request.headers.host ?? "127.0.0.1"}${request.url ?? "/"}`, {
    method: request.method ?? "GET",
    headers,
  });
}

async function sendWebResponse(response: ServerResponse, result: Response): Promise<void> {
  response.statusCode = result.status;
  result.headers.forEach((value, name) => response.setHeader(name, value));
  response.end(Buffer.from(await result.arrayBuffer()));
}

function demoHostBoundary(): Plugin {
  return {
    name: "fluence-demo-host-boundary",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const path = new URL(request.url ?? "/", "http://local").pathname;
        if (path === demoHostSessionPath) {
          const browserRequest = webRequest(request);
          const accessError = await authorizeDemoHostAccessRequest(
            browserRequest,
            process.env["DEMO_HOST_ACCESS_KEY"]?.trim() ?? "",
          );
          if (accessError !== null) {
            await sendWebResponse(response, accessError);
            return;
          }
          const signingSecret = process.env["INTEGRATION_API_BEARER_TOKEN"]?.trim() ?? "";
          if (signingSecret.length < 8) {
            await sendWebResponse(
              response,
              Response.json(
                {
                  error: {
                    code: "INTEGRATION_PROXY_UNAVAILABLE",
                    message: "The server-side integration credential is not configured.",
                    retryable: true,
                  },
                },
                { status: 503 },
              ),
            );
            return;
          }
          const session = await createDemoHostSession(signingSecret);
          await sendWebResponse(
            response,
            Response.json(
              { authorized: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt },
              { headers: { "set-cookie": demoHostCookieHeader(session.token, false) } },
            ),
          );
          return;
        }
        if (demoRouteNowPath.test(path)) {
          const signingSecret = process.env["INTEGRATION_API_BEARER_TOKEN"]?.trim() ?? "";
          const authorizationError = await authorizeDemoHostMutation(
            webRequest(request),
            signingSecret,
          );
          if (authorizationError !== null) {
            await sendWebResponse(response, authorizationError);
            return;
          }
          authorizedDemoHostRequests.add(request);
          delete request.headers.cookie;
          delete request.headers["x-demo-csrf"];
        }
        next();
      });
    },
  };
}

export default defineConfig({
  nitro: {
    // Lovable keeps its Cloudflare preset; Railway sets NITRO_PRESET=node-server.
    preset: process.env["NITRO_PRESET"] ?? "cloudflare-module",
  },
  vite: {
    plugins: [demoHostBoundary()],
    server: {
      proxy: {
        "/follow-through-api": {
          target: process.env["INTEGRATION_API_URL"] ?? "http://127.0.0.1:8790",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/follow-through-api/, ""),
          // Grounded handovers and ward-meeting orchestration require the
          // integration bearer. The dev server attaches it only to those
          // trusted paths so the token never reaches the browser bundle.
          configure: (proxy) => {
            const integrationBearer = process.env["INTEGRATION_API_BEARER_TOKEN"];
            if (integrationBearer === undefined || integrationBearer.length === 0) return;
            proxy.on("proxyReq", (proxyReq, request) => {
              const upstreamPath = proxyReq.path ?? "";
              if (
                /^\/api\/patients\/[^/]+\/handovers$/.test(upstreamPath) ||
                /^\/api\/ward-meetings(?:\/|$)/.test(upstreamPath) ||
                (/^\/api\/demo\/tasks\/[^/]+\/route-now$/.test(upstreamPath) &&
                  authorizedDemoHostRequests.has(request))
              ) {
                proxyReq.setHeader("authorization", `Bearer ${integrationBearer}`);
              }
            });
          },
        },
      },
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
