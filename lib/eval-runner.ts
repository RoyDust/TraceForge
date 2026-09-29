import { randomUUID } from "node:crypto";
import { demoMode, evalLimits, gatewayConfig } from "@/lib/env";
import { InputError } from "@/lib/validation";
import { Prisma, type AssertionType, type PrismaClient } from "@prisma/client";

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
  runId?: string;
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

async function callGateway(evalCase: EvalCaseLike, prompt: PromptVersionLike, model: ModelConfigLike, config: { url: string; apiKey: string; timeoutMs: number }, deadline: number) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new InputError("评测总预算已耗尽。");
  const response = await fetch(config.url + "/v1/chat/completions", {
    method: "POST",
    headers: { authorization: "Bearer " + config.apiKey, "content-type": "application/json", "X-TraceForge-Prompt-Version": prompt.id },
    signal: AbortSignal.timeout(Math.max(1, Math.min(config.timeoutMs, remaining))),
    body: JSON.stringify({ model: model.modelName, stream: false, messages: [{ role: "system", content: prompt.content }, { role: "user", content: evalCase.input }] }),
  });
  if (!response.ok) { await response.body?.cancel(); throw new InputError("网关返回 HTTP " + response.status); }
  const body = await response.json() as JsonObject;
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const output = choices.map((choice) => asObject(asObject(choice).message as Prisma.JsonValue).content).filter((value): value is string => typeof value === "string").join("");
  if (!choices.length || output.length > 128000) throw new InputError("网关响应无效或过大。");
  const usage = asObject(body.usage as Prisma.JsonValue);
  return { output, promptTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null, completionTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null };
}

export async function expireEvalRuns(db: PrismaClient) {
  await db.$transaction(async (tx) => {
    const expired = await tx.evalRun.findMany({ where: { status: "running", OR: [{ deadlineAt: { lte: new Date() } }, { deadlineAt: null, createdAt: { lt: new Date(Date.now() - 300_000) } }] }, select: { id: true } });
    const ids = expired.map((run) => run.id);
    if (!ids.length) return;
    await tx.evalRun.updateMany({ where: { id: { in: ids }, status: "running" }, data: { status: "failed" } });
    await tx.evalResult.updateMany({ where: { evalRunId: { in: ids }, status: "pending" }, data: { status: "error", pass: false, judgeReason: "执行超时或进程中断；不会自动重试。" } });
  });
}

export async function refreshEvalRunSummary(db: Prisma.TransactionClient, evalRunId: string) {
  const results = await db.evalResult.findMany({ where: { evalRunId } });
  const scores = results.flatMap((result) => result.score === null ? [] : [result.score]);
  const averageScore = scores.length ? scores.reduce((sum, score) => sum.plus(score), new Prisma.Decimal(0)).div(scores.length) : null;
  const costs = results.flatMap((result) => result.cost === null ? [] : [result.cost]);
  const totalCost = costs.length ? costs.reduce((sum, cost) => sum.plus(cost), new Prisma.Decimal(0)) : null;
  const status = results.some((r) => r.status === "pending") ? "running" : results.some((r) => r.status === "error") ? "failed" : results.some((r) => r.status === "needs_review") ? "needs_review" : "completed";
  await db.evalRun.updateMany({ where: { id: evalRunId, status: { not: "failed" } }, data: { status, averageScore, totalCost, durationMs: results.reduce((sum, r) => sum + (r.durationMs ?? 0), 0) } });
}

