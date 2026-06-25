// 临时校验: 打印最近的 TraceRun + Span + Event。验证完可删。
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
const schema = new URL(process.env.DATABASE_URL).searchParams.get("schema") ?? undefined;
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }, schema ? { schema } : undefined) });
const runs = await prisma.traceRun.findMany({ orderBy: { startedAt: "desc" }, take: 5, include: { spans: { include: { events: true } } } });
for (const r of runs) {
  console.log(`RUN ${r.id.slice(0, 8)} status=${r.status} err=${r.errorCode} name=${r.name} tokens=${r.totalTokens} usageSrc=${r.usageSource} cost=${r.cost} latency=${r.latencyMs}ms in="${(r.inputPreview || "").slice(0, 40)}" out="${(r.outputPreview || "").slice(0, 40)}"`);
  for (const s of r.spans) console.log(`  SPAN ${s.type} ${s.model}/${s.provider} status=${s.status} pt=${s.promptTokens} ct=${s.completionTokens} cost=${s.cost} events=[${s.events.map((e) => e.type).join(",")}]`);
}
await prisma.$disconnect();
