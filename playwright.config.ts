import { defineConfig } from "@playwright/test";

const PORT = 7861;

export default defineConfig({
  testDir: "tests/ui",
  timeout: 180000,
  use: {
    baseURL: `http://localhost:${PORT}/face-to-laser/`,
    channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome",
    acceptDownloads: true,
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/face-to-laser/`,
    reuseExistingServer: true,
    timeout: 180000,
  },
});
