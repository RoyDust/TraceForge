import type { Prisma } from "@prisma/client";
import { mockEnvironment, mockFreshness, mockLiveIngest } from "@/lib/ui-mocks";

type ProjectLike = Prisma.ProjectGetPayload<Record<string, never>>;

export function consoleChromeViewModel(projects: ProjectLike[]) {
  const seed = projects.map((project) => project.id).join(":") || "traceforge";

  return {
    projectOptions: projects.map((project) => ({
      id: project.id,
      name: project.name,
    })),
    liveIngest: mockLiveIngest(seed),
    freshness: mockFreshness(seed),
    environment: mockEnvironment(),
  };
}
