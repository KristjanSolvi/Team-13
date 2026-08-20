import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./harness", import.meta.url)),
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/health": "http://127.0.0.1:8787",
    },
  },
  build: {
    outDir: "../dist/harness",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        microphone: fileURLToPath(new URL("./harness/index.html", import.meta.url)),
        evaluation: fileURLToPath(
          new URL("./harness/evaluation.html", import.meta.url),
        ),
      },
    },
  },
});
