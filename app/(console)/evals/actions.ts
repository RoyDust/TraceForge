"use server";
import { AssertionType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { refreshEvalRunSummary, runEvalDataset } from "@/lib/eval-runner";
import { prisma } from "@/lib/prisma";
import { field, idField, enumField, jsonField, InputError, formError } from "@/lib/validation";

export async function createEvalDatasetAction(form: FormData) {
  await requireAdmin();
  let id: string;
  try {
    id = idField(form, "requestId");
    const data = { projectId: idField(form, "projectId"), name: field(form, "name"), description: field(form, "description", 2000, false) || null };
    const dataset = await prisma.evalDataset.upsert({ where: { id }, create: { id, ...data }, update: {} });
    if (dataset.projectId !== data.projectId || dataset.name !== data.name) throw new InputError("提交 ID 已用于其他数据集。");
  } catch (error) { return formError(error); }
  revalidatePath("/evals"); redirect("/evals/" + id);
}
export async function createEvalCaseAction(form: FormData) {
  await requireAdmin();
  let datasetId: string;
  try {
    datasetId = idField(form, "datasetId");
    const id = idField(form, "requestId");
    const data = { datasetId, input: field(form, "input", 32000), expectedOutput: field(form, "expectedOutput", 32000, false) || null, assertionType: enumField(form, "assertionType", Object.values(AssertionType)), assertionConfig: jsonField(form, "assertionConfig"), tags: field(form, "tags", 1000, false).split(",").map((t) => t.trim()).filter(Boolean) };
    const result = await prisma.evalCase.upsert({ where: { id }, create: { id, ...data }, update: {} });
    if (result.datasetId !== datasetId || result.input !== data.input) throw new InputError("提交 ID 已用于其他样本。");
  } catch (error) { return formError(error); }
  revalidatePath("/evals/" + datasetId); redirect("/evals/" + datasetId);
}
export async function runEvalDatasetAction(form: FormData) {
  await requireAdmin();
  let id: string, datasetId: string;
  try {
    datasetId = idField(form, "datasetId");
    const run = await runEvalDataset(prisma, { runId: idField(form, "requestId"), datasetId, promptVersionId: idField(form, "promptVersionId"), modelConfigId: idField(form, "modelConfigId") });
    id = run.id;
  } catch (error) { return formError(error); }
  revalidatePath("/evals/" + datasetId); redirect("/evals/runs/" + id);
}
export async function reviewEvalResultAction(form: FormData) {
  await requireAdmin();
  let evalRunId: string;
  try {
    evalRunId = idField(form, "evalRunId");
    const resultId = idField(form, "resultId");
    const pass = enumField(form, "pass", ["true", "false"]) === "true";
    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe("SELECT id FROM eval_run WHERE id = $1::uuid FOR UPDATE", evalRunId);
      const result = await tx.evalResult.findFirst({ where: { id: resultId, evalRunId }, include: { evalRun: true } });
      if (!result) throw new InputError("结果不属于此评测运行。");
      if (result.evalRun.status === "running" || !["needs_review", "passed", "failed"].includes(result.status) || result.assertionType !== "manual_review") throw new InputError("当前结果不能人工复核。");
      await tx.evalResult.update({ where: { id: resultId }, data: { pass, score: pass ? "1.000" : "0.000", status: pass ? "passed" : "failed", judgeReason: pass ? "人工复核通过。" : "人工复核未通过。" } });
      await refreshEvalRunSummary(tx, evalRunId);
    });
  } catch (error) { return formError(error); }
  revalidatePath("/evals/runs/" + evalRunId); redirect("/evals/runs/" + evalRunId);
}
