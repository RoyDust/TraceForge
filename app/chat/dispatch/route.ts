import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TRACE_RUN_ID_HEADER = "X-TraceForge-Run-Id";

function gatewayUrl() {
  return (
    process.env.TRACEFORGE_CHAT_GATEWAY_URL?.trim() ||
    process.env.TRACEFORGE_EVAL_GATEWAY_URL?.trim() ||
    "http://localhost:8787"
  ).replace(/\/$/, "");
}

function validateMessages(value: unknown) {
  if (!Array.isArray(value)) return "messages 必须是数组。";
  if (value.length === 0) return "messages 至少需要一条消息。";
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return `messages[${index}] 必须是对象。`;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.role !== "string" || !record.role.trim()) {
      return `messages[${index}].role 不能为空。`;
    }
    if (!("content" in record)) {
      return `messages[${index}].content 必须存在。`;
    }
  }
  return null;
}

async function dispatchGateway({
  apiKey,
  runId,
  model,
  messages,
  stream,
}: {
  apiKey: string;
  runId: string;
  model: string;
  messages: unknown[];
  stream: boolean;
}) {
  const response = await fetch(`${gatewayUrl()}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      [TRACE_RUN_ID_HEADER]: runId,
    },
    body: JSON.stringify({ model, messages, stream }),
  });

  await response.arrayBuffer();
  if (!response.ok) {
    console.error(`[chat] Gateway dispatch failed run_id=${runId} status=${response.status}`);
  }
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "未登录。" }, { status: 401 });
  }

  const apiKey = process.env.TRACEFORGE_CHAT_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "缺少 TRACEFORGE_CHAT_API_KEY。" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON。" }, { status: 400 });
  }

  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const model = typeof record?.model === "string" ? record.model.trim() : "";
  const stream = typeof record?.stream === "boolean" ? record.stream : false;
  const messages = record?.messages;

  if (!model) {
    return NextResponse.json({ error: "缺少 model。" }, { status: 400 });
  }
  const validationError = validateMessages(messages);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const modelConfig = await prisma.modelConfig.findFirst({
    where: {
      modelName: model,
      status: "active",
      provider: { status: "active" },
    },
    select: { id: true },
  });
  if (!modelConfig) {
    return NextResponse.json({ error: "ModelConfig 不可用。" }, { status: 400 });
  }

  const runId = randomUUID();
  void dispatchGateway({
    apiKey,
    runId,
    model,
    messages: messages as unknown[],
    stream,
  }).catch((error) => {
    console.error(`[chat] Gateway dispatch failed run_id=${runId}`, error);
  });

  return NextResponse.json(
    {
      runId,
      traceUrl: `/traces/${runId}?pending=1`,
    },
    { status: 202 },
  );
}
