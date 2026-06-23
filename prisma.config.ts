// Prisma 7 配置：连接 URL 从 schema 的 datasource 块移到这里（v7 破坏性变更）。
//
// 注意事项：
// - 一旦存在 prisma.config.ts，Prisma 不再自动加载 .env，需显式 import "dotenv/config"
//   （dotenv 作为 devDependency 安装）。
// - 运行时 PrismaClient 需传 driver adapter，postgres 用 @prisma/adapter-pg：
//     import { PrismaPg } from "@prisma/adapter-pg";
//     const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
//     export const prisma = new PrismaClient({ adapter });
//   （以上 client 用法以 @prisma/adapter-pg 当前版本文档为准。）
// - 已用 prisma@7.8.0 `prisma validate` 验证本配置可正确加载。
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