export async function runEvalDataset(db: PrismaClient, request: EvalRunRequest) {
  await expireEvalRuns(db);
  const id = request.runId ?? randomUUID();
  const existing = await db.evalRun.findUnique({ where: { id } });
  if (existing) {
    if (existing.datasetId !== request.datasetId || existing.promptVersionId !== request.promptVersionId || existing.modelConfigId !== request.modelConfigId) throw new InputError("提交 ID 已用于其他评测。");
    return existing;
  }
  let config: ReturnType<typeof gatewayConfig>, limits: ReturnType<typeof evalLimits>;
  try { config = gatewayConfig("EVAL"); limits = evalLimits(); } catch (error) { throw new InputError(error instanceof Error ? error.message : "评测配置无效。"); }
  const [dataset, promptVersion, modelConfig] = await Promise.all([
    db.evalDataset.findUnique({ where: { id: request.datasetId }, include: { cases: { orderBy: { createdAt: "asc" }, take: limits.maxCases + 1 } } }),
    db.promptVersion.findUnique({ where: { id: request.promptVersionId }, include: { prompt: true } }),
    db.modelConfig.findUnique({ where: { id: request.modelConfigId }, include: { provider: true } }),
  ]);
  if (!dataset || !promptVersion || !modelConfig) throw new InputError("数据集、提示词版本或模型不存在。");
  if (promptVersion.prompt.projectId !== dataset.projectId) throw new InputError("提示词与数据集不属于同一项目。");
  if (modelConfig.status !== "active" || modelConfig.provider.status !== "active") throw new InputError("模型或供应商已停用。");
  if (!dataset.cases.length || dataset.cases.length > limits.maxCases) throw new InputError("评测样本数必须为 1–" + limits.maxCases + "。");
  const pricing = await db.modelPricing.findFirst({ where: { model: modelConfig.modelName, provider: modelConfig.provider.name, effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: "desc" } });
  const deadline = Date.now() + limits.totalTimeoutMs;
  try {
    await db.evalRun.create({ data: { id, datasetId: dataset.id, promptVersionId: promptVersion.id, modelConfigId: modelConfig.id, status: "running", deadlineAt: new Date(deadline), results: { create: dataset.cases.map((c) => ({ evalCaseId: c.id, assertionType: c.assertionType, status: "pending" })) } } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const concurrent = await db.evalRun.findUniqueOrThrow({ where: { id } });
      if (concurrent.datasetId !== dataset.id || concurrent.promptVersionId !== promptVersion.id || concurrent.modelConfigId !== modelConfig.id) throw new InputError("提交 ID 冲突。");
      return concurrent;
    }
    throw error;
  }
  for (const evalCase of dataset.cases) {
    if (Date.now() >= deadline) break;
    const started = Date.now();
    let data: Prisma.EvalResultUpdateManyMutationInput;
    try {
      const mocked = demoMode() ? mockOutput(evalCase, promptVersion) : null;
      const execution = mocked === null ? await callGateway(evalCase, promptVersion, modelConfig, config, deadline) : { output: mocked, promptTokens: null, completionTokens: null };
      if (Date.now() >= deadline) break;
      const outcome = evaluateAssertion(evalCase, execution.output);
      const cost = mocked !== null ? new Prisma.Decimal(0) : pricing && execution.promptTokens !== null && execution.completionTokens !== null ? pricing.inputPrice.mul(execution.promptTokens).plus(pricing.outputPrice.mul(execution.completionTokens)) : null;
      data = { output: execution.output, pass: outcome.pass, score: outcome.score, judgeReason: outcome.judgeReason, cost, durationMs: Date.now() - started, status: outcome.status };
    } catch {
      data = { pass: false, score: 0, judgeReason: "网关执行失败或超时；请查看对应 TraceRun。", durationMs: Date.now() - started, status: "error" };
    }
    // Late completions cannot overwrite a timeout or reviewed terminal result.
    await db.evalResult.updateMany({ where: { evalRunId: id, evalCaseId: evalCase.id, status: "pending", evalRun: { status: "running", deadlineAt: { gt: new Date() } } }, data });
  }
  await db.$transaction(async (tx) => {
    await tx.evalResult.updateMany({ where: { evalRunId: id, status: "pending" }, data: { status: "error", pass: false, judgeReason: "评测总预算已耗尽或执行中断；未自动重试。" } });
    await refreshEvalRunSummary(tx, id);
  });
  return db.evalRun.findUniqueOrThrow({ where: { id } });
}

export function passRate(results: Array<{ pass: boolean | null }>) {
  if (results.length === 0) return null;
  return results.filter((result) => result.pass === true).length / results.length;
}
