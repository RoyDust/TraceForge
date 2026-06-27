// 配置 mock 上游的 provider/model，供 S3(取消)/S6(fallback) 做确定性验证。
// 运行: npx tsx scripts/seed-mock.ts  (需 MASTER_ENCRYPTION_KEY)
// mock 按 model 名推断行为: 含 slow→慢速流, fail→首chunk前500, mid→首chunk后中断。
import "dotenv/config";
import { randomBytes, createCipheriv } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const ID = {
  provider: "00000000-0000-0000-0000-000000000030",
  ok: "00000000-0000-0000-0000-000000000031",
  slow: "00000000-0000-0000-0000-000000000032",
  fail: "00000000-0000-0000-0000-000000000033",
  mid: "00000000-0000-0000-0000-000000000034",
  failAlone: "00000000-0000-0000-0000-000000000035",
};

// 与 Rust 解密对齐: base64( nonce(12) ‖ ct ‖ tag(16) )。
function encrypt(plaintext: string, masterKeyB64: string): string {
  const key = Buffer.from(masterKeyB64, "base64");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, ct, cipher.getAuthTag()]).toString("base64");
}

async function main() {
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  if (!masterKey) throw new Error("缺 MASTER_ENCRYPTION_KEY");
  const schema = new URL(process.env.DATABASE_URL!).searchParams.get("schema") ?? undefined;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }, schema ? { schema } : undefined),
  });

  await prisma.modelProvider.upsert({
    where: { id: ID.provider },
    update: { apiKeyEncrypted: encrypt("mock-key", masterKey) },
    create: {
      id: ID.provider,
      name: "Mock Upstream",
      baseUrl: "http://localhost:8799/v1",
      type: "openai_compatible",
      apiKeyEncrypted: encrypt("mock-key", masterKey),
    },
  });

  const model = (id: string, modelName: string, fallbackModelId?: string) =>
    prisma.modelConfig.upsert({
      where: { id },
      update: { fallbackModelId: fallbackModelId ?? null },
      create: { id, providerId: ID.provider, modelName, fallbackModelId: fallbackModelId ?? null },
    });

  await model(ID.ok, "mock-ok");
  await model(ID.slow, "mock-slow");
  await model(ID.fail, "mock-fail", ID.ok); // 首 chunk 前失败 → fallback 到 mock-ok
  await model(ID.mid, "mock-mid", ID.ok); // 首 chunk 后中断 → 不 fallback
  await model(ID.failAlone, "mock-fail-alone"); // 首 chunk 前失败且不 fallback → 模型责任域样例

  const effectiveFrom = new Date("2026-01-01T00:00:00Z");
  for (const modelName of ["mock-ok", "mock-slow", "mock-fail", "mock-mid", "mock-fail-alone"]) {
    await prisma.modelPricing.upsert({
      where: {
        provider_model_effectiveFrom: {
          provider: "Mock Upstream",
          model: modelName,
          effectiveFrom,
        },
      },
      update: {},
      create: {
        provider: "Mock Upstream",
        model: modelName,
        inputPrice: "0.00000100",
        outputPrice: "0.00000200",
        effectiveFrom,
      },
    });
  }

  await prisma.$disconnect();
  console.log("✅ mock provider/model/pricing 已配置: mock-ok / mock-slow / mock-fail(→ok) / mock-mid(→ok) / mock-fail-alone");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
