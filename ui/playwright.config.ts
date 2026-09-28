import { defineConfig } from "@playwright/test";

// The browser tests run the real Rust backend (`torsgui-server`) on a demo
// workspace built by e2e/global-setup.ts, and the production UI build.
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: "http://127.0.0.1:7880",
    viewport: { width: 1920, height: 1080 },
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
});
