import { readPendingReceipt } from "@/lib/auth";
import { gatewayConfig } from "@/lib/env";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/validation";
import Link from "next/link";
import { TraceStatus, type Prisma } from "@prisma/client";
import {
  compactId,
  formatDate,
  formatFullDate,
  formatMoney,
  formatMs,
  formatNumber,
} from "@/lib/format";
import { getConsoleDb } from "@/lib/dal";
import {
  type ResponsibilityDomain,
  responsibilityDescription,
  responsibilityFor,
  responsibilityForRun,
} from "@/lib/responsibility";
import { TraceAutoRefresh } from "./auto-refresh";

export const dynamic = "force-dynamic";

type TraceRunDetail = Prisma.TraceRunGetPayload<{
  include: {
    project: true;
    promptVersion: {
      include: {
        prompt: {
          include: {
            activeVersion: true;
          };
        };
      };
    };
    spans: {
      include: {
        events: true;
      };
    };
  };
}>;

type SpanWithEvents = TraceRunDetail["spans"][number];
type SpanNode = SpanWithEvents & { children: SpanNode[] };
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const DOMAIN_CLASS: Record<ResponsibilityDomain, string> = {
  模型: "model",
  网络: "network",
  限流: "limit",
  工具: "tool",
  业务: "business",
  网关拒绝: "gateway",
};

function badgeClass(value: string | null | undefined) {
  return value ? `badge ${value}` : "badge";
}

function statusLabel(status: string | null | undefined) {
  if (status === "success") return "成功";
  if (status === "running") return "运行中";
  if (status === "failed") return "失败";
  if (status === "cancelled") return "已取消";
  return status ?? "未知";
}

function spanTypeLabel(type: string) {
  if (type === "llm") return "模型";
  if (type === "tool") return "工具";
  if (type === "workflow") return "流程";
  if (type === "gateway") return "网关";
  return type;
}

function usageSourceLabel(source: string | null | undefined) {
  if (source === "provider") return "供应商";
  if (source === "estimated") return "估算";
  return source ?? "—";
}

function eventTypeLabel(type: string) {
  if (type === "fallback_triggered") return "触发备用切换";
  if (type === "fallback_failed") return "备用切换失败";
  if (type === "stream_interrupted") return "流式中断";
  if (type === "first_token") return "首个 Token";
  if (type === "stream_end") return "流式结束";
  return type;
}

function domainBadge(domain: ResponsibilityDomain | null) {
  if (!domain) return null;
  return (
    <span className={`badge ${DOMAIN_CLASS[domain]}`} title={responsibilityDescription(domain)}>
      {domain}
    </span>
  );
}

function jsonText(value: Prisma.JsonValue | null) {
  if (value === null || value === undefined) return "—";
  return JSON.stringify(value, null, 2);
}

function duration(span: SpanWithEvents) {
  if (span.latencyMs !== null && span.latencyMs !== undefined) return span.latencyMs;
  if (!span.endedAt) return 0;
  return Math.max(0, span.endedAt.getTime() - span.startedAt.getTime());
}

function costNumber(span: SpanWithEvents) {
  return span.cost ? Number(span.cost.toString()) : 0;
}

