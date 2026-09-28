import { defineConfig, devices } from "@playwright/test";

const consolePort = process.env.TRACEFORGE_E2E_PORT ?? "3131";
const gatewayPort = process.env.TRACEFORGE_E2E_GATEWAY_PORT ?? "18799";
const baseURL = "http://127.0.0.1:" + consolePort;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "cargo run --quiet --manifest-path gateway/Cargo.toml --bin mock_upstream",
      url: "http://127.0.0.1:" + gatewayPort + "/healthz",
      env: { MOCK_ADDR: "127.0.0.1:" + gatewayPort },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port " + consolePort,
      url: baseURL + "/login",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
