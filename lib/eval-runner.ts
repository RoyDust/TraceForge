import type { AssertionType, Prisma, PrismaClient } from "@prisma/client";

type EvalCaseLike = {
  id: string;
  input: string;
  expectedOutput: string | null;
  assertionType: AssertionType;
  assertionConfig: Prisma.JsonValue | null;
};

type PromptVersionLike = {
  id: string;
  content: string;
};

type ModelConfigLike = {
  id: string;
  modelName: string;
};

export type AssertionOutcome = {
  status: "passed" | "failed" | "needs_review";
  pass: boolean | null;
  score: number | null;
  judgeReason: string;
};

export type EvalRunRequest = {
  datasetId: string;
  promptVersionId: string;
  modelConfigId: string;
  gatewayUrl?: string;
  apiKey?: string;
};

type JsonObject = Record<string, unknown>;

function asObject(value: Prisma.JsonValue | null): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function stringArray(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function configText(config: JsonObject, key: string) {
  const value = config[key];
  return typeof value === "string" ? value.trim() : "";
}

function pass(score: number, judgeReason: string): AssertionOutcome {
  return { status: "passed", pass: true, score, judgeReason };
}

function fail(judgeReason: string): AssertionOutcome {
  return { status: "failed", pass: false, score: 0, judgeReason };
}

function parseJsonObject(text: string) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JsonObject) : null;
  } catch {
    return null;
  }
}

function matchesJsonSchema(output: string, config: JsonObject) {
  const parsed = parseJsonObject(output);
  if (!parsed) return { ok: false, reason: "输出不是合法 JSON 对象。" };

  const schema = asObject((config.schema as Prisma.JsonValue | undefined) ?? (config as Prisma.JsonValue));
  const required = stringArray(schema.required);
  for (const key of required) {
    if (!(key in parsed)) return { ok: false, reason: `缺少必填字段 ${key}。` };
  }

  const properties = asObject(schema.properties as Prisma.JsonValue | null);
  for (const [key, rule] of Object.entries(properties)) {
    if (!(key in parsed)) continue;
    const ruleObject = asObject(rule as Prisma.JsonValue);
    const expectedType = configText(ruleObject, "type");
    if (!expectedType) continue;
    const actual = Array.isArray(parsed[key]) ? "array" : typeof parsed[key];
    if (actual !== expectedType) {
      return { ok: false, reason: `${key} 应为 ${expectedType}，实际为 ${actual}。` };
    }
  }

  return { ok: true, reason: "JSON 输出满足 required/properties 类型约束。" };
}

function judgeLocally(output: string, expectedOutput: string | null, config: JsonObject): AssertionOutcome {
  const lower = output.toLowerCase();
  const passKeywords = stringArray(config.pass_keywords ?? config.passKeywords);
  const failKeywords = stringArray(config.fail_keywords ?? config.failKeywords);
  const threshold = typeof config.threshold === "number" ? config.threshold : 0.7;

  for (const keyword of failKeywords) {
    if (lower.includes(keyword.toLowerCase())) {
      return fail(`本地 judge 命中失败关键词：${keyword}。`);
    }
  }

  const checks = passKeywords.length > 0 ? passKeywords : expectedOutput ? [expectedOutput] : [];
  const matched = checks.filter((keyword) => lower.includes(keyword.toLowerCase()));
  const score = checks.length === 0 ? 0.5 : matched.length / checks.length;
  const reason =
    checks.length === 0
      ? "本地 judge 没有配置关键词，给出中性分。"
      : `本地 judge 命中 ${matched.length}/${checks.length} 个通过关键词。`;

  return score >= threshold ? pass(score, reason) : fail(`${reason} 未达到阈值 ${threshold}。`);
}

