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
import { prisma } from "@/lib/prisma";
import {
  type ResponsibilityDomain,
  responsibilityDescription,
  responsibilityFor,
  responsibilityForRun,
} from "@/lib/responsibility";

export const dynamic = "force-dynamic";

type TraceRunDetail = Prisma.TraceRunGetPayload<{
  include: {
    project: true;
    spans: {
      include: {
        events: true;
      };
    };
  };
}>;

type SpanWithEvents = TraceRunDetail["spans"][number];
type SpanNode = SpanWithEvents & { children: SpanNode[] };

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
          <span className="badge">{node.type}</span>
          <span className={badgeClass(node.status)}>{node.status}</span>
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
            <small>Model</small>
            <strong>{node.model ?? "—"}</strong>
          </div>
          <div className="kv">
            <small>Provider</small>
            <strong>{node.provider ?? "—"}</strong>
          </div>
          <div className="kv">
            <small>Latency</small>
            <strong>{formatMs(node.latencyMs)}</strong>
          </div>
          <div className="kv">
            <small>Cost</small>
            <strong>{formatMoney(node.cost)}</strong>
          </div>
          <div className="kv">
            <small>Prompt Tokens</small>
            <strong>{formatNumber(node.promptTokens)}</strong>
          </div>
          <div className="kv">
            <small>Completion Tokens</small>
            <strong>{formatNumber(node.completionTokens)}</strong>
          </div>
          <div className="kv">
            <small>Usage Source</small>
            <strong>{node.usageSource ?? "—"}</strong>
          </div>
          <div className="kv">
            <small>Started</small>
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
            <h3>Input Preview</h3>
            <pre>{node.inputPreview ?? "—"}</pre>
          </div>
          <div>
            <h3>Output Preview</h3>
            <pre>{node.outputPreview ?? "—"}</pre>
          </div>
        </div>

        <div>
          <h3>Events</h3>
          {node.events.length === 0 ? (
            <p className="muted">这个 Span 没有 TraceEvent。</p>
          ) : (
            <div className="event-list">
              {node.events.map((event) => (
                <div className="event-row" key={event.id}>
                  <div>
                    <strong>{event.type}</strong>
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
    return <p className="muted">没有 Span 可绘制瀑布。</p>;
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
            <div className="waterfall-track" aria-label={`${span.name} duration ${formatMs(duration(span))}`}>
              <span className={classes} style={{ left: `${left}%`, width: `${width}%` }} />
            </div>
            <span>{formatMs(duration(span))}</span>
          </div>
        );
      })}
    </div>
  );
}

export default async function TraceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let run: TraceRunDetail | null = null;
  let readError: string | null = null;

  try {
    run = await prisma.traceRun.findUnique({
      where: { id },
      include: {
        project: true,
        spans: {
          include: {
            events: { orderBy: { createdAt: "asc" } },
          },
          orderBy: { startedAt: "asc" },
        },
      },
    });
  } catch (error) {
    console.error(error);
    readError = "无法读取 TraceRun 详情。请确认数据库连接和迁移状态。";
  }

  if (readError) {
    return (
      <main>
        <Link className="back-link" href="/traces">
          返回 TraceRuns
        </Link>
        <section className="error-state" role="alert">
          <h1>读取失败</h1>
          <p>{readError}</p>
        </section>
      </main>
    );
  }

  if (!run) {
    return (
      <main>
        <Link className="back-link" href="/traces">
          返回 TraceRuns
        </Link>
        <section className="empty-state">
          <h1>没有找到这个 TraceRun</h1>
          <p className="muted">Run 可能已被清理，或 URL 中的 id 不属于当前数据库。</p>
        </section>
      </main>
    );
  }

  const domain = responsibilityForRun(run);
  const tree = buildTree(run.spans);
  const slowest = run.spans.reduce<SpanWithEvents | null>(
    (current, span) => (!current || duration(span) > duration(current) ? span : current),
    null,
  );
  const costliest = run.spans.reduce<SpanWithEvents | null>(
    (current, span) => (!current || costNumber(span) > costNumber(current) ? span : current),
    null,
  );

  return (
    <main>
      <Link className="back-link" href="/traces">
        返回 TraceRuns
      </Link>
      <header className="page-head">
        <div>
          <p className="eyebrow">TraceRun Detail</p>
          <h1>
            {run.name ?? "unnamed"} · {compactId(run.id)}
          </h1>
          <p className="muted">{run.project.name} · {run.id}</p>
        </div>
        <span className={badgeClass(run.status)}>{run.status}</span>
      </header>

      <section className="summary-grid" aria-label="Run 摘要">
        <div className="summary-cell">
          <small>Error Code</small>
          <strong>{run.errorCode ?? "—"}</strong>
        </div>
        <div className="summary-cell">
          <small>责任域</small>
          <strong>{domainBadge(domain) ?? "—"}</strong>
        </div>
        <div className="summary-cell">
          <small>Latency</small>
          <strong>{formatMs(run.latencyMs)}</strong>
        </div>
        <div className="summary-cell">
          <small>Total Tokens</small>
          <strong>{formatNumber(run.totalTokens)}</strong>
        </div>
        <div className="summary-cell">
          <small>Cost</small>
          <strong>{formatMoney(run.cost)}</strong>
        </div>
        <div className="summary-cell">
          <small>Usage Source</small>
          <strong>{run.usageSource ?? "—"}</strong>
        </div>
        <div className="summary-cell">
          <small>Started</small>
          <strong>{formatFullDate(run.startedAt)}</strong>
        </div>
        <div className="summary-cell">
          <small>Ended</small>
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
          <h2>Span Tree</h2>
          {tree.length === 0 ? (
            <div className="empty-state">
              <h3>这个 Run 没有上游 Span</h3>
              <p className="muted">这通常是鉴权、撤销 Key 或限流等网关层拒绝。</p>
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
            <h2>Waterfall</h2>
            <Waterfall spans={run.spans} slowestId={slowest?.id ?? null} costliestId={costliest?.id ?? null} />
          </section>
          <section className="section-band">
            <h2>Run Preview</h2>
            <div className="preview-grid single">
              <div>
                <h3>Input Preview</h3>
                <pre>{run.inputPreview ?? "—"}</pre>
              </div>
              <div>
                <h3>Output Preview</h3>
                <pre>{run.outputPreview ?? "—"}</pre>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
