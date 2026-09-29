import { createHmac, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
const project = "00000000-0000-0000-0000-000000000001";
const dataset = "00000000-0000-0000-0000-000000000601";
const prompt = "00000000-0000-0000-0000-000000000501";
const version = "00000000-0000-0000-0000-000000000502";
const model = "00000000-0000-0000-0000-000000000031";
async function login(page: Page, base = "") {
  await page.context().clearCookies();
  await page.goto(base + "/login");
  await page.getByLabel("邮箱", { exact: true }).fill("smoke@example.com");
  await page.getByLabel("密码", { exact: true }).fill("e2e-local-password");
  await page.getByRole("button", { name: "进入追踪控制台" }).click();
  await expect(page).toHaveURL(/\/traces$/);
}

async function authenticatedRequest(page: Page, path: string, data?: unknown) {
  // Chromium accepts secure cookies for loopback; Playwright's separate HTTP client does not.
  const cookie = (await page.context().cookies()).map((c) => c.name + "=" + c.value).join("; ");
  return data === undefined ? page.request.get(path, { headers: { cookie } }) : page.request.post(path, { data, headers: { cookie } });
}

test("Demo mode is runtime explicit and production login never leaks credentials", async ({ page, request }) => {
  await page.goto("/login");
  await expect(page.getByLabel("邮箱", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("密码", { exact: true })).toHaveValue("");
  expect(await (await request.get("/login")).text()).not.toContain("e2e-local-password");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex.*nofollow/);
  await expect(page.getByTestId("demo-mode")).toHaveCount(0);
  const demo = "http://127.0.0.1:" + process.env.TRACEFORGE_E2E_DEMO_PORT;
  await page.goto(demo + "/login");
  await expect(page.getByLabel("邮箱", { exact: true })).toHaveValue("demo@traceforge.local");
  await expect(page.getByLabel("密码", { exact: true })).toHaveValue("traceforge-demo");
  await page.getByRole("button", { name: "进入追踪控制台" }).click();
  await expect(page).toHaveURL(/\/traces$/);
  await expect(page.getByTestId("demo-mode")).toBeVisible();
  await page.goto(demo + "/dashboard");
  await expect(page.getByTestId("demo-mode")).toBeVisible();
  await expect(page.getByRole("heading", { name: "治理总览", exact: true })).toBeVisible();
});

test("every protected entry rejects anonymous and expired sessions", async ({ page, request, context }) => {
  for (const path of ["/dashboard", "/chat", "/prompts", "/evals", "/traces/" + randomUUID()]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
  expect((await request.post("/chat/dispatch", { data: {} })).status()).toBe(401);
  expect((await request.get("/chat/runs/" + randomUUID())).status()).toBe(401);
  const payload = Buffer.from(JSON.stringify({ email: "smoke@example.com", exp: Date.now() - 1000 })).toString("base64url");
  const signature = createHmac("sha256", "plain:e2e-local-password:" + process.env.DATABASE_URL).update(payload).digest("base64url");
  await context.addCookies([{ name: "traceforge_admin", value: payload + "." + signature, url: "http://127.0.0.1:" + process.env.TRACEFORGE_E2E_PORT }]);
  await page.goto("/dashboard"); await expect(page).toHaveURL(/\/login$/);
});

test("all dashboard panels remain, real zero stays zero, and empty data is explicit", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard?projectId=" + project);
  await expect(page.getByRole("heading", { name: "治理总览", exact: true })).toBeVisible();
  for (const text of ["每日用量", "模型 / 供应商成本拆分", "供应商健康", "限流失败", "备用切换链路", "流式中断原因"]) await expect(page.getByText(text, { exact: true })).toBeVisible();
  await expect(page.locator('[data-source="mock"]')).toHaveCount(0);
  const requestKpi = page.locator(".tf-kpi-card").filter({ hasText: "请求量" });
  expect(Number((await requestKpi.locator("strong").innerText()).replace(/\D/g, ""))).toBeGreaterThanOrEqual(24);
  await expect(page.locator(".tf-trace-panel tbody tr")).toHaveCount(9);
  await page.goto("/dashboard?projectId=" + project + "&from=2000-01-01&to=2000-01-01");
  await expect(page.getByRole("status")).toContainText("暂无运行数据");
  await expect(page.locator(".tf-kpi-card").filter({ hasText: "请求量" }).locator("strong")).toHaveText("0 次");
  await expect(page.locator(".tf-kpi-card").filter({ hasText: "备用切换" }).locator("strong")).toHaveText("0");
  await expect(page.locator(".tf-trace-panel tbody tr")).toHaveCount(0);
});

test("missing resources use not-found while arbitrary pending IDs cannot bypass it", async ({ page }) => {
  await login(page);
  for (const path of ["/traces/", "/prompts/", "/evals/", "/evals/runs/"]) {
    const response = await page.goto(path + randomUUID() + "?pending=1");
    expect([200,404]).toContain(response!.status()); // Next streaming loading may commit 200 first.
    await expect(page.getByRole("heading", { name: "404 · 资源不存在" })).toBeVisible();
  }
  const response = await page.goto("/missing-route");
  expect(response!.status()).toBe(404);
});

test("Chat after dispatch creates the predeclared Run through the Rust Gateway", async ({ page }) => {
  await login(page);
  const response = await authenticatedRequest(page, "/chat/dispatch", { model: "mock-ok", stream: false, messages: [{ role: "user", content: "hello" }] });
  expect(response.status()).toBe(202);
  const accepted = await response.json();
  expect(accepted.traceUrl).toContain(accepted.runId);
  await expect.poll(async () => (await (await authenticatedRequest(page, "/chat/runs/" + accepted.runId + "?pending=" + encodeURIComponent(accepted.receipt))).json()).run?.status).toBe("success");
  const run = (await (await authenticatedRequest(page, "/chat/runs/" + accepted.runId)).json()).run;
  expect(run.outputPreview).toContain("hello from mock");
  expect(run.startedAt).toMatch(/Z$/);
  await page.goto(accepted.traceUrl);
  await expect(page.getByText("Demo Project · " + accepted.runId, { exact: true })).toBeVisible();
  const repeated = await page.request.post("http://127.0.0.1:" + process.env.TRACEFORGE_E2E_GATEWAY_PORT + "/v1/chat/completions", { headers: { authorization: "Bearer e2e-local-key", "X-TraceForge-Run-Id": accepted.runId }, data: { model: "mock-ok", messages: [{ role: "user", content: "hello" }] } });
  expect(repeated.status()).toBe(409);
});

test("Chat stream failures are persisted and missing keys fail before pending", async ({ page }) => {
  await login(page);
  const accepted = await (await authenticatedRequest(page, "/chat/dispatch", { model: "mock-mid", stream: true, messages: [{ role: "user", content: "hello" }] })).json();
  await expect.poll(async () => (await (await authenticatedRequest(page, "/chat/runs/" + accepted.runId + "?pending=" + encodeURIComponent(accepted.receipt))).json()).run?.errorCode).toBe("stream_interrupted");
  const noKey = "http://127.0.0.1:" + process.env.TRACEFORGE_E2E_NO_KEY_PORT;
  await login(page, noKey);
  const response = await authenticatedRequest(page, noKey + "/chat/dispatch", { model: "mock-ok", messages: [{ role: "user", content: "hello" }] });
  expect(response.status()).toBe(503);
  expect((await response.json()).error).toContain("TRACEFORGE_CHAT_API_KEY");
});

async function evalForm(page: Page) {
  await page.goto("/evals/" + dataset);
  const form = page.locator("form").filter({ has: page.locator('select[name="promptVersionId"]') }).first();
  await form.locator('[name="promptVersionId"]').selectOption(version);
  await form.locator('[name="modelConfigId"]').selectOption(model);
  return form;
}

test("Eval persists output and replaying the same form returns the same Run", async ({ page }) => {
  await login(page);
  let form = await evalForm(page);
  const id = await form.locator('[name="requestId"]').inputValue();
  await form.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(new RegExp("/evals/runs/" + id + "$"));
  await page.getByText("查看输出", { exact: true }).first().click();
  await expect(page.getByText("hello from mock", { exact: true }).first()).toBeVisible();
  form = await evalForm(page);
  await form.evaluate((el, value) => el.addEventListener("formdata", (event) => (event as FormDataEvent).formData.set("requestId", value)), id);
  await form.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(new RegExp("/evals/runs/" + id + "$"));
});

test("Eval timeout and missing configuration show bounded outcomes", async ({ page }) => {
  await login(page);
  const form = await evalForm(page);
  await form.locator('[name="modelConfigId"]').selectOption("00000000-0000-0000-0000-000000000034");
  await form.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/evals\/runs\//);
  await expect(page.getByText("网关执行失败或超时；请查看对应 TraceRun。", { exact: true }).first()).toBeVisible();
  const noKey = "http://127.0.0.1:" + process.env.TRACEFORGE_E2E_NO_KEY_PORT;
  await login(page, noKey);
  await page.goto(noKey + "/evals/" + dataset);
  const missing = page.locator("form").filter({ has: page.locator('select[name="promptVersionId"]') }).first();
  await missing.locator('[name="promptVersionId"]').selectOption(version);
  await missing.locator('[name="modelConfigId"]').selectOption(model);
  await missing.locator('button[type="submit"]').click();
  await expect(missing.getByRole("alert")).toContainText("TRACEFORGE_EVAL_API_KEY");
});

test("Prompt versions reject cross-parent activation with a visible business error", async ({ page }) => {
  await login(page);
  await page.goto("/prompts/" + prompt);
  const form = page.locator("form").filter({ has: page.locator('input[name="versionId"]') }).first();
  await form.evaluate((el, value) => el.addEventListener("formdata", (event) => (event as FormDataEvent).formData.set("versionId", value)), randomUUID());
  await form.locator('button[type="submit"]').click();
  await expect(form.getByRole("alert")).toContainText("不属于此提示词");
});

test("Server Actions recheck authorization after the page was rendered", async ({ page }) => {
  await login(page);
  await page.goto("/prompts");
  const form = page.locator("form").filter({ has: page.locator('input[name="name"]') }).first();
  await form.locator('[name="projectId"]').selectOption(project);
  await form.locator('[name="name"]').fill("must not be created");
  await form.locator('[name="content"]').fill("unauthenticated submission");
  await page.context().clearCookies();
  await form.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/login$/);
});

