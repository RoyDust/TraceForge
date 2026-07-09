import Link from "next/link";
import { TraceEventType, TraceStatus, type Prisma } from "@prisma/client";
import {
  AlertTriangle,
  Clock3,
  Copy,
  ExternalLink,
  Filter,
  GitBranch,
  ListFilter,
  MessageCircle,
  MoreVertical,
  Search,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { compactId, formatDate, formatMoney, formatMs, formatNumber } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import {
  type ResponsibilityDomain,
  responsibilityDescription,
  responsibilityFor,
  responsibilityForRun,
} from "@/lib/responsibility";
import { deterministicNumber } from "@/lib/ui-mocks";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type ProjectRow = Prisma.ProjectGetPayload<Record<string, never>>;
type TraceRunRow = Prisma.TraceRunGetPayload<{
  include: {
    project: true;
    promptVersion: {
      include: {
        prompt: true;
      };
    };
    spans: {
      select: {
        id: true;
        type: true;
        status: true;
        errorCode: true;
        model: true;
        provider: true;
        latencyMs: true;
        cost: true;
      };
    };
  };
}>;
type TraceRunDetail = Prisma.TraceRunGetPayload<{
  include: {
    project: true;
    promptVersion: {
      include: {
        prompt: true;
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

const PAGE_SIZE = 18;
const STATUS_OPTIONS = new Set<string>(Object.values(TraceStatus));
const FALLBACK_EVENTS = new Set<TraceEventType>([
  TraceEventType.fallback_triggered,
  TraceEventType.fallback_failed,
]);
const DOMAIN_CLASS: Record<ResponsibilityDomain, string> = {
  模型: "model",
  网络: "network",
  限流: "limit",
  工具: "tool",
  业务: "business",
  网关拒绝: "gateway",
};

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseDate(value: string | undefined, endOfDay = false) {
  if (!value) return undefined;
  const candidate = endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999` : value;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function buildQuery(params: Record<string, string | undefined>, overrides: Record<string, string | number | null>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      query.set(key, String(value));
    }
  }
  const text = query.toString();
  return text ? `/traces?${text}` : "/traces";
}

function toNumber(value: { toString(): string } | string | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  const number = Number(value.toString());
  return Number.isFinite(number) ? number : 0;
}

function statusClass(status: string | null | undefined) {
  if (status === "success") return "success";
  if (status === "running") return "running";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return "neutral";
}

function statusLabel(status: string | null | undefined) {
  if (status === "success") return "成功";
  if (status === "running") return "运行中";
  if (status === "failed") return "失败";
  if (status === "cancelled") return "已取消";
  return "未知";
}

function eventTypeLabel(type: string) {
  if (type === "fallback_triggered") return "触发备用切换";
  if (type === "fallback_failed") return "备用切换失败";
  if (type === "stream_interrupted") return "流式中断";
  if (type === "first_token") return "首个 Token";
  if (type === "stream_end") return "流式结束";
  return type;
}

function reasonLabel(reason: string) {
  if (reason === "stream_interrupted") return "流式中断";
  if (reason === "upstream_closed") return "上游关闭";
  if (reason === "client_disconnect") return "客户端断开";
  return reason;
}

function spanTypeLabel(type: string) {
  if (type === "llm") return "模型";
  if (type === "tool") return "工具";
  if (type === "workflow") return "流程";
  if (type === "gateway") return "网关";
  return type;
}

function duration(span: SpanWithEvents) {
  if (span.latencyMs !== null && span.latencyMs !== undefined) return span.latencyMs;
  if (!span.endedAt) return 0;
  return Math.max(0, span.endedAt.getTime() - span.startedAt.getTime());
}

function costNumber(span: SpanWithEvents) {
  return span.cost ? Number(span.cost.toString()) : 0;
}

function displaySpan(run: TraceRunRow | TraceRunDetail) {
  return (
    run.spans.find((span) => span.errorCode || span.status === TraceStatus.failed || span.status === TraceStatus.cancelled) ??
    run.spans.find((span) => span.model || span.provider) ??
    null
  );
}

function traceLabel(id: string) {
  return `tr_${compactId(id).toUpperCase()}`;
}

function modelProvider(run: TraceRunRow | TraceRunDetail) {
  const span = displaySpan(run);
  return span ? `${span.provider ?? "网关"} / ${span.model ?? "未知"}` : "网关 / 策略";
}

function httpStatusFor(errorCode: string | null | undefined) {
  if (!errorCode) return "200 正常";
  if (errorCode.includes("rate")) return "429 已限流";
  if (errorCode.includes("key") || errorCode.includes("auth")) return "401 未授权";
  if (errorCode.includes("stream")) return "499 客户端关闭请求";
  if (errorCode.includes("timeout")) return "504 网关超时";
  return "500 上游错误";
}

function domainBadge(domain: ResponsibilityDomain | null) {
  if (!domain) return null;
  return (
    <Badge variant="outline" className={`tf-domain ${DOMAIN_CLASS[domain]}`} title={responsibilityDescription(domain)}>
      {domain}
    </Badge>
  );
}

function series(seed: string, count = 18) {
  return Array.from({ length: count }, (_, index) => deterministicNumber(`${seed}-${index}`, 18, 92));
}

function MiniSparkline({ seed, tone = "ok" }: { seed: string; tone?: "ok" | "danger" | "warning" }) {
  const points = series(seed, 20);
  const max = Math.max(...points);
  const min = Math.min(...points);
  const coords = points
    .map((value, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * 82;
      const y = 24 - ((value - min) / Math.max(max - min, 1)) * 20;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg className={`tf-mini-sparkline ${tone}`} viewBox="0 0 82 28" role="img" aria-label="趋势">
      <polyline points={coords} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function groupStats(rows: TraceRunRow[]) {
  const failed = rows.filter((run) => run.status === TraceStatus.failed || run.status === TraceStatus.cancelled).length;
  const running = rows.filter((run) => run.status === TraceStatus.running).length;
  const slow = rows.filter((run) => (run.latencyMs ?? 0) > 3000).length;
  return { failed, running, slow };
}

function providerHealth(rows: TraceRunRow[]) {
  const groups = new Map<
    string,
    {
      label: string;
      total: number;
      failed: number;
      latencies: number[];
    }
  >();

  for (const run of rows) {
    for (const span of run.spans) {
      const label = `${span.provider ?? "gateway"} / ${span.model ?? "unknown"}`;
      const group = groups.get(label) ?? { label, total: 0, failed: 0, latencies: [] };
      group.total += 1;
      if (span.status === TraceStatus.failed || span.errorCode) group.failed += 1;
      if (span.latencyMs !== null) group.latencies.push(span.latencyMs);
      groups.set(label, group);
    }
  }

  const derived = [...groups.values()].slice(0, 5).map((group) => {
    const p95 = group.latencies.length > 0 ? group.latencies.sort((a, b) => a - b)[Math.max(0, Math.ceil(group.latencies.length * 0.95) - 1)] : 0;
    return {
      label: group.label,
      successRate: group.total === 0 ? 100 : ((group.total - group.failed) / group.total) * 100,
      p95,
      errors: group.failed || deterministicNumber(`${group.label}-errors`, 3, 432),
    };
  });

  if (derived.length > 0) return derived;

  return ["OpenAI / gpt-4o", "DeepSeek / deepseek-chat", "Mock / mock-ok"].map((label) => ({
    label,
    successRate: deterministicNumber(`${label}-success`, 942, 999) / 10,
    p95: deterministicNumber(`${label}-p95`, 210, 2480),
    errors: deterministicNumber(`${label}-errors`, 3, 432),
  }));
}

function fallbackEvents(run: TraceRunDetail | null) {
  if (!run) return [];
  return run.spans.flatMap((span) =>
    span.events
      .filter((event) => FALLBACK_EVENTS.has(event.type) || event.type === TraceEventType.stream_error)
      .map((event) => ({ span, event })),
  );
}

function treeRows(spans: SpanWithEvents[]) {
  const byParent = new Map<string | null, SpanWithEvents[]>();
  for (const span of spans) {
    byParent.set(span.parentId, [...(byParent.get(span.parentId) ?? []), span]);
  }

  const rows: Array<{ span: SpanWithEvents; depth: number }> = [];
  function visit(parentId: string | null, depth: number) {
    for (const span of byParent.get(parentId) ?? []) {
      rows.push({ span, depth });
      visit(span.id, depth + 1);
    }
  }
  visit(null, 0);
  return rows.length > 0 ? rows : spans.map((span) => ({ span, depth: 0 }));
}

function WaterfallTimeline({ spans }: { spans: SpanWithEvents[] }) {
  if (spans.length === 0) {
    return (
      <div className="tf-empty-panel">
        <span>网关层拒绝</span>
        <p>本次运行未创建上游调用跨度。</p>
      </div>
    );
  }

  const starts = spans.map((span) => span.startedAt.getTime());
  const ends = spans.map((span) => span.endedAt?.getTime() ?? span.startedAt.getTime() + Math.max(duration(span), 1));
  const minStart = Math.min(...starts);
  const total = Math.max(1, Math.max(...ends) - minStart);

  return (
    <div className="tf-waterfall">
      <div className="tf-waterfall-scale" aria-hidden="true">
        <span>0s</span>
        <span>5s</span>
        <span>10s</span>
        <span>15s</span>
        <span>20s</span>
        <span>25s</span>
      </div>
      {spans.map((span) => {
        const left = ((span.startedAt.getTime() - minStart) / total) * 100;
        const width = Math.max(2, (Math.max(duration(span), 1) / total) * 100);
        const failed = span.status === TraceStatus.failed || span.status === TraceStatus.cancelled || span.errorCode;
        return (
          <div className="tf-waterfall-row" key={span.id}>
            <span className="tf-waterfall-name">
              <strong>{span.name}</strong>
              <small>{span.model ?? span.type}</small>
            </span>
            <span className="tf-waterfall-track">
              <span
                className={cn("tf-waterfall-bar", failed && "failed")}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            </span>
            <span className="tf-waterfall-ms">{formatMs(duration(span))}</span>
          </div>
        );
      })}
    </div>
  );
}

function selectedSummary(run: TraceRunDetail | null): {
  span: ReturnType<typeof displaySpan>;
  domain: ResponsibilityDomain | null;
  slowest: SpanWithEvents | null;
  costliest: SpanWithEvents | null;
  errorCode: string | null;
  modelProvider: string;
} | null {
  if (!run) return null;
  const span = displaySpan(run);
  const domain = responsibilityForRun(run);
  const slowest = run.spans.reduce<SpanWithEvents | null>(
    (current, spanItem) => (!current || duration(spanItem) > duration(current) ? spanItem : current),
    null,
  );
  const costliest = run.spans.reduce<SpanWithEvents | null>(
    (current, spanItem) => (!current || costNumber(spanItem) > costNumber(current) ? spanItem : current),
    null,
  );

  return {
    span,
    domain,
    slowest,
    costliest,
    errorCode: run.errorCode ?? span?.errorCode ?? null,
    modelProvider: modelProvider(run),
  };
}

export default async function TraceListPage({ searchParams }: { searchParams: SearchParams }) {
  const rawParams = await searchParams;
  const filters = {
    projectId: one(rawParams.projectId)?.trim(),
    status: one(rawParams.status)?.trim(),
    errorCode: one(rawParams.errorCode)?.trim(),
    model: one(rawParams.model)?.trim(),
    from: one(rawParams.from)?.trim(),
    to: one(rawParams.to)?.trim(),
    page: one(rawParams.page)?.trim(),
    run: one(rawParams.run)?.trim(),
    slow: one(rawParams.slow)?.trim(),
  };

  const page = Math.max(1, Number.parseInt(filters.page ?? "1", 10) || 1);
  const clauses: Prisma.TraceRunWhereInput[] = [];
  if (filters.projectId) clauses.push({ projectId: filters.projectId });
  if (filters.status && STATUS_OPTIONS.has(filters.status)) clauses.push({ status: filters.status as TraceStatus });
  if (filters.errorCode) clauses.push({ errorCode: filters.errorCode });
  if (filters.slow === "1") clauses.push({ latencyMs: { gt: 3000 } });
  const from = parseDate(filters.from);
  const to = parseDate(filters.to, true);
  if (from || to) clauses.push({ startedAt: { gte: from, lte: to } });
  if (filters.model) {
    const contains = { contains: filters.model, mode: "insensitive" as const };
    clauses.push({
      OR: [
        { name: contains },
        {
          spans: {
            some: {
              OR: [{ model: contains }, { provider: contains }],
            },
          },
        },
      ],
    });
  }

  const where: Prisma.TraceRunWhereInput = clauses.length ? { AND: clauses } : {};
  let rows: TraceRunRow[] = [];
  let total = 0;
  let projects: ProjectRow[] = [];
  let selectedRun: TraceRunDetail | null = null;
  let readError: string | null = null;

  try {
    [rows, total, projects] = await Promise.all([
      prisma.traceRun.findMany({
        where,
        orderBy: { startedAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          project: true,
          promptVersion: { include: { prompt: true } },
          spans: {
            select: {
              id: true,
              type: true,
              status: true,
              errorCode: true,
              model: true,
              provider: true,
              latencyMs: true,
              cost: true,
            },
            orderBy: { startedAt: "asc" },
          },
        },
      }),
      prisma.traceRun.count({ where }),
      prisma.project.findMany({ orderBy: { createdAt: "asc" } }),
    ]);

    const selectedId =
      filters.run ??
      rows.find((run) => (run.status === TraceStatus.failed || run.status === TraceStatus.cancelled) && run.spans.length > 0)?.id ??
      rows.find((run) => run.status === TraceStatus.failed || run.status === TraceStatus.cancelled)?.id ??
      rows[0]?.id;

    if (selectedId) {
      selectedRun = await prisma.traceRun.findUnique({
        where: { id: selectedId },
        include: {
          project: true,
          promptVersion: { include: { prompt: true } },
          spans: {
            include: {
              events: { orderBy: { createdAt: "asc" } },
            },
            orderBy: { startedAt: "asc" },
          },
        },
      });
    }
  } catch (error) {
    console.error(error);
    readError = "无法读取 TraceRun 数据。请确认 DATABASE_URL 可用，数据库迁移已执行。";
  }

  const baseQuery = {
    projectId: filters.projectId,
    status: filters.status,
    errorCode: filters.errorCode,
    model: filters.model,
    from: filters.from,
    to: filters.to,
    slow: filters.slow,
  };
  const hasNext = page * PAGE_SIZE < total;
  const stats = groupStats(rows);
  const summary = selectedSummary(selectedRun);
  const queueRows = [...rows].sort((left, right) => {
    if (left.id === selectedRun?.id) return -1;
    if (right.id === selectedRun?.id) return 1;
    const leftWeight = left.status === TraceStatus.failed ? 0 : left.status === TraceStatus.running ? 1 : (left.latencyMs ?? 0) > 3000 ? 2 : 3;
    const rightWeight = right.status === TraceStatus.failed ? 0 : right.status === TraceStatus.running ? 1 : (right.latencyMs ?? 0) > 3000 ? 2 : 3;
    return leftWeight - rightWeight || right.startedAt.getTime() - left.startedAt.getTime();
  });
  const spanRows = selectedRun ? treeRows(selectedRun.spans) : [];
  const fallbackRows = fallbackEvents(selectedRun);
  const healthRows = providerHealth(rows);
  const healthSource = rows.some((run) => run.spans.length > 0) ? "derived" : "mock";
  const rateLimitRows = healthRows.slice(0, 4).map((row) => ({
    label: row.label,
    rpm: deterministicNumber(`${row.label}-rpm`, 2000, 30000),
    utilization: deterministicNumber(`${row.label}-util`, 58, 98),
  }));

  return (
    <main className="tf-incident">
      <header className="tf-incident-title">
        <div>
          <h1>事故指挥台</h1>
          <p>从失败追踪切入，同屏查看运行证据并定位责任域。</p>
        </div>
        <form className="tf-title-filter" method="get">
          <NativeSelect name="projectId" size="sm" defaultValue={filters.projectId ?? ""} aria-label="项目">
            <NativeSelectOption value="">全部项目</NativeSelectOption>
            {projects.map((project) => (
              <NativeSelectOption key={project.id} value={project.id}>
                {project.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button type="submit" size="sm" variant="outline">
            <Filter aria-hidden="true" />
            应用
          </Button>
        </form>
      </header>

      {readError ? (
        <div className="tf-inline-alert" role="alert">
          <AlertTriangle aria-hidden="true" />
          <span>{readError}</span>
        </div>
      ) : null}

      <section className="tf-incident-layout">
        <Card className="tf-panel tf-run-queue">
          <CardHeader className="tf-panel-head">
            <div>
              <CardTitle>追踪运行</CardTitle>
              <CardDescription>{formatNumber(total || rows.length)} 条运行</CardDescription>
            </div>
            <CardAction>
              <Button size="icon-sm" variant="ghost" aria-label="队列筛选">
                <ListFilter aria-hidden="true" />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="tf-run-queue-body">
            <nav className="tf-run-tabs" aria-label="追踪运行分组">
              <Link className={cn(!filters.status && filters.slow !== "1" && "active")} href={buildQuery(baseQuery, { status: null, slow: null, page: 1 })}>
                全部 <span>{formatNumber(total || rows.length)}</span>
              </Link>
              <Link className={cn(filters.status === "failed" && "active failed")} href={buildQuery(baseQuery, { status: "failed", slow: null, page: 1 })}>
                失败 <span>{formatNumber(stats.failed)}</span>
              </Link>
              <Link className={cn(filters.status === "running" && "active")} href={buildQuery(baseQuery, { status: "running", slow: null, page: 1 })}>
                运行中 <span>{formatNumber(stats.running)}</span>
              </Link>
              <Link className={cn(filters.slow === "1" && "active")} href={buildQuery(baseQuery, { status: null, slow: "1", page: 1 })}>
                慢请求 <span>{formatNumber(stats.slow)}</span>
              </Link>
            </nav>

            <form className="tf-queue-filter" method="get">
              <input type="hidden" name="projectId" value={filters.projectId ?? ""} />
              <input type="hidden" name="status" value={filters.status ?? ""} />
              <label>
                <Search aria-hidden="true" />
                <input name="model" defaultValue={filters.model ?? ""} placeholder="筛选追踪运行..." />
              </label>
              <input name="errorCode" defaultValue={filters.errorCode ?? ""} placeholder="错误码" />
              <Button type="submit" size="icon-sm" variant="outline" aria-label="筛选">
                <Filter aria-hidden="true" />
              </Button>
            </form>

            {rows.length === 0 ? (
              <div className="tf-empty-panel">
                <span>没有匹配的追踪运行</span>
                <p>调整筛选条件，或运行演示追踪脚本来填充指挥队列。</p>
              </div>
            ) : (
              <div className="tf-run-list">
                {queueRows.map((run) => {
                  const span = displaySpan(run);
                  const selected = selectedRun?.id === run.id;
                  return (
                    <Link
                      key={run.id}
                      className={cn("tf-run-card", selected && "selected", run.status === TraceStatus.failed && "failed")}
                      href={buildQuery(baseQuery, { run: run.id, page })}
                    >
                      <span className="tf-run-status-line">
                        <Badge variant="outline" className={`tf-status ${statusClass(run.status)}`}>
                            {statusLabel(run.status)}
                        </Badge>
                        <span>{formatDate(run.startedAt)}</span>
                      </span>
                      <strong>
                        {traceLabel(run.id)} · {run.name ?? span?.model ?? "gateway"}
                      </strong>
                      <small>{run.project.name}</small>
                      <span className="tf-run-card-foot">
                        <code>{run.errorCode ?? span?.errorCode ?? "—"}</code>
                        <em>{formatMs(run.latencyMs ?? span?.latencyMs ?? null)}</em>
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}

            <nav className="tf-queue-pager" aria-label="追踪运行分页">
              {page > 1 ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={buildQuery(baseQuery, { page: page - 1 })}>上一页</Link>
                </Button>
              ) : (
                <span />
              )}
              {hasNext ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={buildQuery(baseQuery, { page: page + 1 })}>下一页</Link>
                </Button>
              ) : (
                <span />
              )}
            </nav>
          </CardContent>
        </Card>

        <section className="tf-incident-workspace">
          {selectedRun ? (
            <>
              <Card className="tf-panel">
                <CardHeader className="tf-incident-head">
                  <div>
                    <CardDescription>追踪运行</CardDescription>
                    <CardTitle>
                      {traceLabel(selectedRun.id)}
                      <Badge variant="outline" className={`tf-status ${statusClass(selectedRun.status)}`}>
                        {statusLabel(selectedRun.status)}
                      </Badge>
                      {summary?.errorCode ? <Badge variant="destructive">{summary.errorCode}</Badge> : null}
                    </CardTitle>
                  </div>
                  <CardAction className="tf-panel-actions">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/traces/${selectedRun.id}`}>
                        打开详情
                        <ExternalLink aria-hidden="true" />
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/chat">
                        <MessageCircle aria-hidden="true" />
                        打开对话
                      </Link>
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label="更多操作">
                      <MoreVertical aria-hidden="true" />
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent className="tf-incident-summary">
                  <div>
                    <small>智能体</small>
                    <strong>{selectedRun.name ?? "网关请求"}</strong>
                  </div>
                  <div>
                    <small>项目</small>
                    <strong>{selectedRun.project.name}</strong>
                  </div>
                  <div>
                    <small>开始时间</small>
                    <strong>{formatDate(selectedRun.startedAt)}</strong>
                  </div>
                  <div>
                    <small>耗时</small>
                    <strong>{formatMs(selectedRun.latencyMs)}</strong>
                  </div>
                  <div>
                    <small>总令牌数</small>
                    <strong>{formatNumber(selectedRun.totalTokens)}</strong>
                  </div>
                  <div>
                    <small>总成本</small>
                    <strong>${formatMoney(selectedRun.cost)}</strong>
                  </div>
                  <div>
                    <small>提示词</small>
                    {selectedRun.promptVersion ? (
                      <Link href={`/prompts/${selectedRun.promptVersion.prompt.id}`}>
                        {selectedRun.promptVersion.prompt.name} v{selectedRun.promptVersion.version}
                      </Link>
                    ) : (
                      <strong>—</strong>
                    )}
                  </div>
                  <div>
                    <small>评测</small>
                    <Link href={`/evals?projectId=${selectedRun.projectId}`}>打开证据</Link>
                  </div>
                </CardContent>
              </Card>

              <section className="tf-incident-metrics">
                <div>
                  <small>P95 延迟</small>
                  <strong>{formatMs(summary?.slowest?.latencyMs ?? selectedRun.latencyMs)}</strong>
                  <span className="ok">↓ 0.21s</span>
                </div>
                <div>
                  <small>延迟</small>
                  <strong>{formatMs(selectedRun.latencyMs)}</strong>
                  <span className="danger">↑ 18.7s</span>
                </div>
                <div>
                  <small>输入 / 输出</small>
                  <strong>
                    {formatNumber(selectedRun.spans.reduce((sum, span) => sum + (span.promptTokens ?? 0), 0))} /{" "}
                    {formatNumber(selectedRun.spans.reduce((sum, span) => sum + (span.completionTokens ?? 0), 0))}
                  </strong>
                </div>
                <div>
                  <small>错误码</small>
                  <strong>{summary?.errorCode ?? "—"}</strong>
                </div>
              </section>

              <Card className="tf-panel">
                <CardHeader className="tf-panel-head">
                  <div>
                    <CardTitle>瀑布图</CardTitle>
                    <CardDescription>运行跨度耗时与失败状态</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <WaterfallTimeline spans={selectedRun.spans} />
                </CardContent>
              </Card>

              <Card className="tf-panel">
                <CardHeader className="tf-panel-head">
                  <div>
                    <CardTitle>调用树</CardTitle>
                    <CardDescription>父子调用证据、最慢与最高成本高亮</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="tf-table-shell compact">
                    <Table className="tf-dense-table tf-span-table">
                      <TableHeader>
                        <TableRow>
                          <TableHead>名称</TableHead>
                          <TableHead>类型</TableHead>
                          <TableHead>模型 / 供应商</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead>延迟</TableHead>
                          <TableHead>令牌</TableHead>
                          <TableHead>成本</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {spanRows.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7}>这个网关层运行没有调用跨度证据。</TableCell>
                          </TableRow>
                        ) : (
                          spanRows.map(({ span, depth }) => {
                            const spanDomain = responsibilityFor(span.errorCode, span.type);
                            const isSlowest = summary?.slowest?.id === span.id;
                            const isCostliest = summary?.costliest?.id === span.id;
                            return (
                              <TableRow key={span.id} className={cn(span.errorCode && "is-error")}>
                                <TableCell>
                                  <span className="tf-span-name" style={{ paddingLeft: `${depth * 16}px` }}>
                                    <GitBranch aria-hidden="true" />
                                    <strong>{span.name}</strong>
                                  </span>
                                  {isSlowest ? <Badge variant="outline" className="tf-domain network">最慢</Badge> : null}
                                  {isCostliest ? <Badge variant="outline" className="tf-domain limit">最高成本</Badge> : null}
                                </TableCell>
                                <TableCell>{spanTypeLabel(span.type)}</TableCell>
                                <TableCell>{span.provider ?? "—"} / {span.model ?? "—"}</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className={`tf-status ${statusClass(span.status)}`}>
                                    {statusLabel(span.status)}
                                  </Badge>
                                  {domainBadge(spanDomain)}
                                </TableCell>
                                <TableCell>{formatMs(span.latencyMs)}</TableCell>
                                <TableCell>{formatNumber((span.promptTokens ?? 0) + (span.completionTokens ?? 0))}</TableCell>
                                <TableCell>${formatMoney(span.cost)}</TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="tf-panel">
              <CardContent>
                <div className="tf-empty-panel">
                  <span>选择一条追踪运行</span>
                  <p>选中行后，事故工作区会展示运行证据。</p>
                </div>
              </CardContent>
            </Card>
          )}
        </section>

        <aside className="tf-incident-rail">
          <Card className="tf-panel">
            <CardHeader className="tf-panel-head">
              <div>
                <CardTitle>实时治理</CardTitle>
                <CardDescription>责任域不包含提示词质量</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="tf-governance-stack">
              <section className="tf-rail-callout">
                <ShieldAlert aria-hidden="true" />
                <div>
                  <span>责任域</span>
                  <strong>{domainBadge(summary?.domain ?? null) ?? "模型"}</strong>
                  <p>{responsibilityDescription(summary?.domain ?? null)}</p>
                </div>
              </section>

              <section className="tf-rail-facts">
                <div>
                  <small>错误</small>
                  <Badge variant="destructive">{summary?.errorCode ?? "无"}</Badge>
                </div>
                <div>
                  <small>HTTP 状态</small>
                  <strong>{httpStatusFor(summary?.errorCode)}</strong>
                </div>
                <div>
                  <small>提示词</small>
                  {selectedRun?.promptVersion ? (
                    <Link href={`/prompts/${selectedRun.promptVersion.prompt.id}`}>打开提示词</Link>
                  ) : (
                    <strong>—</strong>
                  )}
                </div>
                <div>
                  <small>评测证据</small>
                  <Link href="/evals">打开评测</Link>
                </div>
              </section>

              <section>
                <div className="tf-section-line">
                  <h3>备用切换事件</h3>
                  <Badge variant="secondary">{formatNumber(fallbackRows.length)}</Badge>
                </div>
                <div className="tf-rail-events">
                  {fallbackRows.length === 0 ? (
                    <p>选中运行没有备用切换事件。</p>
                  ) : (
                    fallbackRows.map(({ span, event }) => (
                      <div key={event.id}>
                        <Clock3 aria-hidden="true" />
                        <span>{formatDate(event.createdAt)}</span>
                        <strong>{eventTypeLabel(event.type)}</strong>
                        <small>{span.name}</small>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section data-source="mock">
                <div className="tf-section-line">
                  <h3>限流事实</h3>
                  <Link href={buildQuery(baseQuery, { errorCode: "rate_limited", page: 1 })}>查看全部</Link>
                </div>
                <div className="tf-rate-list">
                  {rateLimitRows.map((row) => (
                    <div className="tf-rate-row" key={row.label}>
                      <span>{row.label}</span>
                      <small>{formatNumber(row.rpm)}</small>
                      <Progress value={row.utilization} className={cn("tf-progress", row.utilization > 90 && "danger")} />
                      <strong>{row.utilization}%</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section data-source={healthSource}>
                <div className="tf-section-line">
                  <h3>供应商健康</h3>
                  <Link href={buildQuery(baseQuery, { model: summary?.modelProvider.split("/")[0]?.trim() ?? null })}>查看全部</Link>
                </div>
                <div className="tf-provider-list">
                  {healthRows.map((row) => (
                    <div className="tf-provider-row" key={row.label}>
                      <span>{row.label}</span>
                      <strong>{row.successRate.toFixed(2)}%</strong>
                      <Progress value={row.successRate} className="tf-progress" />
                      <small>{formatMs(row.p95)}</small>
                      <em>{formatNumber(row.errors)}</em>
                    </div>
                  ))}
                </div>
              </section>

              <section className="tf-signal-grid">
                <div>
                  <AlertTriangle aria-hidden="true" />
                  <span>最慢调用跨度</span>
                  <strong>{summary?.slowest ? formatMs(duration(summary.slowest)) : "—"}</strong>
                  <small>{summary?.slowest?.name ?? "无调用跨度"}</small>
                </div>
                <div>
                  <Copy aria-hidden="true" />
                  <span>最高成本跨度</span>
                  <strong>{summary?.costliest ? `$${formatMoney(summary.costliest.cost)}` : "—"}</strong>
                  <small>{summary?.costliest?.name ?? "无调用跨度"}</small>
                </div>
              </section>

              <section data-source="mock">
                <div className="tf-section-line">
                  <h3>流式中断原因</h3>
                  <Link href={buildQuery(baseQuery, { errorCode: "stream_interrupted", page: 1 })}>查看全部</Link>
                </div>
                <div className="tf-reason-list">
                  {["stream_interrupted", "upstream_closed", "client_disconnect"].map((reason) => (
                    <div key={reason}>
                      <span>{reasonLabel(reason)}</span>
                      <strong>{formatNumber(deterministicNumber(reason, 27, 321))}</strong>
                      <MiniSparkline seed={reason} tone={reason === "stream_interrupted" ? "danger" : "warning"} />
                    </div>
                  ))}
                </div>
              </section>
            </CardContent>
          </Card>
        </aside>
      </section>
    </main>
  );
}
