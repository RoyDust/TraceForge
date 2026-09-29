"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { field, idField, InputError, formError } from "@/lib/validation";

export async function createPromptAction(form: FormData) {
  await requireAdmin();
  let promptId: string;
  try {
    promptId = idField(form, "requestId");
    const projectId = idField(form, "projectId");
    const name = field(form, "name");
    const description = field(form, "description", 2000, false) || null;
    const content = field(form, "content", 32000);
    await prisma.$transaction(async (tx) => {
      const existing = await tx.prompt.findUnique({ where: { id: promptId }, include: { versions: true } });
      if (existing) {
        if (existing.projectId !== projectId || existing.name !== name || existing.versions[0]?.content !== content) throw new InputError("提交 ID 已用于其他提示词。");
        return;
      }
      if (!await tx.project.findUnique({ where: { id: projectId } })) throw new InputError("项目不存在。");
      const prompt = await tx.prompt.create({ data: { id: promptId, projectId, name, description, versions: { create: { version: 1, content, status: "published" } } }, include: { versions: true } });
      await tx.prompt.update({ where: { id: promptId }, data: { activeVersionId: prompt.versions[0].id } });
    });
  } catch (error) { return formError(error); }
  revalidatePath("/prompts");
  redirect("/prompts/" + promptId);
}

export async function createPromptVersionAction(form: FormData) {
  await requireAdmin();
  let promptId: string, versionNumber: number;
  try {
    promptId = idField(form, "promptId");
    const id = idField(form, "requestId");
    const content = field(form, "content", 32000);
    const publish = form.get("publish") === "on";
    versionNumber = await prisma.$transaction(async (tx) => {
      // Parameterized SQL locks the parent while allocating its version number.
      const parent = await tx.$queryRawUnsafe<Array<{ id: string }>>("SELECT id FROM prompt WHERE id = $1::uuid FOR UPDATE", promptId);
      if (!parent.length) throw new InputError("提示词不存在。");
      const existing = await tx.promptVersion.findUnique({ where: { id } });
      if (existing) {
        if (existing.promptId !== promptId || existing.content !== content) throw new InputError("提交 ID 已用于其他版本。");
        return existing.version;
      }
      const latest = await tx.promptVersion.findFirst({ where: { promptId }, orderBy: { version: "desc" }, select: { version: true } });
      const version = await tx.promptVersion.create({ data: { id, promptId, version: (latest?.version ?? 0) + 1, content, status: publish ? "published" : "draft" } });
      if (publish) await tx.prompt.update({ where: { id: promptId }, data: { activeVersionId: id } });
      return version.version;
    });
  } catch (error) { return formError(error); }
  revalidatePath("/prompts/" + promptId);
  redirect("/prompts/" + promptId + "?compare=" + versionNumber);
}

export async function setActivePromptVersionAction(form: FormData) {
  await requireAdmin();
  let promptId: string;
  try {
    promptId = idField(form, "promptId");
    const versionId = idField(form, "versionId");
    await prisma.$transaction(async (tx) => {
      const version = await tx.promptVersion.findFirst({ where: { id: versionId, promptId } });
      if (!version) throw new InputError("所选版本不属于此提示词。");
      await tx.promptVersion.update({ where: { id: versionId }, data: { status: "published" } });
      await tx.prompt.update({ where: { id: promptId }, data: { activeVersionId: versionId } });
    });
  } catch (error) { return formError(error); }
  revalidatePath("/prompts/" + promptId);
  redirect("/prompts/" + promptId);
}