export function evaluateAssertion(evalCase: EvalCaseLike, output: string): AssertionOutcome {
  const expected = evalCase.expectedOutput?.trim() ?? "";
  const config = asObject(evalCase.assertionConfig);

  switch (evalCase.assertionType) {
    case "exact_match": {
      return output.trim() === expected ? pass(1, "输出与 expected_output 完全一致。") : fail("输出与 expected_output 不一致。");
    }
    case "contains": {
      const needles = stringArray(config.contains).length > 0 ? stringArray(config.contains) : expected ? [expected] : [];
      if (needles.length === 0) return fail("contains 断言缺少 expected_output 或 assertion_config.contains。");
      const missing = needles.filter((needle) => !output.includes(needle));
      return missing.length === 0 ? pass(1, "输出包含全部必需片段。") : fail(`输出缺少片段：${missing.join(", ")}。`);
    }
    case "regex": {
      const pattern = configText(config, "pattern") || expected;
      if (!pattern) return fail("regex 断言缺少 expected_output 或 assertion_config.pattern。");
      try {
        const flags = configText(config, "flags");
        return new RegExp(pattern, flags).test(output) ? pass(1, "输出匹配正则。") : fail("输出未匹配正则。");
      } catch (error) {
        return fail(`正则配置不可用：${String(error)}。`);
      }
    }
    case "json_schema": {
      const result = matchesJsonSchema(output, config);
      return result.ok ? pass(1, result.reason) : fail(result.reason);
    }
    case "llm_judge": {
      return judgeLocally(output, expected || null, config);
    }
    case "manual_review": {
      return { status: "needs_review", pass: null, score: null, judgeReason: "等待人工复核。" };
    }
    default:
      return fail(`未知断言类型：${evalCase.assertionType}。`);
  }
}

function mockOutput(evalCase: EvalCaseLike, promptVersion: PromptVersionLike) {
  const config = asObject(evalCase.assertionConfig);
  const byPromptVersion = asObject(config.mockOutputByPromptVersion as Prisma.JsonValue | null);
  const versionOutput = byPromptVersion[promptVersion.id];
  if (typeof versionOutput === "string") return versionOutput;
  const configured = config.mockOutput;
  if (typeof configured === "string") return configured;
  return null;
}

