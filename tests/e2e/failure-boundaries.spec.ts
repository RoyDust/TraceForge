import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test, type Page } from "@playwright/test";
const url = process.env.DATABASE_URL!;
const schema = new URL(url).searchParams.get("schema")!;
if (!/^traceforge_e2e_[a-f0-9]+$/.test(schema)) throw new Error("Fault injection requires the owned isolated test schema.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, options: "-c search_path=" + schema }, { schema }) });
test.afterAll(() => db.$disconnect());
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("smoke@example.com");
  await page.getByLabel("密码", { exact: true }).fill("e2e-local-password");
  await page.getByRole("button", { name: "进入追踪控制台" }).click();
  await expect(page).toHaveURL(/\/traces$/);
}

test("database failures reach the error boundary and recover without fabricated metrics", async ({ page }) => {
  await login(page);
  try {
    await db.$executeRawUnsafe("ALTER TABLE trace_run RENAME TO trace_run_unavailable");
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "读取失败", exact: true })).toBeVisible();
    await expect(page.locator(".tf-kpi-card")).toHaveCount(0);
    await expect(page.locator('[data-source="mock"]')).toHaveCount(0);
  } finally { await db.$executeRawUnsafe("ALTER TABLE trace_run_unavailable RENAME TO trace_run"); }
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByRole("heading", { name: "治理总览", exact: true })).toBeVisible();
});

test("Prompt activation failure rolls back the entire create operation", async ({ page }) => {
  await login(page);
  await db.$executeRawUnsafe("CREATE FUNCTION reject_test_prompt_activation() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''injected activation failure''; END'");
  await db.$executeRawUnsafe("CREATE TRIGGER reject_test_prompt_activation BEFORE UPDATE ON prompt FOR EACH ROW WHEN (NEW.name = 'rollback-e2e') EXECUTE FUNCTION reject_test_prompt_activation()");
  try {
    await page.goto("/prompts");
    await page.getByRole("button", { name: "新建提示词", exact: true }).click();
    const form = page.locator("form").filter({ has: page.locator('input[name="name"]') }).first();
    await form.locator('[name="projectId"]').selectOption("00000000-0000-0000-0000-000000000001");
    await form.locator('[name="name"]').fill("rollback-e2e");
    await form.locator('[name="content"]').fill("Should roll back together with version one.");
    await form.locator('button[type="submit"]').click();
    await expect(page.getByRole("heading", { name: "读取失败", exact: true })).toBeVisible();
  } finally {
    await db.$executeRawUnsafe("DROP TRIGGER reject_test_prompt_activation ON prompt");
    await db.$executeRawUnsafe("DROP FUNCTION reject_test_prompt_activation()");
  }
  await page.goto("/prompts");
  await expect(page.getByRole("link", { name: "rollback-e2e", exact: true })).toHaveCount(0);
});

test("Shanghai date filtering and multi-span aggregates agree with a known fixture", async ({ page }) => {
  const projectId = randomUUID();
  await db.project.create({ data: { id: projectId, name: "Boundary fixture" } });
  const timestamps = ["2025-12-31T15:59:59Z", "2025-12-31T16:00:00Z", "2026-01-01T15:59:59Z", "2026-01-01T16:00:00Z"];
  for (const [index, timestamp] of timestamps.entries()) {
    await db.traceRun.create({ data: { projectId, startedAt: new Date(timestamp), name: "boundary-" + index, status: index === 2 ? "failed" : "success", cost: "0.1", totalTokens: 17, latencyMs: index === 1 ? 100 : 300, spans: { create: [{ type: "llm", name: "call", promptTokens: 10, completionTokens: 5, cost: "0.08", status: "success" }, { type: "tool", name: "lookup", promptTokens: 2, completionTokens: 0, cost: "0.02", status: "success" }] } } });
  }
  await login(page);
  await page.goto("/dashboard?projectId=" + projectId + "&from=2026-01-01&to=2026-01-01");
  const kpi = (label: string) => page.locator(".tf-kpi-card").filter({ hasText: label }).locator("strong");
  await expect(kpi("请求量")).toHaveText("2 次");
  await expect(kpi("失败率")).toHaveText("50.0%");
  await expect(kpi("P95 延迟")).toHaveText("300 ms");
  await expect(kpi("令牌")).toHaveText("34");
  await expect(kpi("成本")).toHaveText("$0.200000");
  await page.goto("/traces?projectId=" + projectId + "&from=2026-01-01&to=2026-01-01");
  await expect(page.getByText("boundary-0", { exact: true })).toHaveCount(0);
  await expect(page.getByText("boundary-3", { exact: true })).toHaveCount(0);
});

