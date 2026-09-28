import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.TRACEFORGE_E2E_DIST_DIR ?? ".next",
  // Prisma client 与 pg 驱动不打包进 server bundle, 由 Node 运行时直接 require。
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
};

export default nextConfig;
