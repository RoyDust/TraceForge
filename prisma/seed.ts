// Explicit, idempotent demo fixtures. Runtime pages never generate demonstration facts.
import "dotenv/config";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { demoMode } from "../lib/env";

export const DEMO = {
  project: "00000000-0000-0000-0000-000000000001",
  provider: "00000000-0000-0000-0000-000000000030",
  model: "00000000-0000-0000-0000-000000000031",
  prompt: "00000000-0000-0000-0000-000000000501",
  version: "00000000-0000-0000-0000-000000000502",
  dataset: "00000000-0000-0000-0000-000000000601",
};

export async function seedDemo(db: PrismaClient) {
  const master = process.env.MASTER_ENCRYPTION_KEY?.trim();
  if (!master || Buffer.from(master, "base64").length !== 32) throw new Error("演示 seed 需要有效的 32 字节 base64 MASTER_ENCRYPTION_KEY。");
  const upstream = new URL(process.env.TRACEFORGE_DEMO_UPSTREAM_URL ?? "http://localhost:8799/v1");
  if (!["http:", "https:"].includes(upstream.protocol)) throw new Error("演示上游必须为 HTTP(S) 地址。");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(master, "base64"), nonce);
  const encrypted = Buffer.concat([nonce, cipher.update("mock-upstream-key"), cipher.final(), cipher.getAuthTag()]).toString("base64");
  await db.$transaction(async (tx) => {
    await tx.project.upsert({ where: { id: DEMO.project }, update: {}, create: { id: DEMO.project, name: "Demo Project", description: "显式演示数据，可通过固定 ID 重复生成。" } });
    await tx.modelProvider.upsert({ where: { id: DEMO.provider }, update: { baseUrl: upstream.toString(), apiKeyEncrypted: encrypted }, create: { id: DEMO.provider, name: "mock", baseUrl: upstream.toString(), apiKeyEncrypted: encrypted, type: "openai_compatible" } });
    for (const [i, modelName] of ["mock-ok", "mock-fail", "mock-mid", "mock-timeout"].entries()) {
      const id = "00000000-0000-0000-0000-" + String(31+i).padStart(12,"0");
      await tx.modelConfig.upsert({ where: { id }, update: {}, create: { id, providerId: DEMO.provider, modelName, displayName: modelName } });
      await tx.modelPricing.upsert({ where: { provider_model_effectiveFrom: { provider: "mock", model: modelName, effectiveFrom: new Date("2025-01-01T00:00:00Z") } }, update: {}, create: { provider: "mock", model: modelName, effectiveFrom: new Date("2025-01-01T00:00:00Z"), inputPrice: "0.000001", outputPrice: "0.000002" } });
    }
    const keys = new Set([process.env.TRACEFORGE_CHAT_API_KEY, process.env.TRACEFORGE_EVAL_API_KEY].filter((k): k is string => Boolean(k?.trim())));
    for (const key of keys) {
      const keyHash = createHash("sha256").update(key).digest("hex");
      await tx.apiKey.upsert({ where: { keyHash }, update: {}, create: { projectId: DEMO.project, name: "explicit demo gateway key", keyHash, scope: ["gateway", "trace_ingest"], rpmLimit: 600, concurrencyLimit: 10 } });
    }
    await tx.prompt.upsert({ where: { id: DEMO.prompt }, update: {}, create: { id: DEMO.prompt, projectId: DEMO.project, name: "demo-support-agent" } });
    await tx.promptVersion.upsert({ where: { id: DEMO.version }, update: {}, create: { id: DEMO.version, promptId: DEMO.prompt, version: 1, content: "You are a concise assistant.", status: "published" } });
    await tx.promptVersion.upsert({ where: { id: "00000000-0000-0000-0000-000000000503" }, update: {}, create: { id: "00000000-0000-0000-0000-000000000503", promptId: DEMO.prompt, version: 2, content: "Answer with operational details.", status: "draft" } });
    await tx.prompt.update({ where: { id: DEMO.prompt }, data: { activeVersionId: DEMO.version } });
    await tx.evalDataset.upsert({ where: { id: DEMO.dataset }, update: {}, create: { id: DEMO.dataset, projectId: DEMO.project, name: "Demo smoke dataset" } });
    await tx.evalCase.upsert({ where: { id: "00000000-0000-0000-0000-000000000602" }, update: {}, create: { id: "00000000-0000-0000-0000-000000000602", datasetId: DEMO.dataset, input: "Say hello.", expectedOutput: "hello from mock", assertionType: "exact_match", tags: ["demo"] } });
    for (let i = 0; i < 24; i++) {
      const id = "00000000-0000-0000-0000-" + String(800+i).padStart(12,"0");
      const startedAt = new Date(Date.now() - (24-i) * 3_600_000);
      const failed = i % 5 === 0;
      await tx.traceRun.upsert({ where: { id }, update: {}, create: {
        id, projectId: DEMO.project, promptVersionId: DEMO.version, name: "demo-run-" + i, status: failed ? "failed" : "success", errorCode: failed ? i === 0 ? "stream_interrupted" : "rate_limited" : null,
        startedAt, endedAt: new Date(startedAt.getTime() + (i+1)*100), latencyMs: (i+1)*100, totalTokens: 17, cost: "0.000022", usageSource: "provider",
        inputPreview: "示例输入", outputPreview: failed ? null : "hello from mock",
        spans: { create: [{ type: "llm", name: "mock chat", model: "mock-ok", provider: "mock", startedAt, endedAt: new Date(startedAt.getTime()+100), status: failed ? "failed" : "success", errorCode: failed ? i === 0 ? "stream_interrupted" : "rate_limited" : null, promptTokens: 10, completionTokens: 5, cost: "0.000020", latencyMs: 100, usageSource: "provider", events: { create: i === 0 ? [{ type: "fallback_triggered", payload: { from_model: "mock-fail", to_model: "mock-ok" } }, { type: "stream_error", payload: { error_code: "stream_interrupted" } }] : [] } }, { type: "tool", name: "lookup", startedAt, status: "success", promptTokens: 2, completionTokens: 0, cost: "0.000002", latencyMs: 20 }] },
      } });
    }
  }, { timeout: 30000 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!demoMode()) throw new Error("演示 seed 仅允许在显式 DEMO_MODE=true 时运行。");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("缺少 DATABASE_URL。");
  const schema = new URL(connectionString).searchParams.get("schema") ?? "public";
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });
  try { await seedDemo(db); console.log("Persisted demo fixtures ready; no real provider calls made."); }
  finally { await db.$disconnect(); }
}
