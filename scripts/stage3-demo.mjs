// Stage 3 demo: seed deterministic local fixtures, call the gateway, and print Console URLs.
// Requires local gateway on :8787 and mock upstream on :8799. No real provider key is used.
import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const GATEWAY_URL = process.env.STAGE3_GATEWAY_URL ?? "http://localhost:8787";
const CONSOLE_URL = process.env.STAGE3_CONSOLE_URL ?? "http://localhost:3000";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

async function gatewayReady() {
  try {
    const gateway = await fetch(`${GATEWAY_URL}/healthz`);
    return gateway.ok;
  } catch {
    return false;
  }
}

async function chat({ label, key, model, stream }) {
  const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream,
      messages: [{ role: "user", content: `stage3 demo ${label}` }],
    }),
  });

  let body = "";
  try {
    body = await res.text();
  } catch (error) {
    body = String(error);
  }
  console.log(`${label.padEnd(18)} status=${res.status} model=${model} stream=${stream} body=${body.slice(0, 100).replace(/\s+/g, " ")}`);
  return res.status;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("缺 DATABASE_URL");
  if (!process.env.MASTER_ENCRYPTION_KEY) throw new Error("缺 MASTER_ENCRYPTION_KEY");

  console.log("== Stage 3 demo ==");
  console.log("Seeding project/API key and mock provider/model fixtures...");
  run("npx", ["tsx", "scripts/seed-apikey.ts"]);
  run("npx", ["tsx", "scripts/seed-mock.ts"]);

  if (!(await gatewayReady())) {
    throw new Error("Gateway 未就绪。请先启动 gateway(:8787)，并确保 mock upstream(:8799) 正在运行。");
  }

  const schema = new URL(process.env.DATABASE_URL).searchParams.get("schema") ?? undefined;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }, schema ? { schema } : undefined),
  });

  const suffix = Date.now().toString(36);
  const activeKey = `tf-stage3-${suffix}`;
  const revokedKey = `tf-stage3-revoked-${suffix}`;
  const startedAt = new Date(Date.now() - 5000);

  await prisma.apiKey.create({
    data: {
      id: randomUUID(),
      projectId: PROJECT_ID,
      name: `stage3 demo active ${suffix}`,
      keyHash: sha256(activeKey),
      scope: ["gateway"],
      rpmLimit: 5,
      concurrencyLimit: 2,
    },
  });
  await prisma.apiKey.create({
    data: {
      id: randomUUID(),
      projectId: PROJECT_ID,
      name: `stage3 demo revoked ${suffix}`,
      keyHash: sha256(revokedKey),
      scope: ["gateway"],
      status: "revoked",
      revokedAt: new Date(),
    },
  });

  console.log("Calling gateway to create representative traces...");
  await chat({ label: "success", key: activeKey, model: "mock-ok", stream: false });
  await chat({ label: "fallback", key: activeKey, model: "mock-fail", stream: true });
  await chat({ label: "network", key: activeKey, model: "mock-mid", stream: true });
  await chat({ label: "model_failure", key: activeKey, model: "mock-fail-alone", stream: false });
  await chat({ label: "rpm-fill", key: activeKey, model: "mock-ok", stream: false });
  await chat({ label: "rate_limited", key: activeKey, model: "mock-ok", stream: false });
  await chat({ label: "revoked_key", key: revokedKey, model: "mock-ok", stream: false });

  await new Promise((resolve) => setTimeout(resolve, 2000));

  const runs = await prisma.traceRun.findMany({
    where: { projectId: PROJECT_ID, startedAt: { gte: startedAt } },
    orderBy: { startedAt: "desc" },
    include: { spans: { include: { events: true } } },
  });

  console.log("");
  console.log("Console demo path:");
  console.log(`1. Login:        ${CONSOLE_URL}/login`);
  console.log(`2. Filter fail:  ${CONSOLE_URL}/traces?status=failed`);
  console.log("3. Open a failed Run and verify: status/error_code -> Span/Event chain -> responsibility domain.");
  console.log("");
  console.log("Recent demo runs:");
  for (const run of runs) {
    const events = run.spans.flatMap((span) => span.events.map((event) => event.type));
    console.log(
      `- ${run.status.padEnd(9)} ${String(run.errorCode ?? "-").padEnd(18)} ${run.name ?? "-"} ${CONSOLE_URL}/traces/${run.id} events=[${events.join(",") || "-"}]`,
    );
  }
  console.log("");
  console.log("Verification commands:");
  console.log("- npm run build");
  console.log("- npx prisma validate");
  console.log("- node scripts/verify-trace.mjs");

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
