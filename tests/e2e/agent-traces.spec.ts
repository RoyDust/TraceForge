import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test } from "@playwright/test";
import { createTraceClient } from "../../sdk/node/index.mjs";

const gateway = "http://127.0.0.1:" + process.env.TRACEFORGE_E2E_GATEWAY_PORT;
const headers = { authorization: "Bearer e2e-local-key" };
const databaseUrl = process.env.DATABASE_URL!;
const schema = new URL(databaseUrl).searchParams.get("schema")!;
if (!/^traceforge_e2e_[a-f0-9]+$/.test(schema)) throw new Error("Agent fixtures require an isolated test schema");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, options: "-c search_path=" + schema }, { schema }) });
test.afterAll(() => db.$disconnect());

test("Agent Trace HTTP lifecycle preserves a real parent-child tree", async ({ request }) => {
  const runId = randomUUID();
  const spanId = randomUUID();
  const path = gateway + "/api/traces/runs/" + runId;
  expect((await request.post(gateway + "/api/traces/runs", { headers, data: { id: runId, name: "Agent lifecycle" } })).status()).toBe(201);
  expect((await request.post(path + "/spans", { headers, data: { id: spanId, name: "write", type: "workflow" } })).status()).toBe(201);
  expect((await request.post(path + "/end", { headers, data: { status: "success" } })).status()).toBe(409);
  const response = await request.post(gateway + "/v1/chat/completions", { headers: { ...headers, "X-TraceForge-Agent-Run-Id": runId, "X-TraceForge-Parent-Span-Id": spanId }, data: { model: "mock-ok", messages: [{ role: "user", content: "write a sentence" }] } });
  expect(response.status()).toBe(200);
  expect(response.headers()["x-traceforge-run-id"]).toBe(runId);
  await expect.poll(async () => {
    const trace = await (await request.get(path, { headers })).json();
    return trace.spans.filter((s: { type: string; status: string }) => s.type === "llm" && s.status === "success").length;
  }).toBe(1);
  const trace = await (await request.get(path, { headers })).json();
  expect(trace.status).toBe("running");
  expect(trace.spans.find((s: { type: string }) => s.type === "llm").parentId).toBe(spanId);
  expect((await request.post(path + "/spans/" + spanId + "/end", { headers, data: { status: "success" } })).status()).toBe(200);
  expect((await request.post(path + "/end", { headers, data: { status: "success" } })).status()).toBe(200);
  expect((await request.post(path + "/spans", { headers, data: { id: randomUUID(), name: "late", type: "tool" } })).status()).toBe(409);
});

test("Agent Trace scopes, ownership and immutable IDs hold across cached authentication", async ({ request }) => {
  const runId = randomUUID();
  const path = gateway + "/api/traces/runs/" + runId;
  const token = randomUUID();
  const otherProject = await db.project.create({ data: { name: "Foreign Agent" } });
  await db.apiKey.create({ data: { projectId: otherProject.id, name: "Foreign key", keyHash: createHash("sha256").update(token).digest("hex"), scope: ["gateway", "trace_ingest"] } });
  const gatewayOnly = randomUUID();
  await db.apiKey.create({ data: { projectId: "00000000-0000-0000-0000-000000000001", name: "Gateway only", keyHash: createHash("sha256").update(gatewayOnly).digest("hex"), scope: ["gateway"] } });
  const call = { model: "mock-ok", messages: [{ role: "user", content: "permission check" }] };
  expect((await request.post(gateway + "/v1/chat/completions", { headers: { authorization: "Bearer " + gatewayOnly }, data: call })).status()).toBe(200);
  expect((await request.post(gateway + "/api/traces/runs", { headers: { authorization: "Bearer " + gatewayOnly }, data: { id: runId, name: "denied" } })).status()).toBe(401);
  expect((await request.post(gateway + "/api/traces/runs", { data: { id: runId, name: "unauthenticated" } })).status()).toBe(401);
  expect((await request.post(gateway + "/api/traces/runs", { headers, data: { id: runId, name: "original" } })).status()).toBe(201);
  expect((await request.post(gateway + "/api/traces/runs", { headers, data: { id: runId, name: "overwrite" } })).status()).toBe(409);
  expect((await request.get(path, { headers: { authorization: "Bearer " + token } })).status()).toBe(404);
  expect((await request.post(path + "/end", { headers: { authorization: "Bearer " + token }, data: { status: "success" } })).status()).toBe(404);
  expect((await request.post(gateway + "/v1/chat/completions", { headers: { authorization: "Bearer " + token, "X-TraceForge-Agent-Run-Id": runId }, data: call })).status()).toBe(404);
  expect((await request.post(gateway + "/v1/chat/completions", { headers: { authorization: "Bearer " + gatewayOnly, "X-TraceForge-Agent-Run-Id": runId }, data: call })).status()).toBe(401);
  expect((await request.post(gateway + "/v1/chat/completions", { headers: { ...headers, "X-TraceForge-Run-Id": runId }, data: call })).status()).toBe(409);
  expect((await request.post(gateway + "/v1/chat/completions", { headers: { ...headers, "X-TraceForge-Run-Id": randomUUID(), "X-TraceForge-Agent-Run-Id": runId }, data: call })).status()).toBe(400);
  expect((await request.post(path + "/spans", { headers, data: { id: randomUUID(), name: "fake model", type: "llm" } })).status()).toBe(400);
  expect((await request.post(path + "/spans", { headers, data: { id: randomUUID(), name: "bad parent", type: "tool", parentId: randomUUID() } })).status()).toBe(409);
  expect((await (await request.get(path, { headers })).json()).name).toBe("original");
  expect((await request.post(path + "/end", { headers, data: { status: "cancelled" } })).status()).toBe(200);
  expect((await request.post(path + "/end", { headers, data: { status: "success" } })).status()).toBe(409);
});

