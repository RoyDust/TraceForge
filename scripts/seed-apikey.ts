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
