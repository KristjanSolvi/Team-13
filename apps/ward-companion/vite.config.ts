// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    server: {
      proxy: {
        "/pipeline-health": {
          target: process.env["PIPELINE_BASE_URL"] ?? "http://127.0.0.1:8787",
          changeOrigin: true,
          rewrite: () => "/health",
        },
        "/api/corti": {
          target: process.env["PIPELINE_BASE_URL"] ?? "http://127.0.0.1:8787",
          changeOrigin: true,
        },
        "/follow-through-api": {
          target: process.env["INTEGRATION_API_URL"] ?? "http://127.0.0.1:8790",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/follow-through-api/, ""),
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
