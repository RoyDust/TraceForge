import Link from "next/link";
import { TraceEventType, TraceStatus, type Prisma } from "@prisma/client";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Columns3,
  ExternalLink,
  Gauge,
  Pause,
  RotateCw,
  Settings2,
  SlidersHorizontal,
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
import {
  compactId,
  formatDate,
  formatMoney,
  formatMs,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { responsibilityForRun } from "@/lib/responsibility";
import { deterministicNumber } from "@/lib/ui-mocks";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type ProjectRow = Prisma.ProjectGetPayload<Record<string, never>>;
type DashboardRun = Prisma.TraceRunGetPayload<{
  include: {
    project: true;
    spans: {
      include: {
        events: true;
      };
    };
  };
}>;
type UsageDailyRow = Prisma.UsageDailyGetPayload<{
  include: {
    project: true;
  };
}>;

type RunPresentation = {
  id: string;
  traceId: string;
  name: string;
  projectName: string;
  status: string;
  errorCode: string | null;
  domain: string | null;
  modelProvider: string;
  route: string;
  latencyMs: number | null;
  tokens: number | null;
  cost: number;
  usageSource: string | null;
  startedAt: Date;
};

const FALLBACK_EVENTS = [TraceEventType.fallback_triggered, TraceEventType.fallback_failed];
const FALLBACK_EVENT_SET = new Set<TraceEventType>(FALLBACK_EVENTS);
const LIMIT_ERRORS = new Set(["rate_limited", "concurrency_limited"]);
const AUTH_ERRORS = new Set(["invalid_api_key", "revoked_api_key"]);

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function endOfUtcDay(value: string) {
  return new Date(`${value}T23:59:59.999Z`);
}

function defaultFrom() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 13);
  return isoDay(date);
}

function p95(values: number[]) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function average(values: number[]) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (filtered.length === 0) return null;
  return Math.round(filtered.reduce((sum, value) => sum + value, 0) / filtered.length);
}

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? null : numerator / denominator;
}

function buildQuery(base: Record<string, string | undefined>, overrides: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    if (value && value.trim()) query.set(key, value);
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

function traceListHref(base: Record<string, string | undefined>, overrides: Record<string, string | undefined>) {
  return `/traces${buildQuery(base, overrides)}`;
}

function toNumber(value: { toString(): string } | string | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  const number = Number(value.toString());
  return Number.isFinite(number) ? number : 0;
}

function compactNumber(value: number | bigint | null | undefined) {
  if (value === null || value === undefined) return "—";
  const numeric = typeof value === "bigint" ? Number(value) : value;
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: numeric >= 1000 ? 1 : 0,
  }).format(numeric);
}

function collectMetrics(runs: DashboardRun[]) {
  const successCount = runs.filter((run) => run.status === TraceStatus.success).length;
  const failureCount = runs.filter((run) => run.status === TraceStatus.failed || run.status === TraceStatus.cancelled).length;
  const latencies = runs.flatMap((run) => (typeof run.latencyMs === "number" ? [run.latencyMs] : []));
  const spans = runs.flatMap((run) => run.spans);
  const promptTokens = spans.reduce((sum, span) => sum + BigInt(span.promptTokens ?? 0), 0n);
  const completionTokens = spans.reduce((sum, span) => sum + BigInt(span.completionTokens ?? 0), 0n);
  const totalCost = runs.reduce((sum, run) => sum + toNumber(run.cost), 0);

  return {
    requestCount: runs.length,
    successCount,
    failureCount,
    failureRate: ratio(failureCount, runs.length),
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    totalCost,
    averageLatencyMs: average(latencies),
    p95LatencyMs: p95(latencies),
  };
}

