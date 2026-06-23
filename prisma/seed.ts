// 示例数据 — 可重复执行 (upsert + 固定 UUID)。由 `npm run db:seed` 触发 (见 prisma.config.ts)。
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// 运行时 driver adapter 不解析连接串里的 ?schema=, 需显式传 schema (与 Prisma CLI 口径一致)
const schema = new URL(process.env.DATABASE_URL!).searchParams.get("schema") ?? undefined;
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! }, schema ? { schema } : undefined);
const prisma = new PrismaClient({ adapter });

// 固定 ID 让 seed 幂等
const ID = {
  project: "00000000-0000-0000-0000-000000000001",
  provider: "00000000-0000-0000-0000-000000000002",
  model: "00000000-0000-0000-0000-000000000003",
  prompt: "00000000-0000-0000-0000-000000000004",
  run: "00000000-0000-0000-0000-000000000010",
  span: "00000000-0000-0000-0000-000000000011",
};

async function main() {
  const project = await prisma.project.upsert({
    where: { id: ID.project },
    update: {},
    create: { id: ID.project, name: "Demo Project", description: "TraceForge 示例项目" },
  });

  await prisma.apiKey.upsert({
    where: { keyHash: "demo-key-hash" },
    update: {},
    create: {
      projectId: project.id,
      scope: ["gateway", "trace_ingest"],
      keyHash: "demo-key-hash", // 实际存 API Key 的哈希
      name: "demo key",
      rpmLimit: 60,
      concurrencyLimit: 10,
    },
  });

  const provider = await prisma.modelProvider.upsert({
    where: { id: ID.provider },
    update: {},
    create: { id: ID.provider, name: "OpenAI", baseUrl: "https://api.openai.com/v1", type: "openai" },
    // apiKeyEncrypted 运行时注入, 不进 seed
  });

  await prisma.modelConfig.upsert({
    where: { id: ID.model },
    update: {},
    create: {
      id: ID.model,
      providerId: provider.id,
      modelName: "gpt-4o-mini",
      displayName: "GPT-4o mini",
      maxTokens: 16384,
    },
  });

  await prisma.modelPricing.upsert({
    where: {
      provider_model_effectiveFrom: {
        provider: "openai",
        model: "gpt-4o-mini",
        effectiveFrom: new Date("2025-01-01T00:00:00Z"),
      },
    },
    update: {},
    create: {
      provider: "openai",
      model: "gpt-4o-mini",
      inputPrice: "0.00000015", // 每 token 单价 (示例)
      outputPrice: "0.00000060",
      effectiveFrom: new Date("2025-01-01T00:00:00Z"),
    },
  });

  const prompt = await prisma.prompt.upsert({
    where: { id: ID.prompt },
    update: {},
    create: { id: ID.prompt, projectId: project.id, name: "writer-system" },
  });
  const version = await prisma.promptVersion.upsert({
    where: { promptId_version: { promptId: prompt.id, version: 1 } },
    update: {},
    create: { promptId: prompt.id, version: 1, content: "You are a helpful writing assistant.", status: "published" },
  });
  await prisma.prompt.update({ where: { id: prompt.id }, data: { activeVersionId: version.id } });

  // 一条示例 Trace, 让 Console 起来即有内容 (实际由网关写)
  await prisma.traceRun.upsert({
    where: { id: ID.run },
    update: {},
    create: {
      id: ID.run,
      projectId: project.id,
      name: "demo chat",
      status: "success",
      promptVersionId: version.id,
      totalTokens: 42,
      cost: "0.0000200",
      latencyMs: 850,
      usageSource: "provider",
      endedAt: new Date(),
      spans: {
        create: [
          {
            id: ID.span,
            type: "llm",
            name: "chat.completions",
            model: "gpt-4o-mini",
            provider: "openai",
            promptTokens: 30,
            completionTokens: 12,
            usageSource: "provider",
            cost: "0.0000200",
            latencyMs: 800,
            status: "success",
            endedAt: new Date(),
            events: { create: [{ type: "first_token", payload: { ms: 120 } }] },
          },
        ],
      },
    },
  });

  console.log("✅ seed 完成: project / api key / provider / model / pricing / prompt v1 / 1 trace");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
