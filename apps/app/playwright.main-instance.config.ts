import { defineConfig } from "@playwright/test";
import { baseConfig } from "./playwright.config";
import {
  MAIN_APP_PORT,
  MAIN_RSS_SERVER_PORT,
} from "./tests/e2e/fixtures/ports";
import { supervisedWebServerCommand } from "./tests/e2e/fixtures/web-server-command";

export default defineConfig({
  ...baseConfig,
  globalSetup: "./tests/global-setup.ts",
  testDir: "./tests/e2e/main-instance",
  use: {
    ...baseConfig.use,
    baseURL: `http://localhost:${MAIN_APP_PORT}`,
  },
  webServer: [
    {
      command: supervisedWebServerCommand("pnpm dev:test:main"),
      url: `http://localhost:${MAIN_APP_PORT}`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: supervisedWebServerCommand(
        `node --import=tsx tests/e2e/fixtures/rss-server.ts ${MAIN_RSS_SERVER_PORT}`,
      ),
      url: `http://127.0.0.1:${MAIN_RSS_SERVER_PORT}`,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