function dailyTrend(rows: UsageDailyRow[], runs: DashboardRun[]) {
  const byDay = new Map<
    string,
    {
      date: string;
      requestCount: number;
      successCount: number;
      failureCount: number;
      promptTokens: bigint;
      completionTokens: bigint;
      totalCost: number;
      averageLatencyMs: number | null;
      p95LatencyMs: number | null;
    }
  >();

  for (const row of rows) {
    const day = isoDay(row.date);
    const current =
      byDay.get(day) ??
      {
        date: day,
        requestCount: 0,
        successCount: 0,
        failureCount: 0,
        promptTokens: 0n,
        completionTokens: 0n,
        totalCost: 0,
        averageLatencyMs: null,
        p95LatencyMs: null,
      };
    current.requestCount += row.requestCount;
    current.successCount += row.successCount;
    current.failureCount += row.failureCount;
    current.promptTokens += row.promptTokens;
    current.completionTokens += row.completionTokens;
    current.totalCost += toNumber(row.totalCost);
    if (row.averageLatencyMs !== null) {
      current.averageLatencyMs =
        current.averageLatencyMs === null
          ? row.averageLatencyMs
          : Math.round((current.averageLatencyMs + row.averageLatencyMs) / 2);
    }
    byDay.set(day, current);
  }

  const runsByDay = new Map<string, DashboardRun[]>();
  for (const run of runs) {
    const day = isoDay(run.startedAt);
    runsByDay.set(day, [...(runsByDay.get(day) ?? []), run]);
  }

  for (const [day, dayRuns] of runsByDay) {
    const current = byDay.get(day);
    if (!current) continue;
    const latencies = dayRuns.flatMap((run) => (typeof run.latencyMs === "number" ? [run.latencyMs] : []));
    current.p95LatencyMs = p95(latencies);
  }

  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function modelBreakdown(runs: DashboardRun[]) {
  const groups = new Map<
    string,
    {
      provider: string;
      model: string;
      runIds: Set<string>;
      failedRunIds: Set<string>;
      promptTokens: bigint;
      completionTokens: bigint;
      totalCost: number;
      latencies: number[];
      providerUsage: number;
      estimatedUsage: number;
    }
  >();

  for (const run of runs) {
    for (const span of run.spans) {
      const provider = span.provider ?? "gateway";
      const model = span.model ?? "unknown";
      const key = `${provider} / ${model}`;
      const group =
        groups.get(key) ??
        {
          provider,
          model,
          runIds: new Set<string>(),
          failedRunIds: new Set<string>(),
          promptTokens: 0n,
          completionTokens: 0n,
          totalCost: 0,
          latencies: [],
          providerUsage: 0,
          estimatedUsage: 0,
        };
      group.runIds.add(run.id);
      if (run.status === TraceStatus.failed || run.status === TraceStatus.cancelled || span.status === TraceStatus.failed) {
        group.failedRunIds.add(run.id);
      }
      group.promptTokens += BigInt(span.promptTokens ?? 0);
      group.completionTokens += BigInt(span.completionTokens ?? 0);
      group.totalCost += toNumber(span.cost);
      if (typeof span.latencyMs === "number") group.latencies.push(span.latencyMs);
      if (span.usageSource === "provider") group.providerUsage += 1;
      if (span.usageSource === "estimated") group.estimatedUsage += 1;
      groups.set(key, group);
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      requestCount: group.runIds.size,
      failureCount: group.failedRunIds.size,
      failureRate: ratio(group.failedRunIds.size, group.runIds.size),
      averageLatencyMs: average(group.latencies),
      p95LatencyMs: p95(group.latencies),
    }))
    .sort((a, b) => b.totalCost - a.totalCost);
}

function governance(runs: DashboardRun[]) {
  const fallbackEvents = runs.flatMap((run) =>
    run.spans.flatMap((span) =>
      span.events
        .filter((event) => FALLBACK_EVENT_SET.has(event.type))
        .map((event) => ({ run, span, event })),
    ),
  );
  const limitRuns = runs.filter((run) => run.errorCode && LIMIT_ERRORS.has(run.errorCode));
  const authRuns = runs.filter((run) => run.errorCode && AUTH_ERRORS.has(run.errorCode));
  const streamInterruptedRuns = runs.filter((run) => run.errorCode === "stream_interrupted" || run.spans.some((span) => span.errorCode === "stream_interrupted"));

  return {
    limitRuns,
    authRuns,
    streamInterruptedRuns,
    fallbackTriggered: fallbackEvents.filter((item) => item.event.type === TraceEventType.fallback_triggered),
    fallbackFailed: fallbackEvents.filter((item) => item.event.type === TraceEventType.fallback_failed),
  };
}