function buildTree(spans: SpanWithEvents[]) {
  const nodes = spans.map((span) => ({ ...span, children: [] as SpanNode[] }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots: SpanNode[] = [];

  for (const node of nodes) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function SpanCard({
  node,
  slowestId,
  costliestId,
}: {
  node: SpanNode;
  slowestId: string | null;
  costliestId: string | null;
}) {
  const failed = node.status === TraceStatus.failed || node.status === TraceStatus.cancelled;
  const domain = responsibilityFor(node.errorCode, node.type);

  return (
    <details className={`span-item ${failed ? node.status : ""}`} open>
      <summary className="span-summary">
        <span className="span-title">
          <strong>{node.name}</strong>
          <span className="badge">{spanTypeLabel(node.type)}</span>
          <span className={badgeClass(node.status)}>{statusLabel(node.status)}</span>
          {node.errorCode ? <code>{node.errorCode}</code> : null}
          {domainBadge(domain)}
          {node.id === slowestId ? <span className="badge slowest">最慢</span> : null}
          {node.id === costliestId ? <span className="badge costliest">最高成本</span> : null}
        </span>
        <span className="muted">{compactId(node.id)}</span>
      </summary>
      <div className="span-body">
        <div className="kv-grid">
          <div className="kv">
            <small>模型</small>
            <strong>{node.model ?? "—"}</strong>
          </div>
          <div className="kv">
            <small>供应商</small>
            <strong>{node.provider ?? "—"}</strong>
          </div>
          <div className="kv">
            <small>延迟</small>
            <strong>{formatMs(node.latencyMs)}</strong>
          </div>
          <div className="kv">
            <small>成本</small>
            <strong>{formatMoney(node.cost)}</strong>
          </div>
          <div className="kv">
            <small>提示词令牌</small>
            <strong>{formatNumber(node.promptTokens)}</strong>
          </div>
          <div className="kv">
            <small>补全令牌</small>
            <strong>{formatNumber(node.completionTokens)}</strong>
          </div>
          <div className="kv">
            <small>用量来源</small>
            <strong>{usageSourceLabel(node.usageSource)}</strong>
          </div>
          <div className="kv">
            <small>开始时间</small>
            <strong>{formatDate(node.startedAt)}</strong>
          </div>
        </div>

        {node.error ? (
          <div className="section-band">
            <h3>错误摘要</h3>
            <p>{node.error}</p>
          </div>
        ) : null}

        <div className="preview-grid">
          <div>
            <h3>输入预览</h3>
            <pre>{node.inputPreview ?? "—"}</pre>
          </div>
          <div>
            <h3>输出预览</h3>
            <pre>{node.outputPreview ?? "—"}</pre>
          </div>
        </div>

        <div>
          <h3>事件</h3>
          {node.events.length === 0 ? (
            <p className="muted">这个调用跨度没有追踪事件。</p>
          ) : (
            <div className="event-list">
              {node.events.map((event) => (
                <div className="event-row" key={event.id}>
                  <div>
                    <strong>{eventTypeLabel(event.type)}</strong>
                    <small className="muted">{formatDate(event.createdAt)}</small>
                  </div>
                  <pre>{jsonText(event.payload)}</pre>
                </div>
              ))}
            </div>
          )}
        </div>

        {node.children.length > 0 ? (
          <div className="span-children">
            {node.children.map((child) => (
              <SpanCard key={child.id} node={child} slowestId={slowestId} costliestId={costliestId} />
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function Waterfall({
  spans,
  slowestId,
  costliestId,
}: {
  spans: SpanWithEvents[];
  slowestId: string | null;
  costliestId: string | null;
}) {
  if (spans.length === 0) {
    return <p className="muted">没有调用跨度可绘制瀑布。</p>;
  }

  const starts = spans.map((span) => span.startedAt.getTime());
  const ends = spans.map((span) => span.endedAt?.getTime() ?? span.startedAt.getTime() + Math.max(duration(span), 1));
  const minStart = Math.min(...starts);
  const total = Math.max(1, Math.max(...ends) - minStart);

  return (
    <div className="waterfall">
      {spans.map((span) => {
        const left = ((span.startedAt.getTime() - minStart) / total) * 100;
        const width = Math.max(1, (Math.max(duration(span), 1) / total) * 100);
        const failed = span.status === TraceStatus.failed || span.status === TraceStatus.cancelled;
        const classes = [
          "waterfall-bar",
          failed ? "failed" : "",
          span.id === slowestId ? "slowest" : "",
          span.id === costliestId ? "costliest" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <div className="waterfall-row" key={span.id}>
            <span className="meta-stack">
              <strong>{span.name}</strong>
              <small className="muted">{span.model ?? span.type}</small>
            </span>
            <div className="waterfall-track" aria-label={`${span.name} 耗时 ${formatMs(duration(span))}`}>
              <span className={classes} style={{ left: `${left}%`, width: `${width}%` }} />
            </div>
            <span>{formatMs(duration(span))}</span>
          </div>
        );
      })}
    </div>
  );
}

export default async function TraceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const prisma = await getConsoleDb();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const rawParams = await searchParams;
  const pendingDeadline = readPendingReceipt(one(rawParams.pending), id);
  const pending = pendingDeadline !== null;
  const pendingExpired = pendingDeadline !== null && new Date().getTime() >= pendingDeadline;
  let run: TraceRunDetail | null = null;

  run = await prisma.traceRun.findUnique({
    where: { id },
    include: {
      project: true,
      promptVersion: {
        include: {
          prompt: {
            include: {
              activeVersion: true,
            },
          },
        },
      },
      spans: {
        include: {
          events: { orderBy: { createdAt: "asc" } },
        },
        orderBy: { startedAt: "asc" },
      },
    },
  });


  if (!run) {
    if (pending) {
      return (
        <main>
          <Link className="back-link" href="/traces">
            返回追踪运行
          </Link>
          <section className="empty-state">
            <p className="eyebrow">追踪运行待接收</p>
            <h1>{pendingExpired ? "未确认派发" : "正在等待网关接受请求"}</h1>
            <p className="muted">
              控制台已经预声明运行 ID：{id}。如果网关接受请求，这里会自动切换到运行中的追踪运行。
            </p>
            <TraceAutoRefresh deadline={pendingDeadline!} />
          </section>
        </main>
      );
    }

    notFound();
  }

  const domain = responsibilityForRun(run);
  const shouldRefresh = run.status === TraceStatus.running;
  let refreshDeadline = run.startedAt.getTime() + 45_000;
  try { refreshDeadline = pendingDeadline ?? run.startedAt.getTime() + gatewayConfig("CHAT").timeoutMs + 15_000; } catch { /* Persisted runs remain readable without Chat configuration. */ }
  const tree = buildTree(run.spans);
  const slowest = run.spans.reduce<SpanWithEvents | null>(
    (current, span) => (!current || duration(span) > duration(current) ? span : current),
    null,
  );
  const costliest = run.spans.filter((span) => span.cost !== null).reduce<SpanWithEvents | null>(
    (current, span) => (!current || costNumber(span) > costNumber(current) ? span : current),
    null,
  );

  return (
    <main>
      <Link className="back-link" href="/traces">
        返回追踪运行
      </Link>
      <header className="page-head">
        <div>
          <p className="eyebrow">追踪运行详情</p>
          <h1>
            {run.name ?? "unnamed"} · {compactId(run.id)}
          </h1>
          <p className="muted">{run.project.name} · {run.id}</p>
        </div>
        <span className={badgeClass(run.status)}>{statusLabel(run.status)}</span>
      </header>

      {shouldRefresh ? (
        <section className="section-band domain-note">
          <h2>调用仍在进行</h2>
          <p className="muted">追踪运行还没有进入终态，页面会自动刷新直到成功、失败或取消。</p>
          <TraceAutoRefresh deadline={refreshDeadline} />
        </section>
      ) : null}

      <section className="summary-grid" aria-label="运行摘要">
        <div className="summary-cell">
          <small>错误码</small>
          <strong>{run.errorCode ?? "—"}</strong>
        </div>
        <div className="summary-cell">
          <small>责任域</small>
          <strong>{domainBadge(domain) ?? "—"}</strong>
        </div>
        <div className="summary-cell">
          <small>延迟</small>
          <strong>{formatMs(run.latencyMs)}</strong>
        </div>
        <div className="summary-cell">
          <small>总令牌</small>
          <strong>{formatNumber(run.totalTokens)}</strong>
        </div>
        <div className="summary-cell">
          <small>成本</small>
          <strong>{formatMoney(run.cost)}</strong>
        </div>
        <div className="summary-cell">
          <small>用量来源</small>
          <strong>{usageSourceLabel(run.usageSource)}</strong>
        </div>
        <div className="summary-cell">
          <small>开始时间</small>
          <strong>{formatFullDate(run.startedAt)}</strong>
        </div>
        <div className="summary-cell">
          <small>结束时间</small>
          <strong>{formatFullDate(run.endedAt)}</strong>
        </div>
      </section>

      {run.spans.length === 0 && domain ? (
        <section className="section-band domain-note">
          <h2>网关层拒绝</h2>
          <p>{responsibilityDescription(domain)}</p>
        </section>
      ) : null}

      <div className="detail-grid">
        <section className="section">
          <h2>调用树</h2>
          {tree.length === 0 ? (
            <div className="empty-state">
              <h3>{run.status === TraceStatus.running ? "等待上游调用跨度写入" : "这个运行没有上游调用跨度"}</h3>
              <p className="muted">
                {run.status === TraceStatus.running ? "网关已接受请求，完成后会补齐调用跨度和输出证据。" : "这通常是鉴权、撤销 Key 或限流等网关层拒绝。"}
              </p>
            </div>
          ) : (
            <div className="span-list">
              {tree.map((node) => (
                <SpanCard key={node.id} node={node} slowestId={slowest?.id ?? null} costliestId={costliest?.id ?? null} />
              ))}
            </div>
          )}
        </section>

        <aside className="section">
          <section className="section-band">
            <h2>提示词版本</h2>
            {run.promptVersion ? (
              <div className="meta-stack">
                <Link className="row-link" href={`/prompts/${run.promptVersion.prompt.id}?compare=${run.promptVersion.version}`}>
                  {run.promptVersion.prompt.name} · v{run.promptVersion.version}
                </Link>
                <span>
                  <span className={`badge ${run.promptVersion.prompt.activeVersionId === run.promptVersion.id ? "provider" : ""}`}>
                    {run.promptVersion.prompt.activeVersionId === run.promptVersion.id ? "现行" : run.promptVersion.status}
                  </span>
                </span>
                <small className="muted">追踪运行提示词版本编号 = {run.promptVersion.id}</small>
              </div>
            ) : (
              <p className="muted">这个运行没有关联提示词版本。</p>
            )}
          </section>
          <section className="section-band">
            <h2>瀑布图</h2>
            <Waterfall spans={run.spans} slowestId={slowest?.id ?? null} costliestId={costliest?.id ?? null} />
          </section>
          <section className="section-band">
            <h2>运行预览</h2>
            <div className="preview-grid single">
              <div>
                <h3>输入预览</h3>
                <pre>{run.inputPreview ?? "—"}</pre>
              </div>
              <div>
                <h3>输出预览</h3>
                <pre>{run.outputPreview ?? "—"}</pre>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
