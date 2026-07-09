import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "未登录。" }, { status: 401 });
  }

  const { id } = await params;
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
    return NextResponse.json({ run: null }, { status: 200 });
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