function displaySpan(run: DashboardRun) {
  return (
    run.spans.find((span) => span.errorCode || span.status === TraceStatus.failed || span.status === TraceStatus.cancelled) ??
    run.spans.find((span) => span.model || span.provider) ??
    null
  );
}

function presentRun(run: DashboardRun): RunPresentation {
  const span = displaySpan(run);
  return {
    id: run.id,
    traceId: `tr_${compactId(run.id).toUpperCase()}`,
    name: run.name ?? "网关请求",
    projectName: run.project.name,
    status: run.status,
    errorCode: run.errorCode ?? span?.errorCode ?? null,
    domain: responsibilityForRun(run),
    modelProvider: span ? `${span.provider ?? "网关"} / ${span.model ?? "未知"}` : "网关 / 策略",
    route: run.errorCode ? "fallback" : "primary",
    latencyMs: run.latencyMs ?? span?.latencyMs ?? null,
    tokens: run.totalTokens,
    cost: toNumber(run.cost ?? span?.cost),
    usageSource: run.usageSource,
    startedAt: run.startedAt,
  };
}

function mockRunRows(): RunPresentation[] {
  const seeds = [
    ["failed", "stream_interrupted", "模型", "openai / gpt-4o", 24780, 12842],
    ["running", null, null, "openai / gpt-4o-mini", 12310, 4210],
    ["failed", "rate_limited", "限流", "deepseek / deepseek-chat", 5482, 13466],
    ["success", null, null, "anthropic / claude-3-5-sonnet", 812, 7421],
    ["failed", "server_error", "网络", "mistral / mistral-large-2407", 6121, 9904],
    ["success", null, null, "mock / mock-ok", 229, 66],
  ] as const;

  return seeds.map(([status, errorCode, domain, modelProvider, latencyMs, tokens], index) => ({
    id: `mock-${index}`,
    traceId: `tr_0132X9${index}V`,
    name: status === "failed" ? "refund-agent" : "support-agent",
    projectName: "演示项目",
    status,
    errorCode,
    domain,
    modelProvider,
    route: index % 2 === 0 ? "primary" : "fallback",
    latencyMs,
    tokens,
    cost: deterministicNumber(`cost-${index}`, 42, 721) / 1000,
    usageSource: index % 3 === 0 ? "estimated" : "provider",
    startedAt: new Date(Date.now() - index * 37000),
  }));
}

function series(seed: string, count = 26) {
  return Array.from({ length: count }, (_, index) => deterministicNumber(`${seed}-${index}`, 18, 92));
}

