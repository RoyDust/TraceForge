// Stage 6 demo: deterministic EvalDataset, EvalCase, EvalRun, EvalResult, and compare URLs.
import "dotenv/config";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const PROMPT_ID = "00000000-0000-0000-0000-000000000501";
const DATASET_ID = "00000000-0000-0000-0000-000000000601";
const RUN_BASE_ID = "00000000-0000-0000-0000-000000000620";
const RUN_COMPARE_ID = "00000000-0000-0000-0000-000000000621";
const MODEL_ID = "00000000-0000-0000-0000-000000000031";
const API_KEY_ID = "00000000-0000-0000-0000-000000000622";
const CONSOLE_URL = process.env.STAGE6_CONSOLE_URL ?? "http://localhost:3000";

const CASES = [
  {
    id: "00000000-0000-0000-0000-000000000602",
    input: "Return the mock greeting exactly.",
    expectedOutput: "hello from mock",
    assertionType: "exact_match",
    assertionConfig: null,
    tags: ["smoke", "exact"],
    base: ["hello from mock", true, "1.000", "输出与 expected_output 完全一致。"],
    compare: ["hello from mock", true, "1.000", "输出与 expected_output 完全一致。"],
  },
  {
    id: "00000000-0000-0000-0000-000000000603",
    input: "Explain why PromptVersion links matter.",
    expectedOutput: "TraceRun",
    assertionType: "contains",
    assertionConfig: { contains: ["TraceRun", "PromptVersion"] },
    tags: ["traceability"],
    base: ["TraceRun links PromptVersion for runtime evidence.", true, "1.000", "输出包含全部必需片段。"],
    compare: ["TraceRun links PromptVersion and EvalRun evidence.", true, "1.000", "输出包含全部必需片段。"],
  },
  {
    id: "00000000-0000-0000-0000-000000000604",
    input: "Include a version token.",
    expectedOutput: "PromptVersion\\s+v\\d+",
    assertionType: "regex",
    assertionConfig: { pattern: "PromptVersion\\s+v\\d+" },
    tags: ["format"],
    base: ["PromptVersion v2 ready", true, "1.000", "输出匹配正则。"],
    compare: ["PromptVersion ready", false, "0.000", "输出未匹配正则。"],
  },
  {
    id: "00000000-0000-0000-0000-000000000605",
    input: "Return JSON with answer and confidence.",
    expectedOutput: null,
    assertionType: "json_schema",
    assertionConfig: {
      required: ["answer", "confidence"],
      properties: { answer: { type: "string" }, confidence: { type: "number" } },
    },
    tags: ["json"],
    base: ['{"answer":"ok"}', false, "0.000", "缺少必填字段 confidence。"],
    compare: ['{"answer":"ok","confidence":0.92}', true, "1.000", "JSON 输出满足 required/properties 类型约束。"],
  },
  {
    id: "00000000-0000-0000-0000-000000000606",
    input: "Judge the operational answer.",
    expectedOutput: "safe verification",
    assertionType: "llm_judge",
    assertionConfig: { pass_keywords: ["safe", "verification"], threshold: 0.5 },
    tags: ["judge"],
    base: ["safe verification steps included", true, "1.000", "本地 judge 命中 2/2 个通过关键词。"],
    compare: ["safe verification steps included", true, "1.000", "本地 judge 命中 2/2 个通过关键词。"],
  },
  {
    id: "00000000-0000-0000-0000-000000000607",
    input: "Needs human product review.",
    expectedOutput: null,
    assertionType: "manual_review",
    assertionConfig: { rubric: "Does the answer match launch tone?" },
    tags: ["human"],
    base: ["Manual review sample for v2.", null, null, "等待人工复核。"],
    compare: ["Manual review sample for v3.", null, null, "等待人工复核。"],
  },
];

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function average(results) {
  const scores = results.flatMap((item) => (item[2] === null ? [] : [Number(item[2])]));
  return scores.length ? (scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(3) : null;
}

function passRate(results) {
  return results.filter((item) => item[1] === true).length / results.length;
}

async function upsertResult(prisma, runId, evalCase, tuple) {
  const [output, pass, score, judgeReason] = tuple;
  await prisma.evalResult.upsert({
    where: { evalRunId_evalCaseId: { evalRunId: runId, evalCaseId: evalCase.id } },
    update: {
      output,
      assertionType: evalCase.assertionType,
      pass,
      score,
      judgeReason,
      cost: "0",
      durationMs: 1,
      status: pass === null ? "needs_review" : pass ? "passed" : "failed",
    },
    create: {
      evalRunId: runId,
      evalCaseId: evalCase.id,
      output,
      assertionType: evalCase.assertionType,
      pass,
      score,
      judgeReason,
      cost: "0",
      durationMs: 1,
      status: pass === null ? "needs_review" : pass ? "passed" : "failed",
    },
  });
}

async function upsertRun(prisma, id, datasetId, promptVersionId, tuples) {
  await prisma.evalRun.upsert({
    where: { id },
    update: {
      datasetId,
      promptVersionId,
      modelConfigId: MODEL_ID,
      status: "needs_review",
      averageScore: average(tuples),
      totalCost: "0",
      durationMs: tuples.length,
    },
    create: {
      id,
      datasetId,
      promptVersionId,
      modelConfigId: MODEL_ID,
      status: "needs_review",
      averageScore: average(tuples),
      totalCost: "0",
      durationMs: tuples.length,
    },
  });
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("缺 DATABASE_URL");
  console.log("== Stage 6 demo ==");
  run("node", ["scripts/stage5-demo.mjs"]);
  run("npx", ["tsx", "scripts/seed-mock.ts"]);

  const schema = new URL(process.env.DATABASE_URL).searchParams.get("schema") ?? undefined;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }, schema ? { schema } : undefined),
  });

  const prompt = await prisma.prompt.findUnique({
    where: { id: PROMPT_ID },
    include: { versions: true },
  });
  if (!prompt) throw new Error("Stage 5 prompt 不存在。");
  const v2 = prompt.versions.find((version) => version.version === 2);
  const v3 = prompt.versions.find((version) => version.version === 3);
  if (!v2 || !v3) throw new Error("Stage 5 prompt 需要 v2 和 v3。");

  await prisma.apiKey.upsert({
    where: { id: API_KEY_ID },
    update: {
      projectId: PROJECT_ID,
      name: "stage6 eval gateway key",
      keyHash: sha256("tf-stage6-eval-key"),
      scope: ["gateway"],
      status: "active",
      rpmLimit: 120,
      concurrencyLimit: 4,
      revokedAt: null,
    },
    create: {
      id: API_KEY_ID,
      projectId: PROJECT_ID,
      name: "stage6 eval gateway key",
      keyHash: sha256("tf-stage6-eval-key"),
      scope: ["gateway"],
      status: "active",
      rpmLimit: 120,
      concurrencyLimit: 4,
    },
  });

  await prisma.evalDataset.upsert({
    where: { id: DATASET_ID },
    update: {
      projectId: PROJECT_ID,
      name: "stage6-support-regression",
      description: "Covers exact, contains, regex, json_schema, llm_judge, and manual_review.",
    },
    create: {
      id: DATASET_ID,
      projectId: PROJECT_ID,
      name: "stage6-support-regression",
      description: "Covers exact, contains, regex, json_schema, llm_judge, and manual_review.",
    },
  });

  for (const evalCase of CASES) {
    await prisma.evalCase.upsert({
      where: { id: evalCase.id },
      update: {
        datasetId: DATASET_ID,
        input: evalCase.input,
        expectedOutput: evalCase.expectedOutput,
        assertionType: evalCase.assertionType,
        assertionConfig: evalCase.assertionConfig,
        tags: evalCase.tags,
      },
      create: {
        id: evalCase.id,
        datasetId: DATASET_ID,
        input: evalCase.input,
        expectedOutput: evalCase.expectedOutput,
        assertionType: evalCase.assertionType,
        assertionConfig: evalCase.assertionConfig,
        tags: evalCase.tags,
      },
    });
  }

  const baseTuples = CASES.map((evalCase) => evalCase.base);
  const compareTuples = CASES.map((evalCase) => evalCase.compare);
  await upsertRun(prisma, RUN_BASE_ID, DATASET_ID, v2.id, baseTuples);
  await upsertRun(prisma, RUN_COMPARE_ID, DATASET_ID, v3.id, compareTuples);
  for (const evalCase of CASES) {
    await upsertResult(prisma, RUN_BASE_ID, evalCase, evalCase.base);
    await upsertResult(prisma, RUN_COMPARE_ID, evalCase, evalCase.compare);
  }

  console.log("Stage 6 demo data ready");
  console.log(`Dataset:      ${CONSOLE_URL}/evals/${DATASET_ID}`);
  console.log(`Base run:     ${CONSOLE_URL}/evals/runs/${RUN_BASE_ID} (${(passRate(baseTuples) * 100).toFixed(1)}%)`);
  console.log(`Compare run:  ${CONSOLE_URL}/evals/runs/${RUN_COMPARE_ID} (${(passRate(compareTuples) * 100).toFixed(1)}%)`);
  console.log(`Regression:   ${CONSOLE_URL}/evals/compare?baseRun=${RUN_BASE_ID}&compareRun=${RUN_COMPARE_ID}`);
  console.log(`Prompt link:  ${CONSOLE_URL}/prompts/${PROMPT_ID}?compare=3`);
  console.log("");
  console.log("Expected evidence:");
  console.log("- Eval list shows stage6-support-regression.");
  console.log("- Dataset detail shows six assertion types and two EvalRuns.");
  console.log("- Run detail shows pass rate, failed samples, needs_review, and judge_reason.");
  console.log("- Compare page shows one regression and one improvement.");
  console.log("- Prompt detail shows linked EvalRuns.");

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
