import "server-only";
// Prisma client 单例 (driver adapter)。复用 seed.ts 的口径:
// 运行时适配器不解析连接串里的 ?schema=, 需显式传 schema。dev 下用 global 避免热重载耗尽连接。
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL!;
const schema = connectionString
  ? new URL(connectionString).searchParams.get("schema") ?? undefined
  : undefined;

if (schema && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error("DATABASE_URL schema 无效。");

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString, options: "-c search_path=" + (schema ?? "public") }, schema ? { schema } : undefined),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
