// Stage 4 demo: generate local mock traces, rebuild UsageDaily, and print Dashboard verification URLs.
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const CONSOLE_URL = process.env.STAGE4_CONSOLE_URL ?? "http://localhost:3000";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("缺 DATABASE_URL");
  const fromDate = new Date();
  fromDate.setUTCDate(fromDate.getUTCDate() - 13);
  const from = isoDay(fromDate);
  const to = isoDay(new Date());

  console.log("== Stage 4 demo ==");
  console.log("Generating representative Stage 3 traces...");
  run("node", ["scripts/stage3-demo.mjs"]);
  console.log("Rebuilding UsageDaily aggregates...");
  run("node", ["scripts/aggregate-usage-daily.mjs", `--from=${from}`, `--to=${to}`]);

  const schema = new URL(process.env.DATABASE_URL).searchParams.get("schema") ?? undefined;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }, schema ? { schema } : undefined),
  });
  const latestNetworkFailure = await prisma.traceRun.findFirst({
    where: { status: "failed", spans: { some: { errorCode: "stream_interrupted" } } },
    orderBy: { startedAt: "desc" },
  });

  console.log("");
  console.log("Console demo path:");
  console.log(`1. Login:          ${CONSOLE_URL}/login`);
  console.log(`2. Dashboard:      ${CONSOLE_URL}/dashboard?from=${from}&to=${to}`);
  console.log(`3. Failed traces:  ${CONSOLE_URL}/traces?status=failed&from=${from}&to=${to}`);
  if (latestNetworkFailure) {
    console.log(`4. Detail sample:  ${CONSOLE_URL}/traces/${latestNetworkFailure.id}`);
  }
  console.log("");
  console.log("Expected Dashboard evidence:");
  console.log("- KPI cells show requests, failures, tokens, cost, average latency, and P95 latency.");
  console.log("- Model/provider table includes Mock Upstream / mock-ok, mock-mid, and mock-fail-alone.");
  console.log("- Governance panels show rate_limited, revoked_api_key, fallback_triggered, and stream_interrupted coverage.");
  console.log("");
  console.log("Verification commands:");
  console.log("- npm run build");
  console.log("- npx prisma validate");
  console.log("- npm run db:generate");
  console.log("- cargo test (inside gateway/)");
  console.log("- cargo check --examples (inside gateway/)");
  console.log("- node scripts/stage4-demo.mjs");

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