test("invalid Eval JSON is an inline business error and creates no sample", async ({ page }) => {
  await login(page);
  await page.goto("/evals/" + dataset);
  const form = page.locator("form").filter({ has: page.locator('[name="assertionConfig"]') }).first();
  await form.locator('[name="input"]').fill("invalid JSON sample");
  await form.locator('[name="assertionType"]').selectOption("contains");
  await form.locator('[name="assertionConfig"]').fill("{");
  await form.locator('button[type="submit"]').click();
  await expect(form.getByRole("alert")).toContainText("合法 JSON");
  await page.reload();
  await expect(page.getByText("invalid JSON sample", { exact: true })).toHaveCount(0);
});

test("same Prompt Version submission from two tabs allocates only one version", async ({ page, context }) => {
  await login(page);
  const second = await context.newPage();
  const id = randomUUID();
  for (const tab of [page, second]) {
    await tab.goto("/prompts/" + prompt);
    const form = tab.locator("form").filter({ has: tab.locator('textarea[name="content"]') }).first();
    await form.locator('[name="content"]').fill("Concurrent version acceptance");
    await form.evaluate((el, value) => el.addEventListener("formdata", (event) => (event as FormDataEvent).formData.set("requestId", value)), id);
  }
  await Promise.all([page, second].map(async (tab) => {
    await tab.locator("form").filter({ has: tab.locator('textarea[name="content"]') }).first().locator('button[type="submit"]').click();
    await expect(tab).toHaveURL(new RegExp("/prompts/" + prompt + "\\?compare=3$"));
  }));
  await second.close();
});
