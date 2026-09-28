// Own only a fresh test schema and, when needed, a temporary PostgreSQL container.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const prismaCli = resolve(dirname(require.resolve("prisma/package.json")), "build/index.js");
const nextCli = require.resolve("next/dist/bin/next");
const playwrightCli = require.resolve("@playwright/test/cli");
let activeChild;
let interrupted = false;

function run(command, args, { env = process.env, capture = false, cleanup = false } = {}) {
  if (interrupted && !cleanup) throw new Error("Test run interrupted");
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      windowsHide: true,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    activeChild = child;
    let output = "";
    let errorOutput = "";
    child.stdout?.on("data", (chunk) => { output += chunk; });
    child.stderr?.on("data", (chunk) => { errorOutput += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      activeChild = undefined;
      if (code === 0) resolveResult(output.trim());
      else reject(new Error(command + " exited with code " + code + (errorOutput ? ": " + errorOutput.trim() : "")));
    });
  });
}

function interrupt() {
  interrupted = true;
  if (!activeChild?.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(activeChild.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    activeChild.kill("SIGTERM");
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return String(port);
}

async function main() {
  const id = randomUUID().replaceAll("-", "");
  const schema = "traceforge_e2e_" + id;
  const container = "traceforge-e2e-" + id;
  let ownsContainer = false;
  let ownsSchema = false;
  let pool;
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);

  try {
    let databaseURL = process.env.TEST_DATABASE_URL;
    if (!databaseURL) {
      console.log("Starting disposable PostgreSQL 16 (or set TEST_DATABASE_URL to an existing test server).");
      // The daemon can create it before the CLI returns (including during interruption).
      ownsContainer = true;
      await run("docker", ["run", "--detach", "--rm", "--name", container,
        "--env", "POSTGRES_PASSWORD=traceforge-e2e", "--env", "POSTGRES_DB=traceforge",
        "--publish", "127.0.0.1::5432", "postgres:16"], { capture: true });
      const binding = await run("docker", ["port", container, "5432/tcp"], { capture: true });
      const port = binding.split(":").at(-1);
      databaseURL = "postgresql://postgres:traceforge-e2e@127.0.0.1:" + port + "/traceforge";
    }

    const url = new URL(databaseURL);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("TEST_DATABASE_URL must use PostgreSQL");
    url.searchParams.delete("schema");
    pool = new pg.Pool({ connectionString: url.toString(), connectionTimeoutMillis: 2_000, statement_timeout: 15_000 });
    const deadline = Date.now() + 30_000;
    for (;;) {
      if (interrupted) throw new Error("Test run interrupted");
      try { await pool.query("SELECT 1"); break; }
      catch (error) { if (Date.now() >= deadline) throw error; await delay(500); }
    }
    await pool.query('CREATE SCHEMA "' + schema + '"');
    ownsSchema = true;
    url.searchParams.set("schema", schema);
    const consolePort = await freePort();
    const gatewayPort = await freePort();
    const gatewayURL = "http://127.0.0.1:" + gatewayPort;
    const env = {
      ...process.env,
      DATABASE_URL: url.toString(),
      ADMIN_EMAIL: "smoke@example.com",
      ADMIN_PASSWORD_HASH: "plain:e2e-local-password",
      TRACEFORGE_CHAT_GATEWAY_URL: gatewayURL,
      TRACEFORGE_CHAT_API_KEY: "e2e-local-key",
      TRACEFORGE_EVAL_GATEWAY_URL: gatewayURL,
      TRACEFORGE_EVAL_API_KEY: "e2e-local-key",
      TRACEFORGE_E2E_PORT: consolePort,
      TRACEFORGE_E2E_GATEWAY_PORT: gatewayPort,
      TRACEFORGE_E2E_DIST_DIR: ".next-e2e",
      NEXT_TELEMETRY_DISABLED: "1",
    };
    console.log("Preparing isolated schema " + schema);
    await run(process.execPath, [prismaCli, "generate"], { env });
    await run(process.execPath, [prismaCli, "db", "push"], { env });
    await pool.query('INSERT INTO "' + schema + '"."project" (id, name, updated_at) VALUES ($1, $2, NOW())',
      [randomUUID(), "Playwright baseline"]);
    await run("cargo", ["build", "--quiet", "--manifest-path", "gateway/Cargo.toml", "--bin", "mock_upstream"], { env });
    await run(process.execPath, [nextCli, "build"], { env });
    await run(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)], { env });
  } finally {
    // These names were generated by this process; never reset or clear a supplied database.
    try {
      if (ownsSchema) {
        await pool.query('DROP SCHEMA "' + schema + '" CASCADE');
        console.log("Removed isolated test schema.");
      }
    } finally {
      try {
        await pool?.end();
      } finally {
        try {
          if (ownsContainer) {
            try {
              await run("docker", ["rm", "--force", container], { capture: true, cleanup: true });
            } catch (error) {
              // A failed start may never have created the container. Other errors matter.
              if (!error.message.includes("No such container: " + container)) throw error;
            }
          }
        } finally {
          process.removeListener("SIGINT", interrupt);
          process.removeListener("SIGTERM", interrupt);
        }
      }
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = interrupted ? 130 : 1;
});
