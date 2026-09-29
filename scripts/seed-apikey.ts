// 建网关鉴权测试用的 API Key (S4)。key_hash = sha256(明文) hex, 网关按此查找。
// 运行: npx tsx scripts/seed-apikey.ts  —— 明文仅打印一次, 不入库。
import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const PROJECT = "00000000-0000-0000-0000-000000000001"; // seed 的 Demo Project
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// 明文 -> 固定, 方便测试; 真实环境明文只在创建时返回一次。
const KEYS = {
  valid: "tf-valid-key",
  revoked: "tf-revoked-key",
  traceonly: "tf-traceonly-key",
};
const ID = {
  valid: "00000000-0000-0000-0000-000000000040",
  revoked: "00000000-0000-0000-0000-000000000041",
  traceonly: "00000000-0000-0000-0000-000000000042",
};

async function main() {
  const schema = new URL(process.env.DATABASE_URL!).searchParams.get("schema") ?? undefined;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }, schema ? { schema } : undefined),
  });

  // Production setup uses explicit keys and never prints plaintext credentials.
  const projectId = process.env.TRACEFORGE_PROJECT_ID;
  if (projectId) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(projectId)) throw new Error("TRACEFORGE_PROJECT_ID 必须为 UUID");
    const name = process.env.TRACEFORGE_PROJECT_NAME?.trim();
    const keys = [process.env.TRACEFORGE_CHAT_API_KEY?.trim(), process.env.TRACEFORGE_EVAL_API_KEY?.trim()];
    if (!name || keys.some((key) => !key || key.length < 24 || key.includes("CHANGE_ME") || Object.values(KEYS).includes(key))) throw new Error("生产初始化需要项目名称和至少 24 字符的自有 Chat/Eval 项目 Key");
    await prisma.$transaction(async (tx) => {
      await tx.project.upsert({ where: { id: projectId }, update: {}, create: { id: projectId, name } });
      for (const key of new Set(keys)) {
        const keyHash = sha256(key!);
        const existing = await tx.apiKey.findUnique({ where: { keyHash } });
        if (existing && (existing.projectId !== projectId || existing.status !== "active" || existing.revokedAt || (existing.expiresAt && existing.expiresAt <= new Date()) || !existing.scope.includes("gateway") || !existing.scope.includes("trace_ingest"))) throw new Error("项目 Key 已存在但归属、状态或权限不匹配；不会覆盖或重新激活");
        if (!existing) await tx.apiKey.create({ data: { projectId, name: "Console and Agent", keyHash, scope: ["gateway", "trace_ingest"] } });
      }
    });
    await prisma.$disconnect();
    console.log("Production project and hashed API keys are ready; no plaintext keys printed.");
    return;
  }
  if (process.env.DEMO_MODE !== "true") throw new Error("固定测试 Key 仅允许 DEMO_MODE=true；生产请设置 TRACEFORGE_PROJECT_ID/NAME 与自有 Key");

  await prisma.apiKey.upsert({
    where: { id: ID.valid },
    update: {},
    create: {
      id: ID.valid, projectId: PROJECT, name: "gateway valid (test)",
      keyHash: sha256(KEYS.valid), scope: ["gateway"], status: "active",
      rpmLimit: 5, concurrencyLimit: 2, // 小额度便于 S5 限流测试
    },
  });
  await prisma.apiKey.upsert({
    where: { id: ID.revoked },
    update: {},
    create: {
      id: ID.revoked, projectId: PROJECT, name: "gateway revoked (test)",
      keyHash: sha256(KEYS.revoked), scope: ["gateway"], status: "revoked", revokedAt: new Date(),
    },
  });
  await prisma.apiKey.upsert({
    where: { id: ID.traceonly },
    update: {},
    create: {
      id: ID.traceonly, projectId: PROJECT, name: "trace-only (test)",
      keyHash: sha256(KEYS.traceonly), scope: ["trace_ingest"], status: "active",
    },
  });

  await prisma.$disconnect();
  console.log("✅ 测试 key 已建 (明文, 仅此处可见):");
  console.log(`   valid     (gateway, rpm=5, conc=2): ${KEYS.valid}`);
  console.log(`   revoked   (已撤销):                  ${KEYS.revoked}`);
  console.log(`   traceonly (无 gateway 权限):          ${KEYS.traceonly}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
