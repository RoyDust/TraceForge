import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prisma client 与 pg 驱动不打包进 server bundle, 由 Node 运行时直接 require。
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
};

export default nextConfig;
