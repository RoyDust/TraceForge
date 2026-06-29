// PRD #44 verification: Chat Playground -> Gateway -> TraceRun lifecycle.
// Requires Console on :3000, Gateway on :8787, mock upstream on :8799.
import "dotenv/config";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const GATEWAY_URL = process.env.TRACEFORGE_CHAT_GATEWAY_URL ?? "http://localhost:8787";
const CONSOLE_URL = process.env.TRACEFORGE_CHAT_CONSOLE_URL ?? "http://localhost:3000";
const VERIFY_KEY = "tf-chat-verify-key";
const RATE_LIMIT_KEY = "tf-chat-rate-limit-key";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function adminCookie() {
  const email = process.env.ADMIN_EMAIL;
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  if (!email || !passwordHash || !process.env.DATABASE_URL) {
    throw new Error("ADMIN_EMAIL, ADMIN_PASSWORD_HASH, and DATABASE_URL are required.");
  }
  const payload = base64url(JSON.stringify({ email, exp: Date.now() + 60 * 60 * 1000 }));
  const signature = createHmac("sha256", `${passwordHash}:${process.env.DATABASE_URL}`).update(payload).digest("base64url");
  return `traceforge_admin=${payload}.${signature}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForRun(prisma, id, predicate, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await prisma.traceRun.findUnique({
      where: { id },
      include: { spans: { include: { events: true } } },
    });
    if (last && predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`${label} timed out; last=${last ? JSON.stringify({ id: last.id, status: last.status, errorCode: last.errorCode }) : "null"}`);
}

async function gatewayChat({ runId, model = "mock-ok", stream = false, key = VERIFY_KEY, messages = [{ role: "user", content: "verify chat" }] }) {
  return fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "X-TraceForge-Run-Id": runId,
    },
    body: JSON.stringify({ model, stream, messages }),
  });
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const schema = new URL(process.env.DATABASE_URL).searchParams.get("schema") ?? undefined;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }, schema ? { schema } : undefined),
  });

  await prisma.apiKey.upsert({
    where: { keyHash: sha256(VERIFY_KEY) },
    update: { status: "active", revokedAt: null, rpmLimit: 60, concurrencyLimit: 10 },
    create: {
      projectId: PROJECT_ID,
      name: "chat playground verify",
      keyHash: sha256(VERIFY_KEY),
      scope: ["gateway"],
      rpmLimit: 60,
      concurrencyLimit: 10,
    },
  });
  await prisma.apiKey.upsert({
    where: { keyHash: sha256(RATE_LIMIT_KEY) },
    update: { status: "active", revokedAt: null, rpmLimit: 0, concurrencyLimit: 10 },
    create: {
      projectId: PROJECT_ID,
      name: "chat playground rate-limit verify",
      keyHash: sha256(RATE_LIMIT_KEY),
      scope: ["gateway"],
      rpmLimit: 0,
      concurrencyLimit: 10,
    },
  });

  const cookie = adminCookie();
  const gatewayHealth = await fetch(`${GATEWAY_URL}/healthz`);
  assert(gatewayHealth.ok, "Gateway /healthz must be reachable.");
  const consoleLogin = await fetch(`${CONSOLE_URL}/login`);
  assert(consoleLogin.ok, "Console /login must be reachable.");

  const unauthDispatch = await fetch(`${CONSOLE_URL}/chat/dispatch`, { method: "POST" });
  assert(unauthDispatch.status === 401, "Unauthenticated /chat/dispatch should return 401.");

  const missingId = randomUUID();
  const pendingPage = await fetch(`${CONSOLE_URL}/traces/${missingId}?pending=1`, { headers: { cookie } }).then((r) => r.text());
  assert(pendingPage.includes("正在等待 Gateway 接受请求"), "pending=1 missing TraceRun should show waiting state.");
  const missingPage = await fetch(`${CONSOLE_URL}/traces/${missingId}`, { headers: { cookie } }).then((r) => r.text());
  assert(missingPage.includes("没有找到这个 TraceRun"), "Missing TraceRun without pending should show not-found.");

  const chatPage = await fetch(`${CONSOLE_URL}/chat`, { headers: { cookie } }).then((r) => r.text());
  assert(chatPage.includes("对话测试"), "/chat should render for an authenticated admin.");
  assert(chatPage.includes("Mock Upstream"), "/chat should list active mock models.");

  const malformedMessages = await fetch(`${CONSOLE_URL}/chat/dispatch`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ model: "mock-ok", stream: false, messages: [{ role: "user" }] }),
  });
  assert(malformedMessages.status === 400, "Console dispatch should reject messages without content.");

  const unavailableModel = await fetch(`${CONSOLE_URL}/chat/dispatch`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ model: "missing-model", stream: false, messages: [{ role: "user", content: "x" }] }),
  });
  assert(unavailableModel.status === 400, "Console dispatch should reject unavailable models.");

  const malformed = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${VERIFY_KEY}`,
      "content-type": "application/json",
      "X-TraceForge-Run-Id": "not-a-uuid",
    },
    body: JSON.stringify({ model: "mock-ok", stream: false, messages: [{ role: "user", content: "bad header" }] }),
  });
  assert(malformed.status === 400, "Malformed X-TraceForge-Run-Id should return 400.");

  const directRunId = randomUUID();
  const direct = await gatewayChat({ runId: directRunId });
  assert(direct.status === 200, "Predeclared non-stream Gateway request should succeed.");
  assert(direct.headers.get("x-traceforge-run-id") === directRunId, "Gateway should echo X-TraceForge-Run-Id.");
  await direct.arrayBuffer();
  const directRun = await waitForRun(prisma, directRunId, (run) => run.status === "success", "direct non-stream success");
  assert(directRun.outputPreview?.includes("hello from mock"), "Direct TraceRun should contain mock output preview.");

  const spanCountBeforeDuplicate = directRun.spans.length;
  const duplicate = await gatewayChat({ runId: directRunId });
  assert(duplicate.status === 409, "Duplicate X-TraceForge-Run-Id should return 409.");
  const afterDuplicate = await prisma.traceRun.findUnique({ where: { id: directRunId }, include: { spans: true } });
  assert(afterDuplicate?.status === "success", "Duplicate request must not change existing Run status.");
  assert(afterDuplicate.spans.length === spanCountBeforeDuplicate, "Duplicate request must not append spans to existing Run.");

  const slowRunId = randomUUID();
  const slowPromise = gatewayChat({ runId: slowRunId, model: "mock-slow", stream: true }).then(async (response) => {
    await response.arrayBuffer().catch(() => null);
    return response.status;
  });
  const runningRun = await waitForRun(prisma, slowRunId, (run) => run.status === "running", "stream running state", 4000);
  assert(runningRun.endedAt === null, "Running TraceRun should not have endedAt.");
  const slowStatus = await slowPromise;
  assert(slowStatus === 200, "Slow stream Gateway response should be HTTP 200.");
  await waitForRun(prisma, slowRunId, (run) => run.status !== "running", "slow stream terminal state", 18000);

  const providerFailRunId = randomUUID();
  const providerFail = await gatewayChat({ runId: providerFailRunId, model: "mock-fail-alone" });
  assert(providerFail.status === 502, "Provider failure should return 502.");
  await providerFail.arrayBuffer();
  const providerFailRun = await waitForRun(prisma, providerFailRunId, (run) => run.status === "failed", "provider failure TraceRun");
  assert(providerFailRun.errorCode === "upstream_error", "Provider failure should persist upstream_error.");
  assert(providerFailRun.spans.some((span) => span.status === "failed" && span.error), "Provider failure should persist failed Span error.");

  const rateLimitRunId = randomUUID();
  const rateLimited = await gatewayChat({ runId: rateLimitRunId, key: RATE_LIMIT_KEY });
  assert(rateLimited.status === 429, "Rate-limited key should return 429.");
  await rateLimited.arrayBuffer();
  const rateLimitRun = await waitForRun(prisma, rateLimitRunId, (run) => run.status === "failed", "rate-limit TraceRun");
  assert(rateLimitRun.errorCode === "rate_limited", "Rate-limit rejection should persist rate_limited on the predeclared Run.");

  const dispatchBody = {
    model: "mock-ok",
    stream: false,
    messages: [{ role: "user", content: "console non-stream verify" }],
  };
  const dispatch = await fetch(`${CONSOLE_URL}/chat/dispatch`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(dispatchBody),
  });
  assert(dispatch.status === 202, "Console non-stream dispatch should return 202.");
  const dispatchJson = await dispatch.json();
  assert(dispatchJson.traceUrl === `/traces/${dispatchJson.runId}?pending=1`, "Console dispatch should return pending TraceRun URL.");
  const consoleRun = await waitForRun(prisma, dispatchJson.runId, (run) => run.status === "success", "console non-stream success");
  assert(consoleRun.outputPreview?.includes("hello from mock"), "Console non-stream TraceRun should contain output preview.");

  const streamDispatch = await fetch(`${CONSOLE_URL}/chat/dispatch`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ ...dispatchBody, stream: true, messages: [{ role: "user", content: "console stream verify" }] }),
  });
  assert(streamDispatch.status === 202, "Console stream dispatch should return 202.");
  const streamJson = await streamDispatch.json();
  const streamRun = await waitForRun(prisma, streamJson.runId, (run) => run.status === "success", "console stream success");
  assert(streamRun.outputPreview?.includes("hello from mock"), "Console stream TraceRun should contain complete output preview.");

  await prisma.$disconnect();
  console.log("✅ Chat Playground verification passed.");
  console.log(`- Direct non-stream TraceRun: ${CONSOLE_URL}/traces/${directRunId}`);
  console.log(`- Running-first stream TraceRun: ${CONSOLE_URL}/traces/${slowRunId}`);
  console.log(`- Provider failure TraceRun: ${CONSOLE_URL}/traces/${providerFailRunId}`);
  console.log(`- Rate-limit TraceRun: ${CONSOLE_URL}/traces/${rateLimitRunId}`);
  console.log(`- Console non-stream TraceRun: ${CONSOLE_URL}/traces/${dispatchJson.runId}`);
  console.log(`- Console stream TraceRun: ${CONSOLE_URL}/traces/${streamJson.runId}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
