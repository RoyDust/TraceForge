// Rebuild UsageDaily from TraceRun/TraceSpan source facts.
// Defaults to the last 14 days and all projects. Safe to rerun: rows in scope are deleted then recreated.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--"))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split("=");
      return [key, rest.join("=") || "true"];
    }),
);

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function endOfUtcDay(value) {
  return new Date(`${value}T23:59:59.999Z`);
}

function defaultFrom() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 13);
  return isoDay(date);
}

function decimalString(value) {
  return value.toFixed(10);
}

function ensureBucket(map, key, data) {
  if (!map.has(key)) {
    map.set(key, {
      projectId: data.projectId,
      modelConfigId: data.modelConfigId ?? null,
      date: data.date,
      requestIds: new Set(),
      successIds: new Set(),
      failureIds: new Set(),
      promptTokens: 0n,
      completionTokens: 0n,
      totalCost: 0,
      latencySum: 0,
      latencyCount: 0,
    });
  }
  return map.get(key);
}

function addRunFacts(bucket, run) {
  bucket.requestIds.add(run.id);
  if (run.status === "success") {
    bucket.successIds.add(run.id);
  } else if (run.status === "failed" || run.status === "cancelled") {
    bucket.failureIds.add(run.id);
  }
  if (typeof run.latencyMs === "number") {
    bucket.latencySum += run.latencyMs;
    bucket.latencyCount += 1;
  }
}

function addSpanFacts(bucket, span) {
  bucket.promptTokens += BigInt(span.promptTokens ?? 0);
  bucket.completionTokens += BigInt(span.completionTokens ?? 0);
  bucket.totalCost += span.cost ? Number(span.cost.toString()) : 0;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("缺 DATABASE_URL");
  const from = args.from ?? defaultFrom();
  const to = args.to ?? isoDay(new Date());
  const projectId = args.projectId;
  const startedAt = { gte: startOfUtcDay(from), lte: endOfUtcDay(to) };
  const schema = new URL(process.env.DATABASE_URL).searchParams.get("schema") ?? undefined;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }, schema ? { schema } : undefined),
  });

  const modelConfigs = await prisma.modelConfig.findMany({ select: { id: true, modelName: true } });
  const modelIdByName = new Map(modelConfigs.map((model) => [model.modelName, model.id]));
  const runs = await prisma.traceRun.findMany({
    where: {
      startedAt,
      ...(projectId ? { projectId } : {}),
    },
    include: {
      spans: {
        select: {
          model: true,
          promptTokens: true,
          completionTokens: true,
          cost: true,
        },
      },
    },
    orderBy: { startedAt: "asc" },
  });

  const buckets = new Map();
  for (const run of runs) {
    const day = startOfUtcDay(isoDay(run.startedAt));
    const projectKey = `${run.projectId}:${isoDay(day)}:project`;
    const projectBucket = ensureBucket(buckets, projectKey, {
      projectId: run.projectId,
      date: day,
      modelConfigId: null,
    });
    addRunFacts(projectBucket, run);

    for (const span of run.spans) {
      addSpanFacts(projectBucket, span);
      const modelConfigId = span.model ? modelIdByName.get(span.model) ?? null : null;
      if (!modelConfigId) continue;
      const modelKey = `${run.projectId}:${isoDay(day)}:${modelConfigId}`;
      const modelBucket = ensureBucket(buckets, modelKey, {
        projectId: run.projectId,
        date: day,
        modelConfigId,
      });
      addRunFacts(modelBucket, run);
      addSpanFacts(modelBucket, span);
    }
  }

  await prisma.usageDaily.deleteMany({
    where: {
      date: { gte: startOfUtcDay(from), lte: startOfUtcDay(to) },
      ...(projectId ? { projectId } : {}),
    },
  });

  const rows = [...buckets.values()].map((bucket) => ({
    projectId: bucket.projectId,
    modelConfigId: bucket.modelConfigId,
    date: bucket.date,
    requestCount: bucket.requestIds.size,
    successCount: bucket.successIds.size,
    failureCount: bucket.failureIds.size,
    promptTokens: bucket.promptTokens,
    completionTokens: bucket.completionTokens,
    totalCost: decimalString(bucket.totalCost),
    averageLatencyMs: bucket.latencyCount ? Math.round(bucket.latencySum / bucket.latencyCount) : null,
  }));

  if (rows.length > 0) {
    await prisma.usageDaily.createMany({ data: rows });
  }

  const projectRows = rows.filter((row) => row.modelConfigId === null);
  const aggregate = projectRows.reduce(
    (acc, row) => {
      acc.requests += row.requestCount;
      acc.success += row.successCount;
      acc.failure += row.failureCount;
      acc.prompt += row.promptTokens;
      acc.completion += row.completionTokens;
      acc.cost += Number(row.totalCost);
      return acc;
    },
    { requests: 0, success: 0, failure: 0, prompt: 0n, completion: 0n, cost: 0 },
  );
  const source = runs.reduce(
    (acc, run) => {
      acc.requests += 1;
      if (run.status === "success") acc.success += 1;
      if (run.status === "failed" || run.status === "cancelled") acc.failure += 1;
      for (const span of run.spans) {
        acc.prompt += BigInt(span.promptTokens ?? 0);
        acc.completion += BigInt(span.completionTokens ?? 0);
        acc.cost += span.cost ? Number(span.cost.toString()) : 0;
      }
      return acc;
    },
    { requests: 0, success: 0, failure: 0, prompt: 0n, completion: 0n, cost: 0 },
  );

  console.log("UsageDaily rebuilt");
  console.log(`scope: project=${projectId ?? "all"} from=${from} to=${to}`);
  console.log(`rows: ${rows.length} (${projectRows.length} project buckets, ${rows.length - projectRows.length} model buckets)`);
  console.log(
    `source: requests=${source.requests} success=${source.success} failure=${source.failure} prompt=${source.prompt} completion=${source.completion} cost=${source.cost.toFixed(10)}`,
  );
  console.log(
    `aggregate: requests=${aggregate.requests} success=${aggregate.success} failure=${aggregate.failure} prompt=${aggregate.prompt} completion=${aggregate.completion} cost=${aggregate.cost.toFixed(10)}`,
  );
  console.log(
    `match: requests=${source.requests === aggregate.requests} success=${source.success === aggregate.success} failure=${source.failure === aggregate.failure} tokens=${source.prompt === aggregate.prompt && source.completion === aggregate.completion} cost=${Math.abs(source.cost - aggregate.cost) < 0.000000001}`,
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
