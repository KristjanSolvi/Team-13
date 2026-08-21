// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  nitro: {
    // Lovable keeps its Cloudflare preset; Railway sets NITRO_PRESET=node-server.
    preset: process.env["NITRO_PRESET"] ?? "cloudflare-module",
  },
  vite: {
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
            proxy.on("proxyReq", (proxyReq) => {
              const upstreamPath = proxyReq.path ?? "";
              if (
                /^\/api\/patients\/[^/]+\/handovers$/.test(upstreamPath) ||
                /^\/api\/ward-meetings(?:\/|$)/.test(upstreamPath)
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