test("Agent SDK joins streaming and nonstreaming model calls without double counting", async ({ request, page }) => {
  const sdk = createTraceClient({ gatewayUrl: gateway, apiKey: "e2e-local-key" });
  const runId = await sdk.startRun({ name: "SDK aggregate" });
  const parentId = await sdk.startSpan(runId, { name: "workflow", type: "workflow" });
  for (const stream of [false, true]) {
    const response = await request.post(gateway + "/v1/chat/completions", { headers: { ...headers, "X-TraceForge-Agent-Run-Id": runId, "X-TraceForge-Parent-Span-Id": parentId }, data: { model: "mock-ok", stream, messages: [{ role: "user", content: "hello" }] } });
    expect(response.status()).toBe(200);
    await response.text();
  }
  await sdk.endSpan(runId, parentId, { output: "finished" });
  await sdk.endRun(runId, { output: "draft" });
  const trace = await (await request.get(gateway + "/api/traces/runs/" + runId, { headers })).json();
  expect(trace.status).toBe("success");
  expect(trace.totalTokens).toBe(12);
  expect(trace.cost).toBeCloseTo(0.000018, 10);
  expect(trace.spans.filter((s: { type: string; parentId: string }) => s.type === "llm" && s.parentId === parentId)).toHaveLength(2);
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("smoke@example.com");
  await page.getByLabel("密码", { exact: true }).fill("e2e-local-password");
  await page.getByRole("button", { name: "进入追踪控制台" }).click();
  await expect(page).toHaveURL(/\/traces$/);
  await page.goto("/traces/" + runId);
  await expect(page.getByRole("heading", { name: /^SDK aggregate ·/ })).toBeVisible();
  await expect(page.getByText("workflow", { exact: true }).first()).toBeVisible();
});

test("LLM Judge uses a second model call and includes its cost", async ({ page }) => {
  const dataset = await db.evalDataset.create({ data: { projectId: "00000000-0000-0000-0000-000000000001", name: "Real judge contract", cases: { create: { input: "Greet the reader", expectedOutput: "a friendly greeting", assertionType: "llm_judge", assertionConfig: { rubric: "semantic greeting", threshold: 0.8 }, tags: [] } } } });
  await page.goto("/login");
  await page.getByLabel("邮箱", { exact: true }).fill("smoke@example.com");
  await page.getByLabel("密码", { exact: true }).fill("e2e-local-password");
  await page.getByRole("button", { name: "进入追踪控制台" }).click();
  await expect(page).toHaveURL(/\/traces$/);
  await page.goto("/evals/" + dataset.id);
  const form = page.locator("form").filter({ has: page.locator('select[name="promptVersionId"]') }).first();
  await form.locator('[name="promptVersionId"]').selectOption("00000000-0000-0000-0000-000000000502");
  await form.locator('[name="modelConfigId"]').selectOption("00000000-0000-0000-0000-000000000031");
  await form.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/evals\/runs\//);
  await expect(page.getByText("mock semantic judgement", { exact: true })).toBeVisible();
  await expect(page.locator(".summary-cell").filter({ has: page.locator("small", { hasText: "成本" }) }).locator("strong")).toHaveText("0.00001800");
});

for (const [rubric, reason] of [["[mock-invalid-judge]", "模型评审未返回有效的 JSON score/reason。"], ["[mock-judge-timeout]", "网关执行失败或超时"]]) {
  test("LLM Judge surfaces " + rubric + " without keyword fallback", async ({ page }) => {
    const dataset = await db.evalDataset.create({ data: { projectId: "00000000-0000-0000-0000-000000000001", name: "Judge failure", cases: { create: { input: "hello", expectedOutput: "hello", assertionType: "llm_judge", assertionConfig: { rubric, pass_keywords: ["hello"] }, tags: [] } } } });
    await page.goto("/login");
    await page.getByLabel("邮箱", { exact: true }).fill("smoke@example.com");
    await page.getByLabel("密码", { exact: true }).fill("e2e-local-password");
    await page.getByRole("button", { name: "进入追踪控制台" }).click();
    await expect(page).toHaveURL(/\/traces$/);
    await page.goto("/evals/" + dataset.id);
    const form = page.locator("form").filter({ has: page.locator('select[name="promptVersionId"]') }).first();
    await form.locator('[name="promptVersionId"]').selectOption("00000000-0000-0000-0000-000000000502");
    await form.locator('[name="modelConfigId"]').selectOption("00000000-0000-0000-0000-000000000031");
    await form.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/evals\/runs\//);
    await expect(page.getByText(reason, { exact: false }).first()).toBeVisible();
    await expect(page.locator(".page-head .badge")).toHaveText("失败");
  });
}