test("Trace group counts cover every page and preserve shared filters across groups", async ({ page }) => {
  const project = await db.project.create({ data: { name: "Trace group count fixture" } });
  const start = new Date("2002-01-01T12:00:00Z");
  await db.traceRun.createMany({ data: Array.from({ length: 23 }, (_, i) => ({
    projectId: project.id, name: "count-fixture-" + i,
    startedAt: new Date(start.getTime() - i * 1000),
    status: i === 18 || i === 19 ? "failed" as const : i === 20 ? "cancelled" as const : i === 21 ? "running" as const : "success" as const,
    latencyMs: i >= 18 ? 4000 : 100,
  })) });
  await db.traceRun.createMany({ data: [
    { projectId: project.id, name: "count-fixture-outside-date", startedAt: new Date("2002-01-02T12:00:00Z"), status: "failed" },
    { projectId: project.id, name: "unmatched-name", startedAt: start, status: "failed" },
  ] });
  await login(page);
  const query = "/traces?projectId=" + project.id + "&from=2002-01-01&to=2002-01-01&model=count-fixture";
  const groups = page.getByRole("navigation", { name: "追踪运行分组" });
  for (const [suffix, count] of [["", 23], ["&page=2", 23], ["&status=failed", 3], ["&status=running", 1], ["&slow=1", 5]] as const) {
    await page.goto(query + suffix);
    for (const label of ["全部 23", "失败 3", "运行中 1", "慢请求 5"]) {
      await expect(groups.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    await expect(page.locator(".tf-run-queue").getByText(count + " 条运行", { exact: true })).toBeVisible();
  }
  await groups.getByRole("link", { name: "失败 3", exact: true }).click();
  await expect(page.getByRole("link", { name: /已取消.*count-fixture-20/ })).toBeVisible();
});

test("unknown costs remain unknown in aggregates and never receive highest-cost badges", async ({ page }) => {
  const project = await db.project.create({ data: { name: "Unknown cost fixture" } });
  const startedAt = new Date("2002-02-01T00:00:00Z");
  for (const [model, cost] of [["mixed-cost-fixture", "0.1"], ["zero-cost-fixture", "0"]]) {
    await db.traceRun.create({ data: { projectId: project.id, name: model, startedAt, status: "success", cost, spans: { create: { type: "llm", name: model, provider: "mock", model, cost, status: "success", startedAt } } } });
  }
  await login(page);
  const dashboard = "/dashboard?projectId=" + project.id + "&from=2002-02-01&to=2002-02-01";
  const costKpi = page.locator(".tf-kpi-card").filter({ hasText: "成本" }).locator("strong");
  await page.goto(dashboard);
  await expect(costKpi).toHaveText("$0.100000");
  const unknown = await db.traceRun.create({ data: { projectId: project.id, name: "unknown-cost-run", startedAt, status: "success", spans: { create: { type: "llm", name: "unknown-priced-span", provider: "mock", model: "mixed-cost-fixture", cost: null, status: "success", startedAt } } } });
  await page.reload();
  await expect(costKpi).toHaveText("—");
  await expect(page.getByRole("status")).toContainText("成本合计及占比暂不展示");
  const mixed = page.locator(".tf-cost-table").getByRole("row").filter({ has: page.getByRole("cell", { name: /mixed-cost-fixture/ }) });
  await expect(mixed.getByRole("cell").nth(3)).toHaveText("—");
  await expect(mixed.getByRole("cell").nth(4)).toHaveText("—");
  const zero = page.locator(".tf-cost-table").getByRole("row").filter({ has: page.getByRole("cell", { name: /zero-cost-fixture/ }) });
  await expect(zero.getByRole("cell").nth(3)).toHaveText("$0");
  await expect(zero.getByRole("cell").nth(4)).toHaveText("—");
  for (const path of ["/traces?projectId=" + project.id + "&run=" + unknown.id, "/traces/" + unknown.id]) {
    await page.goto(path);
    await expect(page.getByText("调用树", { exact: true })).toBeVisible();
    await expect(page.getByText("最高成本", { exact: true })).toHaveCount(0);
  }
  await db.traceSpan.create({ data: { runId: unknown.id, type: "llm", name: "zero-priced-span", status: "success", cost: "0", startedAt: new Date(startedAt.getTime() + 1000) } });
  await page.reload();
  await expect(page.locator("summary").filter({ hasText: "zero-priced-span" }).getByText("最高成本", { exact: true })).toBeVisible();
  await expect(page.locator("summary").filter({ hasText: "unknown-priced-span" }).getByText("最高成本", { exact: true })).toHaveCount(0);
  await page.goto("/traces?projectId=" + project.id + "&run=" + unknown.id);
  await expect(page.getByRole("row").filter({ hasText: "zero-priced-span" }).getByText("最高成本", { exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "unknown-priced-span" }).getByText("最高成本", { exact: true })).toHaveCount(0);
});

test("Trace empty and running states do not fabricate responsibility or HTTP success", async ({ page }) => {
  const project = await db.project.create({ data: { name: "Empty governance fixture" } });
  await login(page);
  await page.goto("/traces?projectId=" + project.id);
  const rail = page.locator(".tf-incident-rail");
  const http = rail.locator(".tf-rail-facts > div").filter({ hasText: "HTTP 状态" }).locator("strong");
  await expect(page.getByText("没有匹配的追踪运行", { exact: true })).toBeVisible();
  await expect(rail.locator(".tf-rail-callout strong")).toHaveText("无选中运行");
  await expect(http).toHaveText("—");
  await expect(rail.getByText("200 正常", { exact: true })).toHaveCount(0);
  const run = await db.traceRun.create({ data: { projectId: project.id, name: "running-without-result", status: "running" } });
  await page.reload();
  await expect(rail.locator(".tf-rail-callout strong")).toHaveText("—");
  await expect(http).toHaveText("—");
  await db.traceRun.update({ where: { id: run.id }, data: { status: "success" } });
  await page.reload();
  await expect(http).toHaveText("200 正常");
});

test("Eval enforces sample cap and validates Prompt project ownership before creating a Run", async ({ page }) => {
  const projectId = randomUUID();
  const oversized = await db.evalDataset.create({ data: { project: { create: { id: projectId, name: "Eval boundaries" } }, name: "Too many cases", cases: { create: Array.from({ length: 4 }, (_, i) => ({ input: "sample-" + i, assertionType: "exact_match" as const, expectedOutput: "hello from mock", tags: [] })) } } });
  const prompt = await db.prompt.create({ data: { projectId, name: "Bounded prompt", versions: { create: { version: 1, content: "hello" } } }, include: { versions: true } });
  await login(page);
  await page.goto("/evals/" + oversized.id);
  const form = page.locator("form").filter({ has: page.locator('select[name="promptVersionId"]') }).first();
  await form.locator('[name="promptVersionId"]').selectOption(prompt.versions[0].id);
  await form.locator('[name="modelConfigId"]').selectOption("00000000-0000-0000-0000-000000000031");
  await form.locator('button[type="submit"]').click();
  await expect(form.getByRole("alert")).toContainText("样本数必须为 1–3");
  await form.evaluate((el) => el.addEventListener("formdata", (event) => (event as FormDataEvent).formData.set("promptVersionId", "00000000-0000-0000-0000-000000000502")));
  await form.locator('button[type="submit"]').click();
  await expect(form.getByRole("alert")).toContainText("不属于同一项目");
});

test("expired Eval execution is terminal after a process interruption", async ({ page }) => {
  const run = await db.evalRun.create({ data: { datasetId: "00000000-0000-0000-0000-000000000601", status: "running", deadlineAt: new Date(Date.now() - 1000), results: { create: { evalCaseId: "00000000-0000-0000-0000-000000000602", assertionType: "exact_match", status: "pending" } } } });
  await login(page);
  await page.goto("/evals/runs/" + run.id);
  await expect(page.getByText("执行超时或进程中断；不会自动重试。", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("运行中", { exact: true })).toHaveCount(0);
});


test("all-project refresh preserves dates and no-span gateway rejections remain visible", async ({ page }) => {
  const project = await db.project.create({ data: { name: "Gateway rejection fixture" } });
  await db.traceRun.create({ data: { projectId: project.id, name: "quota-denied", status: "failed", errorCode: "rate_limited", startedAt: new Date("2001-01-02T00:00:00Z") } });
  await login(page);
  await page.goto("/dashboard?projectId=" + project.id + "&from=2001-01-02&to=2001-01-02");
  await expect(page.getByText("网关拒绝（未达模型）", { exact: true })).toBeVisible();
  const filters = page.locator("form.tf-filter-strip");
  await filters.locator('[name="projectId"]').selectOption("");
  await filters.getByRole("button", { name: "应用筛选" }).click();
  await expect(page.getByRole("heading", { name: "治理总览", exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("from")).toBe("2001-01-02");
  await expect(page.locator(".tf-kpi-card").filter({ hasText: "请求量" }).locator("strong")).toHaveText("1 次");
});

test("expired partial Eval keeps its cost and permits remaining manual review", async ({ page }) => {
  const datasetId = "00000000-0000-0000-0000-000000000601";
  const manual = await db.evalCase.create({ data: { datasetId, input: "Review interrupted result", assertionType: "manual_review", tags: [] } });
  const run = await db.evalRun.create({ data: { datasetId, status: "running", deadlineAt: new Date(Date.now()-1000), results: { create: [
    { evalCaseId: "00000000-0000-0000-0000-000000000602", assertionType: "exact_match", status: "passed", pass: true, score: 1, cost: "0.123456", durationMs: 250, output: "successful before interruption" },
    { evalCaseId: manual.id, assertionType: "manual_review", status: "needs_review", cost: "0.100000", durationMs: 100, output: "reviewable before interruption" },
  ] } } });
  const foreign = await db.evalRun.create({ data: { datasetId, status: "needs_review", results: { create: { evalCaseId: manual.id, assertionType: "manual_review", status: "needs_review", output: "belongs to another Run" } } }, include: { results: true } });
  try {
    await login(page);
    await page.goto("/evals/runs/" + run.id);
    const summary = (label: string) => page.locator(".summary-cell").filter({ has: page.locator("small", { hasText: label }) }).locator("strong");
    await expect(summary("成本")).toHaveText("0.223456");
    await expect(summary("平均得分")).toHaveText("1");
    await expect(summary("耗时")).toHaveText("350 ms");
    await expect(page.locator(".page-head .badge")).toHaveText("失败");
    const wrongForm = page.locator("form").filter({ has: page.getByRole("button", { name: "标记通过", exact: true }) });
    await wrongForm.evaluate((el, value) => el.addEventListener("formdata", (event) => (event as FormDataEvent).formData.set("resultId", value)), foreign.results[0].id);
    await wrongForm.locator('button[type="submit"]').click();
    await expect(wrongForm.getByRole("alert")).toContainText("结果不属于此评测运行");
    await page.reload();
    await page.getByRole("button", { name: "标记通过", exact: true }).click();
    await expect(page.getByText("人工复核通过。", { exact: true })).toBeVisible();
    await expect(page.locator(".page-head .badge")).toHaveText("失败");
    await expect(summary("成本")).toHaveText("0.223456");
  } finally { await db.evalResult.deleteMany({ where: { evalRunId: { in: [run.id, foreign.id] } } }); await db.evalRun.deleteMany({ where: { id: { in: [run.id, foreign.id] } } }); await db.evalCase.delete({ where: { id: manual.id } }); }
});

test("real fallback persists its destination and Eval bills the actual model", async ({ page }) => {
  const first = "00000000-0000-0000-0000-000000000032";
  const final = "00000000-0000-0000-0000-000000000031";
  await db.modelConfig.update({ where: { id: first }, data: { fallbackModelId: final } });
  await db.modelPricing.updateMany({ where: { model: "mock-fail", provider: "mock" }, data: { inputPrice: "1", outputPrice: "2" } });
  try {
    await login(page);
    await page.goto("/evals/00000000-0000-0000-0000-000000000601");
    const form = page.locator("form").filter({ has: page.locator('select[name="promptVersionId"]') }).first();
    await form.locator('[name="promptVersionId"]').selectOption("00000000-0000-0000-0000-000000000502");
    await form.locator('[name="modelConfigId"]').selectOption(first);
    await form.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/evals\/runs\//);
    await expect(page.locator(".summary-cell").filter({ has: page.locator("small", { hasText: "成本" }) }).locator("strong")).toHaveText("0.00000900");
    await page.goto("/dashboard");
    const chain = page.locator(".tf-chain-list").getByText("mock-fail → mock-ok", { exact: true });
    await expect(chain).toBeVisible();
    await expect(chain.locator("..").locator("strong")).toHaveText("2");
    await expect(page.locator(".tf-chain-list").getByText("mock-fail → 未知终点", { exact: true })).toHaveCount(0);
  } finally {
    await db.modelConfig.update({ where: { id: first }, data: { fallbackModelId: null } });
    await db.modelPricing.updateMany({ where: { model: "mock-fail", provider: "mock" }, data: { inputPrice: "0.000001", outputPrice: "0.000002" } });
  }
});


async function authed(page: Page, path: string, data?: unknown) {
  const cookie = (await page.context().cookies()).map((c) => c.name + "=" + c.value).join("; ");
  return data === undefined ? page.request.get(path, { headers: { cookie } }) : page.request.post(path, { headers: { cookie }, data });
}

test("rejected Chat dispatch expires without a fabricated Run or automatic resend", async ({ page }) => {
  const demo = "http://127.0.0.1:" + process.env.TRACEFORGE_E2E_DEMO_PORT;
  await page.goto(demo + "/login");
  await page.getByRole("button", { name: "进入追踪控制台" }).click();
  await expect(page).toHaveURL(demo + "/traces");
  const response = await authed(page, demo + "/chat/dispatch", { model: "mock-ok", messages: [{ role: "user", content: "rejected request" }] });
  expect(response.status()).toBe(202);
  const accepted = await response.json();
  const path = demo + "/chat/runs/" + accepted.runId + "?pending=" + encodeURIComponent(accepted.receipt);
  expect((await authed(page, path)).status()).toBe(200);
  await page.goto(demo + accepted.traceUrl);
  await expect(page.getByRole("heading", { name: "正在等待网关接受请求" })).toBeVisible();
  if (process.env.TRACEFORGE_E2E_IMAGE) {
    execFileSync("docker", ["restart", "--time", "1", process.env.TRACEFORGE_E2E_CONTAINER + "-demo"], { timeout: 30000, stdio: "pipe" });
    await expect.poll(async () => {
      try { return (await page.request.get(demo + "/login")).status(); }
      catch { return 0; } // Restart deliberately breaks existing sockets until Next is ready.
    }, { timeout: 10000 }).toBe(200);
    await page.reload();
  }
  await expect.poll(async () => (await authed(page, path)).status(), { timeout: 15000, intervals: [500,1000] }).toBe(410);
  await expect(page.locator("p.form-error[role=alert]")).toContainText("已停止自动等待");
  // A fresh client reconnect can recover the signed deadline without local state.
  await page.reload();
  await expect(page.getByRole("heading", { name: "未确认派发", exact: true })).toBeVisible();
  expect((await authed(page, demo + "/chat/runs/" + accepted.runId)).status()).toBe(404);
  expect((await authed(page, demo + "/chat/runs/" + randomUUID() + "?pending=" + encodeURIComponent(accepted.receipt))).status()).toBe(404);
});

test("accepted Chat timeout stops UI waiting while retaining the actual Gateway Run", async ({ page }) => {
  await login(page);
  const response = await authed(page, "/chat/dispatch", { model: "mock-timeout", messages: [{ role: "user", content: "timeout request" }] });
  expect(response.status()).toBe(202);
  const accepted = await response.json();
  await expect.poll(async () => (await (await authed(page, "/chat/runs/" + accepted.runId + "?pending=" + encodeURIComponent(accepted.receipt))).json()).run?.status).toBe("running");
  await page.goto(accepted.traceUrl);
  await expect(page.locator("p.form-error[role=alert]")).toContainText("已停止自动等待", { timeout: 15000 });
  await expect(page.getByText("Demo Project · " + accepted.runId, { exact: true })).toBeVisible();
});

test("Eval total budget ends every pending result and preserves three unique samples", async ({ page }) => {
  const dataset = await db.evalDataset.create({ data: { projectId: "00000000-0000-0000-0000-000000000001", name: "Total budget fixture", cases: { create: [0,1,2].map((i) => ({ input: "budget-" + i, assertionType: "contains" as const, expectedOutput: "hello", tags: [] })) } } });
  await login(page);
  await page.goto("/evals/" + dataset.id);
  const form = page.locator("form").filter({ has: page.locator('select[name="promptVersionId"]') }).first();
  await form.locator('[name="promptVersionId"]').selectOption("00000000-0000-0000-0000-000000000502");
  await form.locator('[name="modelConfigId"]').selectOption("00000000-0000-0000-0000-000000000034");
  await form.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/evals\/runs\//);
  await expect(page.locator(".page-head .badge")).toHaveText("失败");
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await expect(page.getByText("评测总预算已耗尽或执行中断；未自动重试。", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.locator(".page-head .badge")).toHaveText("失败");
  await expect(page.locator("tbody tr")).toHaveCount(3);
});

test("dynamic navigation shows loading while PostgreSQL is busy, then recovers", async ({ page }) => {
  await login(page);
  let release!: () => void;
  let ready!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const locked = new Promise<void>((resolve) => { ready = resolve; });
  const holding = db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("LOCK TABLE trace_run IN ACCESS EXCLUSIVE MODE");
    ready();
    await released;
  }, { timeout: 20000 });
  await locked;
  try {
    await page.goto("/dashboard", { waitUntil: "commit" });
    await expect(page.getByRole("heading", { name: "正在加载…", exact: true })).toBeVisible();
  } finally { release(); await holding; }
  await expect(page.getByRole("heading", { name: "治理总览", exact: true })).toBeVisible();
});

test("Dashboard aggregates 2000 Runs and 4000 Spans while bounding displayed detail", async ({ page }, testInfo) => {
  const project = await db.project.create({ data: { name: "Scale fixture" } });
  const runs = Array.from({ length: 2000 }, (_, i) => ({ id: randomUUID(), projectId: project.id, name: "scale-" + i, status: "success" as const, startedAt: new Date("2002-01-01T00:00:00Z"), latencyMs: i, cost: "0.1" }));
  await db.traceRun.createMany({ data: runs });
  await db.traceSpan.createMany({ data: runs.flatMap((run) => [0,1].map((i) => ({ runId: run.id, type: "llm" as const, name: "scale-span-" + i, status: "success" as const, model: "mock-ok", provider: "mock", promptTokens: 10, completionTokens: 5, cost: "0.05", latencyMs: run.latencyMs }))) });
  await login(page);
  const start = Date.now();
  await page.goto("/dashboard?projectId=" + project.id + "&from=2002-01-01&to=2002-01-14");
  await expect(page.locator(".tf-kpi-card").filter({ hasText: "请求量" }).locator("strong")).toHaveText("2,000 次");
  await expect(page.locator(".tf-trace-panel tbody tr")).toHaveCount(9);
  await expect(page.locator(".tf-kpi-card").filter({ hasText: "P95 延迟" }).locator("strong")).toHaveText("1,899 ms");
  const browserMs = Date.now() - start;
  const plan = await db.$queryRawUnsafe('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT count(*), sum(cost), percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) FROM trace_run WHERE project_id=$1::uuid AND started_at >= $2::timestamp AND started_at < $3::timestamp', project.id, new Date("2001-12-31T16:00:00Z"), new Date("2002-01-14T16:00:00Z"));
  const evidence = { runs: 2000, spans: 4000, range: "2002-01-01–2002-01-14 Asia/Shanghai", browserMs, displayedRuns: 9, representativeSummaryPlan: plan };
  console.log("Dashboard scale evidence: " + JSON.stringify(evidence));
  await testInfo.attach("dashboard-scale-evidence", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
});

test("usage tabs preserve unknown latency and day drilldown keeps project scope", async ({ page }) => {
  const project = await db.project.create({ data: { name: "Usage UI fixture" } });
  for (const day of ["2026-01-01", "2026-01-03"]) {
    await db.traceRun.create({ data: { projectId: project.id, name: "usage-ui-" + day, startedAt: new Date(day + "T02:00:00Z"), status: "success", cost: "0", latencyMs: 120, spans: { create: { type: "llm", name: "call", promptTokens: 10, completionTokens: 5, status: "success" } } } });
  }
  await login(page);
  await page.goto("/dashboard?projectId=" + project.id + "&from=2026-01-01&to=2026-01-03");
  await page.getByRole("tab", { name: "Token", exact: true }).click();
  await expect(page.getByRole("link", { name: /2026-01-01 · Token 15 个/ })).toBeVisible();
  await page.getByRole("tab", { name: "Token", exact: true }).press("ArrowRight");
  await expect(page.getByRole("tab", { name: "P95 延迟", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("link", { name: /2026-01-02 · P95 延迟 —/ })).toBeVisible();
  await page.getByRole("tab", { name: "请求量", exact: true }).click();
  await page.getByRole("link", { name: /2026-01-01 · 请求量 1 次/ }).click();
  await expect(page).toHaveURL(/\/traces\?/);
  const drilldown = new URL(page.url());
  expect(drilldown.searchParams.get("projectId")).toBe(project.id);
  expect(drilldown.searchParams.get("from")).toBe("2026-01-01");
  expect(drilldown.searchParams.get("to")).toBe("2026-01-01");
  await expect(page.getByRole("link", { name: /usage-ui-2026-01-01/ })).toHaveCount(1);
  await page.goto("/dashboard?projectId=" + project.id);
  await page.getByRole("link", { name: "近 30 天", exact: true }).click();
  expect(new URL(page.url()).searchParams.get("projectId")).toBe(project.id);
  await expect(page.getByRole("link", { name: "近 30 天", exact: true })).toHaveAttribute("aria-current", "date");
});

test("library search and creation drawers work with keyboard and project scope", async ({ page }) => {
  const project = await db.project.create({ data: { name: "Library UI fixture" } });
  await db.prompt.create({ data: { projectId: project.id, name: "Library-Needle-Prompt", description: "Searchable prompt" } });
  await db.evalDataset.create({ data: { projectId: project.id, name: "Library-Needle-Dataset", description: "Searchable dataset" } });
  await login(page);
  for (const [path, label, item] of [["prompts", "提示词", "Prompt"], ["evals", "数据集", "Dataset"]]) {
    await page.goto("/" + path + "?projectId=" + project.id);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("searchbox", { name: "搜索" + label, exact: true }).fill("LIBRARY-NEEDLE");
    await page.getByRole("searchbox", { name: "搜索" + label, exact: true }).press("Enter");
    await expect(page.getByRole("link", { name: "Library-Needle-" + item, exact: true })).toBeVisible();
    const trigger = page.getByRole("button", { name: "新建" + label, exact: true });
    await trigger.press("Enter");
    const dialog = page.getByRole("dialog", { name: "创建" + label, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('select[name="projectId"]')).toHaveValue(project.id);
    await dialog.getByRole("textbox", { name: "名称", exact: true }).fill("unsaved draft");
    await dialog.getByRole("textbox", { name: "名称", exact: true }).press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.getByRole("searchbox", { name: "搜索" + label, exact: true }).fill("no-matching-library-item");
    await page.getByRole("searchbox", { name: "搜索" + label, exact: true }).press("Enter");
    await expect(page.getByRole("heading", { name: "没有匹配的" + label, exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("projectId")).toBe(project.id);
  }
});
