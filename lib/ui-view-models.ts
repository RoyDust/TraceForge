import type { Prisma } from "@prisma/client";
export function consoleChromeViewModel(projects: Prisma.ProjectGetPayload<Record<string, never>>[]) {
  return { projectOptions: projects.map(({ id, name }) => ({ id, name })),
    liveIngest: { value: "未配置采集速率", source: "unavailable" },
    freshness: { value: "request" }, environment: { value: "Console", source: "config" } };
}
