import { isUuid } from "@/lib/validation";
import { NextResponse } from "next/server";
import { getAdminSession, readPendingReceipt } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "未登录。" }, { status: 401 });
  }

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "运行 ID 无效。" }, { status: 400 });
  const deadline = readPendingReceipt(new URL(_request.url).searchParams.get("pending") ?? undefined, id);
  const run = await prisma.traceRun.findUnique({
    where: { id },
    include: {
      spans: {
        orderBy: { startedAt: "asc" },
        include: { events: { orderBy: { createdAt: "asc" } } },
      },
    },
  });

  if (!run) {
    return NextResponse.json({ run: null, error: deadline && Date.now() >= deadline ? "未确认派发，请核对运行 ID 后决定是否重新发送。" : deadline ? undefined : "运行不存在。" }, { status: deadline ? Date.now() >= deadline ? 410 : 200 : 404 });
  }

  const primarySpan = run.spans[0] ?? null;
  return NextResponse.json({
    run: {
      id: run.id,
      name: run.name,
      status: run.status,
      errorCode: run.errorCode,
      inputPreview: run.inputPreview,
      outputPreview: run.outputPreview,
      totalTokens: run.totalTokens,
      cost: run.cost?.toString() ?? null,
      latencyMs: run.latencyMs,
      usageSource: run.usageSource,
      startedAt: run.startedAt.toISOString(),
      endedAt: run.endedAt?.toISOString() ?? null,
      model: primarySpan?.model ?? run.name,
      provider: primarySpan?.provider ?? null,
      spanCount: run.spans.length,
      eventTypes: run.spans.flatMap((span) => span.events.map((event) => event.type)),
      error: primarySpan?.error ?? null,
    },
  });
}
