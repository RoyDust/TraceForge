import "server-only";
import { cache } from "react";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Every page obtains its database handle only after request-scoped authentication.
export async function getConsoleDb() {
  await requireAdmin();
  return prisma;
}

export const getProjects = cache(async () => {
  const db = await getConsoleDb();
  return db.project.findMany({ orderBy: { createdAt: "asc" } });
});
