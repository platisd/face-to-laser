import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/face-to-laser/",
  server: { host: "127.0.0.1" },
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 20000 },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    server: { deps: { inline: ["@techstark/opencv-js"] } },
  },
});