function Sparkline({ seed, tone = "ok" }: { seed: string; tone?: "ok" | "danger" | "warning" | "neutral" }) {
  const points = series(seed);
  const max = Math.max(...points);
  const min = Math.min(...points);
  const coords = points
    .map((value, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * 128;
      const y = 34 - ((value - min) / Math.max(max - min, 1)) * 28;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg className={`tf-sparkline ${tone}`} viewBox="0 0 128 40" role="img" aria-label="趋势">
      <polyline points={coords} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function KpiTile({
  label,
  value,
  delta,
  trend,
  tone = "ok",
  seed,
  source = "derived",
}: {
  label: string;
  value: string;
  delta: string;
  trend: "up" | "down";
  tone?: "ok" | "danger" | "warning" | "neutral";
  seed: string;
  source?: "live" | "derived" | "mock";
}) {
  const TrendIcon = trend === "up" ? ArrowUpRight : ArrowDownRight;
  return (
    <Card className="tf-kpi-card" size="sm" data-source={source}>
      <CardHeader className="tf-kpi-head">
        <CardDescription>{label}</CardDescription>
        <CardAction className={cn("tf-kpi-delta", tone)}>
          <TrendIcon aria-hidden="true" />
          {delta}
        </CardAction>
      </CardHeader>
      <CardContent className="tf-kpi-content">
        <strong>{value}</strong>
        <Sparkline seed={seed} tone={tone} />
      </CardContent>
    </Card>
  );
}

function statusTone(status: string) {
  if (status === "success") return "success";
  if (status === "running") return "running";
  if (status === "failed") return "failed";
  return "cancelled";
}

function statusLabel(status: string | null | undefined) {
  if (status === "success") return "成功";
  if (status === "running") return "运行中";
  if (status === "failed") return "失败";
  if (status === "cancelled") return "已取消";
  return "未知";
}

function routeLabel(route: string | null | undefined) {
  if (route === "primary") return "主路由";
  if (route === "fallback") return "备用路由";
  return "策略路由";
}

function usageSourceLabel(source: string | null | undefined) {
  if (source === "provider") return "供应商";
  if (source === "estimated") return "估算";
  return source ?? "—";
}

function reasonLabel(reason: string) {
  if (reason === "stream_interrupted") return "流式中断";
  if (reason === "upstream_closed") return "上游关闭";
  if (reason === "client_disconnect") return "客户端断开";
  if (reason === "timeout") return "超时";
  return reason;
}

function domainTone(domain: string | null) {
  if (!domain) return "provider";
  if (domain === "模型") return "model";
  if (domain === "网络") return "network";
  if (domain === "限流") return "limit";
  if (domain === "网关拒绝") return "gateway";
  return "business";
}

function percentValue(value: number | null | undefined, fallbackSeed: string) {
  if (value !== null && value !== undefined) return Math.round(value * 1000) / 10;
  return deterministicNumber(fallbackSeed, 3, 18) / 10;
}

function providerName(provider: string, model: string) {
  return `${provider} / ${model}`;
}

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const rawParams = await searchParams;
  const filters = {
    projectId: one(rawParams.projectId)?.trim(),
    from: one(rawParams.from)?.trim() || defaultFrom(),
    to: one(rawParams.to)?.trim() || isoDay(new Date()),
  };
  const startedAt = { gte: startOfUtcDay(filters.from), lte: endOfUtcDay(filters.to) };
  const baseTraceQuery = {
    projectId: filters.projectId,
    from: filters.from,
    to: filters.to,
  };
  const where: Prisma.TraceRunWhereInput = {
    startedAt,
    ...(filters.projectId ? { projectId: filters.projectId } : {}),
  };

  let projects: ProjectRow[] = [];
  let runs: DashboardRun[] = [];
  let usageRows: UsageDailyRow[] = [];
  let readError: string | null = null;

  try {
    [projects, runs, usageRows] = await Promise.all([
      prisma.project.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.traceRun.findMany({
        where,
        orderBy: { startedAt: "desc" },
        include: {
          project: true,
          spans: {
            include: {
              events: {
                where: { type: { in: FALLBACK_EVENTS } },
                orderBy: { createdAt: "asc" },
              },
            },
            orderBy: { startedAt: "asc" },
          },
        },
      }),
      prisma.usageDaily.findMany({
        where: {
          date: { gte: startOfUtcDay(filters.from), lte: startOfUtcDay(filters.to) },
          modelConfigId: null,
          ...(filters.projectId ? { projectId: filters.projectId } : {}),
        },
        include: { project: true },
        orderBy: [{ date: "asc" }, { projectId: "asc" }],
      }),
    ]);
  } catch (error) {
    console.error(error);
    readError = "无法读取治理总览数据，已切换为高保真模拟数据用于原型验证。";
  }

  const metrics = collectMetrics(runs);
  const trendRows = dailyTrend(usageRows, runs);
  const modelRows = modelBreakdown(runs);
  const governanceData = governance(runs);
  const displayRows = runs.length > 0 ? runs.slice(0, 9).map(presentRun) : mockRunRows();
  const selectedRun = displayRows.find((run) => run.status === "failed") ?? displayRows[0];
  const fallbackCount = governanceData.fallbackTriggered.length || deterministicNumber("fallbacks", 380, 2134);
  const streamErrorCount = governanceData.streamInterruptedRuns.length || deterministicNumber("stream-errors", 180, 742);
  const requestCount = metrics.requestCount || deterministicNumber("requests", 98000, 128731);
  const failureRate = metrics.failureRate ?? deterministicNumber("failure-rate", 210, 395) / 10000;
  const p95Latency = metrics.p95LatencyMs ?? deterministicNumber("p95-latency", 1080, 2480);
  const tokenTotal = metrics.totalTokens > 0n ? metrics.totalTokens : BigInt(deterministicNumber("tokens", 76000000, 87600000));
  const totalCost = metrics.totalCost || deterministicNumber("cost", 420000, 873211) / 100;
  const chartRows =
    trendRows.length > 0
      ? trendRows.slice(-7).map((row) => ({
          label: row.date.slice(5),
          requests: row.requestCount,
          errors: row.failureCount,
        }))
      : series("usage", 7).map((value, index) => ({
          label: `5/${8 + index}`,
          requests: value * 170,
          errors: deterministicNumber(`usage-error-${index}`, 80, 620),
        }));
  const maxChartRequests = Math.max(1, ...chartRows.map((row) => row.requests));
  const providerRows =
    modelRows.length > 0
      ? modelRows.slice(0, 5).map((row) => ({
          label: providerName(row.provider, row.model),
          successRate: 100 - percentValue(row.failureRate, row.model),
          p95: row.p95LatencyMs ?? deterministicNumber(row.model, 210, 2480),
          errors: row.failureCount || deterministicNumber(`${row.model}-errors`, 3, 1204),
        }))
      : ["openai / gpt-4o", "deepseek / deepseek-chat", "anthropic / claude-3-5-sonnet", "mistral / mistral-large-2407", "mock / mock-ok"].map((label) => ({
          label,
          successRate: deterministicNumber(`${label}-success`, 941, 999) / 10,
          p95: deterministicNumber(`${label}-p95`, 210, 2480),
          errors: deterministicNumber(`${label}-errors`, 3, 1204),
        }));
  const rateRows = providerRows.slice(0, 4).map((row) => ({
    label: row.label,
    limit: deterministicNumber(`${row.label}-limit`, 2000, 30000),
    utilization: deterministicNumber(`${row.label}-util`, 58, 98),
    failures: deterministicNumber(`${row.label}-failures`, 102, 1204),
  }));
  const streamReasons = [
    ["stream_interrupted", streamErrorCount],
    ["upstream_closed", deterministicNumber("upstream-closed", 68, 163)],
    ["client_disconnect", deterministicNumber("client-disconnect", 42, 118)],
    ["timeout", deterministicNumber("timeout", 21, 78)],
  ] as const;

  return (
    <main className="tf-dashboard">
      <header className="tf-page-title">
        <div>
          <h1>治理总览</h1>
          <p>集中查看追踪运行、供应商健康、限流、成本和 Token 压力。</p>
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
            <RotateCw aria-hidden="true" />
            刷新
          </Button>
        </form>
      </header>

      {readError ? (
        <div className="tf-inline-alert" role="status">
          <AlertTriangle aria-hidden="true" />
          <span>{readError}</span>
        </div>
      ) : null}

      <section className="tf-kpi-strip" aria-label="治理总览关键指标">
        <KpiTile label="请求量" value={`${formatNumber(requestCount)} 次`} delta="12.4%" trend="up" seed="requests" source={metrics.requestCount ? "derived" : "mock"} />
        <KpiTile label="失败率" value={formatPercent(failureRate)} delta="0.85pp" trend="up" tone="danger" seed="failure" source={metrics.failureRate === null ? "mock" : "derived"} />
        <KpiTile label="P95 延迟" value={formatMs(p95Latency)} delta="0.21s" trend="down" seed="latency" source={metrics.p95LatencyMs === null ? "mock" : "derived"} />
        <KpiTile label="成本" value={`$${formatMoney(totalCost)}`} delta="8.7%" trend="up" seed="cost" source={metrics.totalCost ? "derived" : "mock"} />
        <KpiTile label="令牌" value={compactNumber(tokenTotal)} delta="10.8%" trend="up" seed="tokens" source={metrics.totalTokens > 0n ? "derived" : "mock"} />
        <KpiTile label="备用切换" value={formatNumber(fallbackCount)} delta="6.1%" trend="up" tone="warning" seed="fallbacks" source={governanceData.fallbackTriggered.length ? "derived" : "mock"} />
        <KpiTile label="流式错误" value={formatNumber(streamErrorCount)} delta="14.3%" trend="up" tone="danger" seed="streams" source={governanceData.streamInterruptedRuns.length ? "derived" : "mock"} />
      </section>

      <form className="tf-filter-strip" method="get">
        <div className="tf-filter-tabs" aria-label="状态筛选">
          <Badge variant="secondary">失败、运行中</Badge>
          <Badge variant="outline">全部供应商</Badge>
          <Badge variant="outline">全部模型</Badge>
          <Badge variant="outline">全部错误码</Badge>
          <Badge variant="outline">近 24 小时</Badge>
        </div>
        <input type="hidden" name="projectId" value={filters.projectId ?? ""} />
        <label>
          <span>开始</span>
          <input name="from" type="date" defaultValue={filters.from} />
        </label>
        <label>
          <span>结束</span>
          <input name="to" type="date" defaultValue={filters.to} />
        </label>
        <Button type="submit" size="sm" variant="outline">
          <SlidersHorizontal aria-hidden="true" />
          应用
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link href="/dashboard">清除全部</Link>
        </Button>
      </form>

      <div className="tf-ops-grid">
        <section className="tf-ops-main">
          <Card className="tf-panel tf-trace-panel">
            <CardHeader className="tf-panel-head">
              <div>
                <CardTitle>追踪运行</CardTitle>
                <CardDescription>
                  {formatNumber(runs.length || displayRows.length)} 条结果
                  <Pause aria-hidden="true" className="tf-inline-icon" />
                </CardDescription>
              </div>
              <CardAction className="tf-panel-actions">
                <Button size="sm" variant="outline">
                  <Columns3 aria-hidden="true" />
                  列设置
                </Button>
                <Button size="sm" variant="outline">
                  <Gauge aria-hidden="true" />
                  密度
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="设置">
                  <Settings2 aria-hidden="true" />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="tf-panel-content">
              <div className="tf-table-shell">
                <Table className="tf-dense-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>状态</TableHead>
                      <TableHead>时间</TableHead>
                      <TableHead>追踪 ID</TableHead>
                      <TableHead>模型</TableHead>
                      <TableHead>路由</TableHead>
                      <TableHead>P95（毫秒）</TableHead>
                      <TableHead>令牌</TableHead>
                      <TableHead>成本</TableHead>
                      <TableHead>错误码</TableHead>
                      <TableHead>用量来源</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayRows.map((run) => (
                      <TableRow key={run.id} className={cn(run.id === selectedRun?.id && "is-selected", run.status === "failed" && "is-error")}>
                        <TableCell>
                          <Badge variant="outline" className={`tf-status ${statusTone(run.status)}`}>
                            {statusLabel(run.status)}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatDate(run.startedAt)}</TableCell>
                        <TableCell>
                          <Link className="tf-run-link" href={run.id.startsWith("mock") ? "/traces" : `/traces/${run.id}`}>
                            {run.traceId}
                          </Link>
                        </TableCell>
                        <TableCell>{run.modelProvider}</TableCell>
                        <TableCell>{routeLabel(run.route)}</TableCell>
                        <TableCell className={run.status === "failed" ? "tf-danger-text" : "tf-ok-text"}>{formatNumber(run.latencyMs)}</TableCell>
                        <TableCell>{formatNumber(run.tokens)}</TableCell>
                        <TableCell>${formatMoney(run.cost)}</TableCell>
                        <TableCell>{run.errorCode ? <code>{run.errorCode}</code> : "—"}</TableCell>
                        <TableCell>{run.usageSource ? <Badge variant="outline">{usageSourceLabel(run.usageSource)}</Badge> : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {selectedRun ? (
                <div className="tf-run-detail">
                  <div>
                    <h3>追踪运行详情</h3>
                    <dl>
                      <div>
                        <dt>追踪 ID</dt>
                        <dd>{selectedRun.traceId}</dd>
                      </div>
                      <div>
                        <dt>请求时间</dt>
                        <dd>{formatDate(selectedRun.startedAt)}</dd>
                      </div>
                      <div>
                        <dt>模型</dt>
                        <dd>{selectedRun.modelProvider}</dd>
                      </div>
                      <div>
                        <dt>项目</dt>
                        <dd>{selectedRun.projectName}</dd>
                      </div>
                    </dl>
                  </div>
                  <div>
                    <h3>错误</h3>
                    <dl>
                      <div>
                        <dt>错误码</dt>
                        <dd>{selectedRun.errorCode ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>责任域</dt>
                        <dd>
                          <Badge variant="outline" className={`tf-domain ${domainTone(selectedRun.domain)}`}>
                            {selectedRun.domain ?? "模型"}
                          </Badge>
                        </dd>
                      </div>
                      <div>
                        <dt>说明</dt>
                        <dd>
                          {selectedRun.errorCode === "rate_limited"
                            ? "网关限流在转交供应商前拦截了请求"
                            : selectedRun.errorCode
                              ? "流式响应在完成前中断"
                              : "已在治理阈值内完成"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div>
                    <h3>快速操作</h3>
                    <div className="tf-action-stack">
                      <Button asChild size="sm" variant="outline">
                        <Link href={traceListHref(baseTraceQuery, { status: "failed" })}>
                          打开失败追踪
                          <ExternalLink aria-hidden="true" />
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href="/chat">在对话中打开</Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href="/prompts">对比提示词</Link>
                      </Button>
                    </div>
                  </div>
                  <div>
                    <h3>相关事件</h3>
                    <ol className="tf-event-list">
                      <li>
                        <span>{formatDate(selectedRun.startedAt)}</span>
                        <strong>流式响应中断</strong>
                      </li>
                      <li>
                        <span>&lt;100ms</span>
                        <strong>供应商路由启动</strong>
                      </li>
                      <li>
                        <span>2.00s</span>
                        <strong>上游读取超时</strong>
                      </li>
                    </ol>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="tf-bottom-grid">
            <Card className="tf-panel">
              <CardHeader className="tf-panel-head">
                <div>
                  <CardTitle>每日用量</CardTitle>
                  <CardDescription>近 7 天 · 请求与错误</CardDescription>
                </div>
                <NativeSelect size="sm" aria-label="指标">
                  <NativeSelectOption>请求量</NativeSelectOption>
                </NativeSelect>
              </CardHeader>
              <CardContent className="tf-usage-chart">
                <div className="tf-chart-bars">
                  {chartRows.map((row) => (
                    <div key={row.label} className="tf-chart-column">
                      <span className="tf-chart-track">
                        <span style={{ height: `${Math.max(10, (row.requests / maxChartRequests) * 100)}%` }} />
                      </span>
                      <small>{row.label}</small>
                    </div>
                  ))}
                </div>
                <div className="tf-chart-summary">
                  <span>总计 {formatNumber(requestCount)} 次请求</span>
                  <span>错误 {formatNumber(metrics.failureCount || streamErrorCount)}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="tf-panel">
              <CardHeader className="tf-panel-head">
                <div>
                  <CardTitle>模型 / 供应商成本拆分</CardTitle>
                  <CardDescription>近 24 小时 · 实时与派生成本</CardDescription>
                </div>
                <Button size="sm" variant="outline">对比模型</Button>
              </CardHeader>
              <CardContent>
                <div className="tf-table-shell compact">
                  <Table className="tf-dense-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>模型</TableHead>
                        <TableHead>请求量</TableHead>
                        <TableHead>令牌</TableHead>
                        <TableHead>成本</TableHead>
                        <TableHead>成本占比</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(modelRows.length > 0 ? modelRows.slice(0, 5) : []).map((row) => (
                        <TableRow key={`${row.provider}/${row.model}`}>
                          <TableCell>{row.model}</TableCell>
                          <TableCell>{formatNumber(row.requestCount)}</TableCell>
                          <TableCell>{compactNumber(row.promptTokens + row.completionTokens)}</TableCell>
                          <TableCell>${formatMoney(row.totalCost)}</TableCell>
                          <TableCell>{formatPercent(ratio(row.totalCost, totalCost))}</TableCell>
                        </TableRow>
                      ))}
                      {modelRows.length === 0
                        ? providerRows.slice(0, 5).map((row) => (
                            <TableRow key={row.label}>
                              <TableCell>{row.label}</TableCell>
                              <TableCell>{formatNumber(deterministicNumber(`${row.label}-req`, 3910, 42131))}</TableCell>
                              <TableCell>{compactNumber(deterministicNumber(`${row.label}-tok`, 2700000, 34100000))}</TableCell>
                              <TableCell>${formatMoney(deterministicNumber(`${row.label}-cost`, 42976, 417222) / 100)}</TableCell>
                              <TableCell>{formatPercent(deterministicNumber(`${row.label}-share`, 49, 478) / 1000)}</TableCell>
                            </TableRow>
                          ))
                        : null}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <aside className="tf-live-governance">
          <Card className="tf-panel">
            <CardHeader className="tf-panel-head">
              <div>
                <CardTitle>实时治理</CardTitle>
                <CardDescription>5 秒前更新</CardDescription>
              </div>
              <Button size="icon-sm" variant="ghost" aria-label="刷新治理数据">
                <RotateCw aria-hidden="true" />
              </Button>
            </CardHeader>
            <CardContent className="tf-governance-stack">
              <section>
                <div className="tf-section-line">
                  <h3>供应商健康</h3>
                  <Link href={traceListHref(baseTraceQuery, {})}>查看全部</Link>
                </div>
                <div className="tf-provider-list">
                  {providerRows.map((row) => (
                    <div key={row.label} className="tf-provider-row">
                      <span>{row.label}</span>
                      <strong>{row.successRate.toFixed(2)}%</strong>
                      <Progress value={row.successRate} className="tf-progress" />
                      <small>{formatMs(row.p95)}</small>
                      <em>{formatNumber(row.errors)}</em>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <div className="tf-section-line">
                  <h3>限流失败</h3>
                  <Link href={traceListHref(baseTraceQuery, { errorCode: "rate_limited" })}>查看全部</Link>
                </div>
                <div className="tf-rate-list">
                  {rateRows.map((row) => (
                    <div key={row.label} className="tf-rate-row">
                      <span>{row.label}</span>
                      <small>{formatNumber(row.limit)}</small>
                      <Progress value={row.utilization} className={cn("tf-progress", row.utilization > 90 && "danger")} />
                      <strong>{formatNumber(row.failures)}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <div className="tf-section-line">
                  <h3>备用切换链路</h3>
                  <Link href={traceListHref(baseTraceQuery, { errorCode: "stream_interrupted" })}>查看全部</Link>
                </div>
                <div className="tf-chain-list">
                  <div>
                    <span>openai:gpt-4o → openai:gpt-4o-mini</span>
                    <strong>{formatNumber(fallbackCount)}</strong>
                    <Progress value={96.8} className="tf-progress" />
                  </div>
                  <div>
                    <span>deepseek-chat → openai:gpt-4o</span>
                    <strong>{formatNumber(Math.max(1, Math.round(fallbackCount * 0.42)))}</strong>
                    <Progress value={94.3} className="tf-progress" />
                  </div>
                  <div>
                    <span>mock:mock-llm → gpt-4o-mini</span>
                    <strong>{formatNumber(Math.max(1, Math.round(fallbackCount * 0.18)))}</strong>
                    <Progress value={98.1} className="tf-progress" />
                  </div>
                </div>
              </section>

              <section>
                <div className="tf-section-line">
                  <h3>流式中断原因</h3>
                  <Link href={traceListHref(baseTraceQuery, { errorCode: "stream_interrupted" })}>查看全部</Link>
                </div>
                <div className="tf-reason-list">
                  {streamReasons.map(([reason, count]) => (
                    <div key={reason}>
                      <span>{reasonLabel(reason)}</span>
                      <strong>{formatNumber(count)}</strong>
                      <Sparkline seed={reason} tone={reason === "stream_interrupted" ? "danger" : "warning"} />
                    </div>
                  ))}
                </div>
              </section>

              <section className="tf-signal-grid">
                <div>
                  <AlertTriangle aria-hidden="true" />
                  <span>最慢调用跨度</span>
                  <strong>{formatMs(selectedRun?.latencyMs ?? p95Latency)}</strong>
                </div>
                <div>
                  <CheckCircle2 aria-hidden="true" />
                  <span>备用切换失败</span>
                  <strong>{formatNumber(governanceData.fallbackFailed.length)}</strong>
                </div>
              </section>
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}