async function callGateway({
  evalCase,
  promptVersion,
  modelConfig,
  gatewayUrl,
  apiKey,
}: {
  evalCase: EvalCaseLike;
  promptVersion: PromptVersionLike;
  modelConfig: ModelConfigLike;
  gatewayUrl: string;
  apiKey: string;
}) {
  const started = Date.now();
  const response = await fetch(`${gatewayUrl.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: modelConfig.modelName,
      stream: false,
      messages: [
        { role: "system", content: promptVersion.content },
        { role: "user", content: evalCase.input },
      ],
    }),
  });
  const body = (await response.json().catch(() => null)) as JsonObject | null;
  if (!response.ok) {
    const message = asObject(body?.error as Prisma.JsonValue | null).message;
    throw new Error(typeof message === "string" ? message : `网关返回 HTTP ${response.status}`);
  }
  const choices = Array.isArray(body?.choices) ? body.choices : [];
  const output = choices
    .map((choice) => asObject(asObject(choice as Prisma.JsonValue).message as Prisma.JsonValue | null).content)
    .filter((content): content is string => typeof content === "string")
    .join("");
  const usage = asObject(body?.usage as Prisma.JsonValue | null);
  const promptTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const completionTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
  const cost = promptTokens * 0.000001 + completionTokens * 0.000002;
  return { output, cost, durationMs: Date.now() - started };
}

async function outputForCase({
  evalCase,
  promptVersion,
  modelConfig,
  gatewayUrl,
  apiKey,
}: {
  evalCase: EvalCaseLike;
  promptVersion: PromptVersionLike;
  modelConfig: ModelConfigLike;
  gatewayUrl: string;
  apiKey: string;
}) {
  const configured = mockOutput(evalCase, promptVersion);
  if (configured !== null) return { output: configured, cost: 0, durationMs: 1 };
  return callGateway({ evalCase, promptVersion, modelConfig, gatewayUrl, apiKey });
}

export async function refreshEvalRunSummary(prisma: PrismaClient, evalRunId: string) {
  const results = await prisma.evalResult.findMany({ where: { evalRunId } });
  const finished = results.filter((result) => result.status !== "pending");
  const scoreValues = finished.flatMap((result) => (result.score === null ? [] : [Number(result.score.toString())]));
  const averageScore =
    scoreValues.length === 0 ? null : scoreValues.reduce((sum, score) => sum + score, 0) / scoreValues.length;
  const totalCost = finished.reduce((sum, result) => sum + Number(result.cost?.toString() ?? 0), 0);
  const durationMs = finished.reduce((sum, result) => sum + (result.durationMs ?? 0), 0);
  const status = results.some((result) => result.status === "failed")
    ? "completed"
    : results.some((result) => result.status === "needs_review")
      ? "needs_review"
      : "completed";

  await prisma.evalRun.update({
    where: { id: evalRunId },
    data: {
      status,
      averageScore: averageScore === null ? null : averageScore.toFixed(3),
      totalCost: totalCost.toFixed(10),
      durationMs,
    },
  });
}

export async function runEvalDataset(prisma: PrismaClient, request: EvalRunRequest) {
  const gatewayUrl = request.gatewayUrl ?? process.env.TRACEFORGE_EVAL_GATEWAY_URL ?? "http://localhost:8787";
  const apiKey = request.apiKey ?? process.env.TRACEFORGE_EVAL_API_KEY ?? "tf-stage6-eval-key";

  const [dataset, promptVersion, modelConfig] = await Promise.all([
    prisma.evalDataset.findUnique({
      where: { id: request.datasetId },
      include: { cases: { orderBy: { createdAt: "asc" } } },
    }),
    prisma.promptVersion.findUnique({ where: { id: request.promptVersionId } }),
    prisma.modelConfig.findUnique({ where: { id: request.modelConfigId } }),
  ]);

  if (!dataset) throw new Error("评测数据集不存在。");
  if (!promptVersion) throw new Error("提示词版本不存在。");
  if (!modelConfig) throw new Error("模型配置不存在。");
  if (dataset.cases.length === 0) throw new Error("评测数据集至少需要一个评测样本。");

  const run = await prisma.evalRun.create({
    data: {
      datasetId: dataset.id,
      promptVersionId: promptVersion.id,
      modelConfigId: modelConfig.id,
      status: "running",
    },
  });

  for (const evalCase of dataset.cases) {
    const started = Date.now();
    try {
      const execution = await outputForCase({ evalCase, promptVersion, modelConfig, gatewayUrl, apiKey });
      const outcome = evaluateAssertion(evalCase, execution.output);
      await prisma.evalResult.create({
        data: {
          evalRunId: run.id,
          evalCaseId: evalCase.id,
          output: execution.output,
          assertionType: evalCase.assertionType,
          pass: outcome.pass,
          score: outcome.score === null ? null : outcome.score.toFixed(3),
          judgeReason: outcome.judgeReason,
          cost: execution.cost.toFixed(10),
          durationMs: execution.durationMs,
          status: outcome.status,
        },
      });
    } catch (error) {
      await prisma.evalResult.create({
        data: {
          evalRunId: run.id,
          evalCaseId: evalCase.id,
          output: null,
          assertionType: evalCase.assertionType,
          pass: false,
          score: "0.000",
          judgeReason: `执行失败：${String(error)}`,
          cost: "0",
          durationMs: Date.now() - started,
          status: "failed",
        },
      });
    }
  }

  await refreshEvalRunSummary(prisma, run.id);
  return prisma.evalRun.findUniqueOrThrow({ where: { id: run.id } });
}

export function passRate(results: Array<{ pass: boolean | null }>) {
  if (results.length === 0) return null;
  return results.filter((result) => result.pass === true).length / results.length;
}
