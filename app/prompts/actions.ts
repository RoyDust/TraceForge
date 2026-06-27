"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

function required(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

export async function createPromptAction(formData: FormData) {
  await requireAdmin();
  const projectId = required(formData, "projectId");
  const name = required(formData, "name");
  const description = String(formData.get("description") ?? "").trim() || null;
  const content = required(formData, "content");

  const prompt = await prisma.prompt.create({
    data: {
      projectId,
      name,
      description,
      versions: {
        create: {
          version: 1,
          content,
          status: "published",
        },
      },
    },
    include: { versions: true },
  });
  const version = prompt.versions[0];
  await prisma.prompt.update({
    where: { id: prompt.id },
    data: { activeVersionId: version.id },
  });
  revalidatePath("/prompts");
  redirect(`/prompts/${prompt.id}`);
}

export async function createPromptVersionAction(formData: FormData) {
  await requireAdmin();
  const promptId = required(formData, "promptId");
  const content = required(formData, "content");
  const publish = String(formData.get("publish") ?? "") === "on";

  const latest = await prisma.promptVersion.findFirst({
    where: { promptId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = await prisma.promptVersion.create({
    data: {
      promptId,
      version: (latest?.version ?? 0) + 1,
      content,
      status: publish ? "published" : "draft",
    },
  });
  if (publish) {
    await prisma.prompt.update({
      where: { id: promptId },
      data: { activeVersionId: version.id },
    });
  }
  revalidatePath(`/prompts/${promptId}`);
  redirect(`/prompts/${promptId}?compare=${version.version}`);
}

export async function setActivePromptVersionAction(formData: FormData) {
  await requireAdmin();
  const promptId = required(formData, "promptId");
  const versionId = required(formData, "versionId");
  await prisma.$transaction([
    prisma.prompt.update({
      where: { id: promptId },
      data: { activeVersionId: versionId },
    }),
    prisma.promptVersion.update({
      where: { id: versionId },
      data: { status: "published" },
    }),
  ]);
  revalidatePath(`/prompts/${promptId}`);
  redirect(`/prompts/${promptId}`);
}
