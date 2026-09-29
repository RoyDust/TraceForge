// 配置 DeepSeek provider/model 并加密灌入其 API key (决策 10、11)。
// 运行: npx tsx scripts/seed-deepseek.ts
// 读 env: DATABASE_URL / MASTER_ENCRYPTION_KEY(base64 32B) / DEEPSEEK_API_KEY(明文)。
// 可选: DEEPSEEK_BASE_URL / DEEPSEEK_MODEL，用于 OpenAI-compatible 中转。
// 加密格式: base64( nonce(12B) ‖ ciphertext ‖ tag(16B) )，与 Rust 数据面解密对齐。
import "dotenv/config";
import { randomBytes, createCipheriv } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const ID = {
  provider: "00000000-0000-0000-0000-000000000020",
  model: "00000000-0000-0000-0000-000000000021",
};

// AES-256-GCM 加密 (控制面写侧)。明文 key 永不入库/日志，只存密文。
function encrypt(plaintext: string, masterKeyB64: string): string {
  const key = Buffer.from(masterKeyB64, "base64");
  if (key.length !== 32) throw new Error(`MASTER_ENCRYPTION_KEY 应为 32 字节, 实际 ${key.length}`);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ct, tag]).toString("base64");
}

async function main() {
  const masterKey = process.env.MASTER_ENCRYPTION_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!masterKey) throw new Error("缺 MASTER_ENCRYPTION_KEY");
  if (!deepseekKey) throw new Error("缺 DEEPSEEK_API_KEY");
  const baseUrl = new URL(process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com/v1");
  if (!["http:", "https:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error("DEEPSEEK_BASE_URL 必须为无凭据的 HTTP(S) 地址。");
  }
  const modelName = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
  if (modelName.length > 200) throw new Error("DEEPSEEK_MODEL 不能超过 200 字符。");

  const schema = new URL(process.env.DATABASE_URL!).searchParams.get("schema") ?? undefined;
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! }, schema ? { schema } : undefined);
  const prisma = new PrismaClient({ adapter });

  const apiKeyEncrypted = encrypt(deepseekKey, masterKey);
  const providerData = {
    name: "DeepSeek",
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    type: "openai_compatible",
    status: "active",
    apiKeyEncrypted,
  };
  const modelData = {
    providerId: ID.provider,
    modelName,
    displayName: modelName,
    maxTokens: modelName === "deepseek-chat" ? 8192 : null,
    status: "active",
  };

  await prisma.$transaction([prisma.modelProvider.upsert({
    where: { id: ID.provider },
    update: providerData, // 重跑同步地址与密钥，并使用新 nonce 重新加密
    create: { id: ID.provider, ...providerData },
  }), prisma.modelConfig.upsert({
    where: { id: ID.model },
    update: modelData,
    create: { id: ID.model, ...modelData },
  })]);

  await prisma.$disconnect();
  console.log("✅ DeepSeek provider/model 已配置, API key 已加密入库 (" + modelName + ")");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
