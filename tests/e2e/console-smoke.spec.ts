import { expect, test } from "@playwright/test";

test("anonymous visitors see login before entering TraceRuns", async ({ page }) => {
  await page.goto("/traces");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "登录控制台" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "邮箱" })).toBeVisible();
  await expect(page.getByLabel("密码", { exact: true })).toBeVisible();
});

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "邮箱" }).fill("smoke@example.com");
  await page.getByLabel("密码", { exact: true }).fill("e2e-local-password");
  await page.getByRole("button", { name: "进入追踪控制台" }).click();
  await expect(page).toHaveURL(/\/traces$/);
}

test("administrator can enter the database-backed Console and sign out", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("combobox", { name: "项目", exact: true }).first())
    .toContainText("Playwright baseline");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/traces");
  await expect(page).toHaveURL(/\/login$/);
});

test("incorrect credentials cannot open the protected Console", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "邮箱" }).fill("smoke@example.com");
  await page.getByLabel("密码", { exact: true }).fill("incorrect-e2e-password");
  await page.getByRole("button", { name: "进入追踪控制台" }).click();
  await expect(page.getByText("邮箱或密码不匹配。", { exact: true })).toBeVisible();
  await page.goto("/traces");
  await expect(page).toHaveURL(/\/login$/);
});

test("sidebar collapse survives a page reload", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "收起侧边栏", exact: true }).click();
  await expect(page.getByRole("button", { name: "展开侧边栏", exact: true })).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(page.getByRole("button", { name: "展开侧边栏", exact: true })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "展开侧边栏", exact: true }).click();
  await expect(page.getByRole("button", { name: "收起侧边栏", exact: true })).toHaveAttribute("aria-expanded", "true");
});

test("real Gateway proxies to the mock upstream over HTTP", async ({ request }) => {
  const response = await request.post("http://127.0.0.1:" + process.env.TRACEFORGE_E2E_GATEWAY_PORT + "/v1/chat/completions", {
    headers: { authorization: "Bearer e2e-local-key" },
    data: { model: "mock-ok", messages: [{ role: "user", content: "smoke test" }] },
  });
  expect(response.ok()).toBeTruthy();
  const result = await response.json();
  expect(result.choices[0].message.content).toBe("hello from mock");
});


test("Base UI navigation and global search work with the keyboard", async ({ page }) => {
  await login(page);
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "治理总览", exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("combobox", { name: "搜索项目", exact: true }).selectOption({ label: "Demo Project" });
  await page.getByRole("textbox", { name: "全局搜索", exact: true }).fill("demo-run-20");
  await page.getByRole("textbox", { name: "全局搜索", exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/traces\?/);
  expect(new URL(page.url()).searchParams.get("model")).toBe("demo-run-20");
  expect(new URL(page.url()).searchParams.get("projectId")).toBeTruthy();
  await expect(page.getByRole("heading", { name: "追踪运行", exact: true })).toBeVisible();
  await expect(page.locator('.tf-run-list')).toContainText("demo-run-20");
  await expect(page.locator(".tf-run-list").getByRole("link")).toHaveCount(1);
});
