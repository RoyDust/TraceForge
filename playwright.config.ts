import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

const consolePort = process.env.TRACEFORGE_E2E_PORT ?? "3131";
const gatewayPort = process.env.TRACEFORGE_E2E_GATEWAY_PORT ?? "18799";
const upstreamPort = process.env.TRACEFORGE_E2E_UPSTREAM_PORT ?? "18800";
const baseURL = "http://127.0.0.1:" + consolePort;

function consoleServer(mode: string, port: string, overrides: Record<string, string> = {}): Exclude<NonNullable<PlaywrightTestConfig["webServer"]>, unknown[]> {
  const image = process.env.TRACEFORGE_E2E_IMAGE;
  const env: Record<string, string> = { HOSTNAME: "127.0.0.1", PORT: port, TRACEFORGE_CHAT_MODEL: "", ...overrides };
  let command = "node .next-e2e/standalone/server.js";
  if (image) {
    const hostNetwork = process.platform === "linux";
    for (const key of ["DATABASE_URL", "TRACEFORGE_CHAT_GATEWAY_URL", "TRACEFORGE_EVAL_GATEWAY_URL"]) {
      const url = new URL(process.env[key]!);
      if (!hostNetwork && ["localhost", "127.0.0.1"].includes(url.hostname)) url.hostname = "host.docker.internal";
      env[key] = url.toString();
    }
    Object.assign(env, { HOSTNAME: hostNetwork ? "127.0.0.1" : "0.0.0.0", PORT: hostNetwork ? port : "3000" });
    const keys = ["DATABASE_URL", "DEMO_MODE", "ADMIN_EMAIL", "ADMIN_PASSWORD_HASH", "TRACEFORGE_CHAT_GATEWAY_URL", "TRACEFORGE_CHAT_API_KEY", "TRACEFORGE_CHAT_MODEL", "TRACEFORGE_CHAT_TIMEOUT_MS", "TRACEFORGE_EVAL_GATEWAY_URL", "TRACEFORGE_EVAL_API_KEY", "TRACEFORGE_EVAL_TIMEOUT_MS", "TRACEFORGE_EVAL_TOTAL_TIMEOUT_MS", "TRACEFORGE_EVAL_MAX_CASES", "HOSTNAME", "PORT"];
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    command = ["docker run --rm --name", quote(process.env.TRACEFORGE_E2E_CONTAINER + "-" + mode), hostNetwork ? "--network host" : "-p 127.0.0.1:" + port + ":3000", ...keys.map((key) => "-e " + key), quote(image)].join(" ");
  }
  return { command, url: "http://127.0.0.1:" + port + "/login", env, reuseExistingServer: false, timeout: 60000 };
}

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
    consoleServer("demo", process.env.TRACEFORGE_E2E_DEMO_PORT!, { DEMO_MODE: "true", ADMIN_EMAIL: "", ADMIN_PASSWORD_HASH: "", TRACEFORGE_CHAT_API_KEY: "e2e-unregistered-key" }),
    consoleServer("no-key", process.env.TRACEFORGE_E2E_NO_KEY_PORT!, { TRACEFORGE_CHAT_API_KEY: "", TRACEFORGE_EVAL_API_KEY: "" }),
    consoleServer("normal", consolePort, { TRACEFORGE_CHAT_MODEL: "mock-mid" }),
  ],
});
