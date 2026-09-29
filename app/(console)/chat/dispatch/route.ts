import { randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import { getAdminSession, pendingReceipt } from "@/lib/auth";
import { gatewayConfig } from "@/lib/env";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 150;

export async function POST(request: Request) {
  if (!await getAdminSession()) return NextResponse.json({ error: "未登录。" }, { status: 401 });
  let config: ReturnType<typeof gatewayConfig>;
  try { config = gatewayConfig("CHAT"); } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "网关配置无效。" }, { status: 503 });
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 128_000) return NextResponse.json({ error: "请求体不能超过 128 KB。" }, { status: 413 });
    body = JSON.parse(text);
  } catch { return NextResponse.json({ error: "请求体不是合法 JSON。" }, { status: 400 }); }
  const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const model = typeof record.model === "string" ? record.model.trim() : "";
  const messages = record.messages;
  if (!model || model.length > 200 || !Array.isArray(messages) || !messages.length || messages.length > 100 || messages.some((item) => !item || !["system", "user", "assistant"].includes(item.role) || typeof item.content !== "string" || item.content.length > 32000) || (record.stream !== undefined && typeof record.stream !== "boolean")) {
    return NextResponse.json({ error: "model、messages 或 stream 无效（最多 100 条文本消息，每条 32000 字符）。" }, { status: 400 });
  }
  const modelConfig = await prisma.modelConfig.findFirst({ where: { modelName: model, status: "active", provider: { status: "active" } }, select: { id: true } });
  if (!modelConfig) return NextResponse.json({ error: "模型配置不可用。" }, { status: 400 });
  const runId = randomUUID();
  const deadline = Date.now() + config.timeoutMs + 10_000;
  const receipt = pendingReceipt(runId, deadline);
  after(async () => {
    try {
      const response = await fetch(config.url + "/v1/chat/completions", {
        method: "POST", headers: { authorization: "Bearer " + config.apiKey, "content-type": "application/json", "X-TraceForge-Run-Id": runId },
        body: JSON.stringify({ model, messages, stream: record.stream ?? false }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      const reader = response.body?.getReader();
      if (reader) { try { while (!(await reader.read()).done) { /* drain without buffering */ } } finally { reader.releaseLock(); } }
      if (!response.ok) console.error("[chat] dispatch rejected", { runId, status: response.status });
    } catch { console.error("[chat] dispatch unconfirmed or timed out", { runId }); }
  });
  return NextResponse.json({ runId, deadline, receipt, traceUrl: "/traces/" + runId + "?pending=" + encodeURIComponent(receipt) }, { status: 202 });
}
