"use server";

import { AssertionType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { refreshEvalRunSummary, runEvalDataset } from "@/lib/eval-runner";
import { prisma } from "@/lib/prisma";

function required(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function optional(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

function jsonValue(formData: FormData, key: string) {
  const value = optional(formData, key);
  if (!value) return undefined;
  return JSON.parse(value);
}

function tags(formData: FormData) {
  return String(formData.get("tags") ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export async function createEvalDatasetAction(formData: FormData) {
  await requireAdmin();
  const projectId = required(formData, "projectId");
  const name = required(formData, "name");
  const description = optional(formData, "description");
  const dataset = await prisma.evalDataset.create({ data: { projectId, name, description } });
  revalidatePath("/evals");
  redirect(`/evals/${dataset.id}`);
}

export async function createEvalCaseAction(formData: FormData) {
  await requireAdmin();
  const datasetId = required(formData, "datasetId");
  const assertionType = required(formData, "assertionType") as AssertionType;
  if (!Object.values(AssertionType).includes(assertionType)) throw new Error("assertionType is invalid");

  await prisma.evalCase.create({
    data: {
      datasetId,
      input: required(formData, "input"),
      expectedOutput: optional(formData, "expectedOutput"),
      assertionType,
      assertionConfig: jsonValue(formData, "assertionConfig"),
      tags: tags(formData),
    },
  });
  revalidatePath(`/evals/${datasetId}`);
  redirect(`/evals/${datasetId}`);
}

export async function runEvalDatasetAction(formData: FormData) {
  await requireAdmin();
  const datasetId = required(formData, "datasetId");
  const promptVersionId = required(formData, "promptVersionId");
  const modelConfigId = required(formData, "modelConfigId");
  const run = await runEvalDataset(prisma, { datasetId, promptVersionId, modelConfigId });
  revalidatePath(`/evals/${datasetId}`);
  redirect(`/evals/runs/${run.id}`);
}

export async function reviewEvalResultAction(formData: FormData) {
  await requireAdmin();
  const resultId = required(formData, "resultId");
  const evalRunId = required(formData, "evalRunId");
  const pass = required(formData, "pass") === "true";
  await prisma.evalResult.update({
    where: { id: resultId },
    data: {
      pass,
      score: pass ? "1.000" : "0.000",
      status: pass ? "passed" : "failed",
      judgeReason: pass ? "人工复核通过。" : "人工复核未通过。",
    },
  });
  await refreshEvalRunSummary(prisma, evalRunId);
  revalidatePath(`/evals/runs/${evalRunId}`);
  redirect(`/evals/runs/${evalRunId}`);
}
