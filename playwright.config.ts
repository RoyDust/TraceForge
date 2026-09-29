import { defineConfig, devices } from "@playwright/test";

const consolePort = process.env.TRACEFORGE_E2E_PORT ?? "3131";
const gatewayPort = process.env.TRACEFORGE_E2E_GATEWAY_PORT ?? "18799";
const upstreamPort = process.env.TRACEFORGE_E2E_UPSTREAM_PORT ?? "18800";
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
      url: "http://127.0.0.1:" + upstreamPort + "/healthz",
      env: { MOCK_ADDR: "127.0.0.1:" + upstreamPort },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "./gateway/target/debug/traceforge-gateway",
      url: "http://127.0.0.1:" + gatewayPort + "/readyz",
      env: { DATABASE_URL: process.env.TRACEFORGE_GATEWAY_DATABASE_URL!, GATEWAY_ADDR: "127.0.0.1:" + gatewayPort },
      reuseExistingServer: false, timeout: 60000,
    },
    {
      command: "node .next-e2e/standalone/server.js",
      url: "http://127.0.0.1:" + process.env.TRACEFORGE_E2E_DEMO_PORT + "/login",
      env: { HOSTNAME: "127.0.0.1", PORT: process.env.TRACEFORGE_E2E_DEMO_PORT!, DEMO_MODE: "true", ADMIN_EMAIL: "", ADMIN_PASSWORD_HASH: "" },
      reuseExistingServer: false, timeout: 60000,
    },
    {
      command: "node .next-e2e/standalone/server.js",
      url: "http://127.0.0.1:" + process.env.TRACEFORGE_E2E_NO_KEY_PORT + "/login",
      env: { HOSTNAME: "127.0.0.1", PORT: process.env.TRACEFORGE_E2E_NO_KEY_PORT!, TRACEFORGE_CHAT_API_KEY: "", TRACEFORGE_EVAL_API_KEY: "" },
      reuseExistingServer: false, timeout: 60000,
    },
    {
      command: "node .next-e2e/standalone/server.js",
      url: baseURL + "/login",
      env: { HOSTNAME: "127.0.0.1", PORT: consolePort },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
