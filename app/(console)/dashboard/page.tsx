import Link from "next/link";
import { TraceStatus, type Prisma } from "@prisma/client";
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  CircleAlert,
  Clock3,
  Coins,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
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
import {
  UsageChart,
  type UsagePoint,
} from "@/components/traceforge/usage-chart";
import { getDashboardData } from "@/lib/dashboard";
import { shanghaiDay } from "@/lib/format";
import { ratio } from "@/lib/ui-metrics";
import { responsibilityForRun } from "@/lib/responsibility";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
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
  cost: string | null;
  usageSource: string | null;
  startedAt: Date;
};

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function defaultFrom() {
  return shanghaiDay(new Date(Date.now() - 6 * 86400000));
}

function buildQuery(
  base: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>,
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...base, ...overrides })) {
    if (value && value.trim()) query.set(key, value);
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

function traceListHref(
  base: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>,
) {
  return `/traces${buildQuery(base, overrides)}`;
}

function compactNumber(value: number | bigint | null | undefined) {
  if (value === null || value === undefined) return "—";
  const numeric = typeof value === "bigint" ? Number(value) : value;
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: numeric >= 1000 ? 1 : 0,
  }).format(numeric);
}

function displaySpan(run: DashboardRun) {
  return (
    run.spans.find(
      (span) =>
        span.errorCode ||
        span.status === TraceStatus.failed ||
        span.status === TraceStatus.cancelled,
    ) ??
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
    modelProvider: span
      ? `${span.provider ?? "网关"} / ${span.model ?? "未知"}`
      : "网关 / 策略",
    route: run.spans.some((span) =>
      span.events.some((event) => event.type === "fallback_triggered"),
    )
      ? "fallback"
      : "primary",
    latencyMs: run.latencyMs ?? span?.latencyMs ?? null,
    tokens: run.totalTokens,
    cost: run.cost?.toString() ?? null,
    usageSource: run.usageSource,
    startedAt: run.startedAt,
  };
}

function KpiTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint: string;
  icon?: LucideIcon;
  tone?: "neutral" | "danger";
}) {
  return (
    <div className={"tf-kpi-card " + tone} data-source="database">
      <div className="tf-kpi-head">
        <span>{label}</span>
        {Icon ? <Icon size={16} aria-hidden="true" /> : null}
      </div>
      <div className="tf-kpi-content">
        <strong>{value}</strong>
      </div>
      <p className="tf-kpi-hint">{hint}</p>
    </div>
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

function providerName(provider: string, model: string) {
  return `${provider} / ${model}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const rawParams = await searchParams;
  const filters = {
    projectId: one(rawParams.projectId)?.trim() || undefined,
    from: one(rawParams.from)?.trim() || defaultFrom(),
    to: one(rawParams.to)?.trim() || shanghaiDay(new Date()),
  };
  const data = await getDashboardData(filters);
  const { metrics, runs, projects, trends: trendRows } = data;
  const modelRows = data.models.map((row) => ({
    ...row,
    failureRate: ratio(row.failureCount, row.requestCount),
  }));
  const governanceData = data.governance;
  const baseTraceQuery = filters;
  const displayRows = runs.map(presentRun);
  const fallbackCount = governanceData.fallbackTriggered;
  const streamErrorCount = governanceData.streamErrors;
  const requestCount = metrics.requestCount;
  const failureRate = ratio(metrics.failureCount, requestCount);
  const p95Latency = metrics.p95LatencyMs;
  const tokenTotal = metrics.promptTokens + metrics.completionTokens;
  const totalCost = metrics.totalCost;
  const chartByDate = new Map(
    trendRows.map((row) => [
      row.date!,
      {
        date: row.date!,
        requests: row.requestCount,
        errors: row.failureCount,
        tokens: Number(row.promptTokens + row.completionTokens),
        latency: row.p95LatencyMs,
      },
    ]),
  );
  const chartRows: UsagePoint[] = [];
  const firstDay = new Date(filters.from + "T00:00:00Z").getTime();
  const lastDay = new Date(filters.to + "T00:00:00Z").getTime();
  // Bound the visual density for long custom ranges; the totals still cover the entire range.
  const completeRange =
    lastDay >= firstDay && (lastDay - firstDay) / 86400000 < 62;
  if (trendRows.length && completeRange) {
    for (let day = firstDay; day <= lastDay; day += 86400000) {
      const date = new Date(day).toISOString().slice(0, 10);
      chartRows.push(
        chartByDate.get(date) ?? {
          date,
          requests: 0,
          errors: 0,
          tokens: 0,
          latency: null,
        },
      );
    }
  } else {
    chartRows.push(...chartByDate.values());
  }
  const today = shanghaiDay(new Date());
  const activeProject =
    projects.find((project) => project.id === filters.projectId)?.name ??
    "全部项目";
  const providerRows = modelRows.map((row) => ({
    label: providerName(row.provider, row.model),
    successRate: 100 * (1 - (row.failureRate ?? 0)),
    p95: row.p95LatencyMs,
    errors: row.failureCount,
  }));
  const rateRows = modelRows.map((row) => ({
    label: providerName(row.provider, row.model),
    failures: row.limitCount,
  }));
  if (governanceData.gatewayLimitCount)
    rateRows.push({
      label: "网关拒绝（未达模型）",
      failures: governanceData.gatewayLimitCount,
    });
  const streamReasons = data.reasons.map(
    (row) => [row.label, row.count] as const,
  );

  return (
    <main className="tf-dashboard">
      <header className="tf-page-title">
        <div>
          <h1>治理总览</h1>
          <p>{activeProject} · 请求、用量与运行质量</p>
        </div>
        <Button asChild>
          <Link href="/chat">
            调试新请求 <ArrowUpRight aria-hidden="true" />
          </Link>
        </Button>
      </header>
      <div className="tf-range-toolbar">
        <div className="tf-range-heading">
          <div className="tf-range-presets" aria-label="快捷日期">
            {[1, 7, 30].map((days) => {
              const from = new Date(
                new Date(today + "T00:00:00Z").getTime() -
                  (days - 1) * 86400000,
              )
                .toISOString()
                .slice(0, 10);
              return (
                <Link
                  key={days}
                  href={"/dashboard" + buildQuery(filters, { from, to: today })}
                  aria-current={
                    filters.from === from && filters.to === today
                      ? "date"
                      : undefined
                  }
                >
                  {days === 1 ? "今天" : "近 " + days + " 天"}
                </Link>
              );
            })}
          </div>
        </div>
        <form className="tf-filter-strip" method="get">
          <div className="tf-filter-context">
            <CalendarDays size={16} aria-hidden="true" />
            <span>范围</span>
          </div>
          <NativeSelect
            name="projectId"
            defaultValue={filters.projectId ?? ""}
            aria-label="项目"
          >
            <NativeSelectOption value="">全部项目</NativeSelectOption>
            {projects.map((project) => (
              <NativeSelectOption key={project.id} value={project.id}>
                {project.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <label>
            <span>开始</span>
            <input name="from" type="date" defaultValue={filters.from} />
          </label>
          <label>
            <span>结束</span>
            <input name="to" type="date" defaultValue={filters.to} />
          </label>
          <Button type="submit" variant="outline" size="sm">
            <RefreshCw size={14} aria-hidden="true" />
            应用筛选
          </Button>
        </form>
      </div>
      {requestCount === 0 ? (
        <p className="empty-state" role="status">
          当前范围暂无运行数据。接入网关后查看指标，或调整项目和日期范围。
        </p>
      ) : null}
      <section className="tf-kpi-strip" aria-label="治理总览关键指标">
        <KpiTile
          label="请求量"
          value={formatNumber(requestCount) + " 次"}
          hint={"成功 " + formatNumber(metrics.successCount) + " 次"}
          icon={Activity}
        />
        <KpiTile
          label="失败率"
          value={formatPercent(failureRate)}
          hint={"失败 " + formatNumber(metrics.failureCount) + " 次"}
          icon={CircleAlert}
          tone={metrics.failureCount > 0 ? "danger" : "neutral"}
        />
        <KpiTile
          label="P95 延迟"
          value={formatMs(p95Latency)}
          hint={"平均延迟 " + formatMs(metrics.averageLatencyMs)}
          icon={Clock3}
        />
        <KpiTile
          label="成本"
          value={totalCost === null ? "—" : "$" + formatMoney(totalCost)}
          hint={
            totalCost === null ? "存在未知价格，暂不汇总" : "USD · 当前筛选范围"
          }
          icon={Coins}
        />
      </section>
      {requestCount > 0 && totalCost === null ? (
        <p className="tf-data-note" role="status">
          当前范围存在成本未知的运行，成本合计及占比暂不展示。
        </p>
      ) : null}
      <div className="tf-overview-grid">
        <UsageChart
          rows={chartRows}
          projectId={filters.projectId}
          completeRange={completeRange}
        />
        <Card className="tf-panel tf-overview-summary">
          <CardHeader className="tf-panel-head">
            <div>
              <CardTitle>运行概况</CardTitle>
              <CardDescription>当前筛选范围内的事件</CardDescription>
            </div>
          </CardHeader>
          <section className="tf-secondary-metrics" aria-label="运行概况">
            <KpiTile
              label="令牌"
              value={compactNumber(tokenTotal)}
              hint={
                "输入 " +
                compactNumber(metrics.promptTokens) +
                " / 输出 " +
                compactNumber(metrics.completionTokens)
              }
            />
            <KpiTile
              label="备用切换"
              value={formatNumber(fallbackCount)}
              hint={
                "切换失败 " +
                formatNumber(governanceData.fallbackFailed) +
                " 次"
              }
            />
            <KpiTile
              label="流式错误"
              value={formatNumber(streamErrorCount)}
              hint="查看下方中断原因分布"
              tone={streamErrorCount > 0 ? "danger" : "neutral"}
            />
          </section>
          <Link
            className={
              "tf-attention-link " + (metrics.failureCount ? "has-errors" : "")
            }
            href={traceListHref(baseTraceQuery, { status: "failed" })}
          >
            <CircleAlert size={16} aria-hidden="true" />
            <span>
              {metrics.failureCount
                ? formatNumber(metrics.failureCount) + " 次失败请求，前往排查"
                : "查看失败请求"}
            </span>
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </Card>
      </div>
      <Card className="tf-panel tf-trace-panel">
        <CardHeader className="tf-panel-head">
          <div>
            <CardTitle>最近运行</CardTitle>
            <CardDescription>
              当前范围 {formatNumber(requestCount)} 次请求 · 显示最近{" "}
              {displayRows.length} 条
            </CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href={traceListHref(baseTraceQuery, {})}>
              全部追踪 <ArrowUpRight aria-hidden="true" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="tf-panel-content">
          <div className="tf-table-shell">
            <Table className="tf-dense-table">
              <TableHeader>
                <TableRow>
                  <TableHead>运行 / 追踪 ID</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>模型 / 供应商</TableHead>
                  <TableHead>延迟</TableHead>
                  <TableHead>令牌</TableHead>
                  <TableHead>成本</TableHead>
                  <TableHead>路由</TableHead>
                  <TableHead>时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayRows.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <Link className="tf-run-link" href={"/traces/" + run.id}>
                        {run.name}
                        <small>{run.traceId}</small>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={"tf-status " + statusTone(run.status)}
                      >
                        {statusLabel(run.status)}
                      </Badge>
                      {run.errorCode ? (
                        <small className="tf-cell-note">{run.errorCode}</small>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span className="tf-model-name">{run.modelProvider}</span>
                    </TableCell>
                    <TableCell>{formatMs(run.latencyMs)}</TableCell>
                    <TableCell
                      title={"用量来源：" + usageSourceLabel(run.usageSource)}
                    >
                      {formatNumber(run.tokens)}
                    </TableCell>
                    <TableCell>
                      {run.cost === null ? "—" : "$" + formatMoney(run.cost)}
                    </TableCell>
                    <TableCell>{routeLabel(run.route)}</TableCell>
                    <TableCell className="muted">
                      {formatDate(run.startedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {displayRows.length === 0 ? (
            <p className="empty-state">所选范围暂无追踪运行</p>
          ) : null}
        </CardContent>
      </Card>
      <div className="tf-bottom-grid">
        <Card className="tf-panel">
          <CardHeader className="tf-panel-head">
            <div>
              <CardTitle>模型 / 供应商成本拆分</CardTitle>
              <CardDescription>所选范围 · 按调用跨度核算</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="tf-panel-content">
            <div className="tf-table-shell">
              <Table className="tf-dense-table tf-cost-table">
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
                  {modelRows.map((row) => (
                    <TableRow key={row.provider + "/" + row.model}>
                      <TableCell>
                        {row.model}
                        <small className="tf-cell-note">{row.provider}</small>
                      </TableCell>
                      <TableCell>{formatNumber(row.requestCount)}</TableCell>
                      <TableCell>
                        {compactNumber(row.promptTokens + row.completionTokens)}
                      </TableCell>
                      <TableCell>
                        {row.totalCost === null
                          ? "—"
                          : "$" + formatMoney(row.totalCost)}
                      </TableCell>
                      <TableCell>
                        {formatPercent(
                          totalCost && row.totalCost
                            ? ratio(Number(row.totalCost), Number(totalCost))
                            : null,
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {modelRows.length === 0 ? (
              <p className="empty-state">暂无模型用量</p>
            ) : null}
          </CardContent>
        </Card>
        <Card className="tf-panel">
          <CardHeader className="tf-panel-head">
            <div>
              <CardTitle>供应商健康</CardTitle>
              <CardDescription>成功率 · P95 延迟 · 失败次数</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="tf-provider-list">
            {providerRows.map((row) => (
              <div key={row.label} className="tf-provider-row">
                <span title={row.label}>{row.label}</span>
                <strong>{row.successRate.toFixed(2)}%</strong>
                <Progress value={row.successRate} className="tf-progress" />
                <small>{formatMs(row.p95)}</small>
                <em>{formatNumber(row.errors)} 失败</em>
              </div>
            ))}
            {providerRows.length === 0 ? (
              <p className="empty-state">暂无供应商调用</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <Card className="tf-panel">
        <CardHeader className="tf-panel-head">
          <div>
            <CardTitle>治理事件</CardTitle>
            <CardDescription>
              当前范围的数据库快照，应用筛选后更新
            </CardDescription>
          </div>
          <div className="tf-chart-summary">
            最慢跨度 {formatMs(governanceData.slowestSpan)} · 备用切换失败{" "}
            {formatNumber(governanceData.fallbackFailed)}
          </div>
        </CardHeader>
        <CardContent className="tf-governance-grid">
          <section>
            <div className="tf-section-line">
              <h3>限流失败</h3>
              <Link
                href={traceListHref(baseTraceQuery, {
                  errorCode: "rate_limited",
                })}
              >
                查看追踪 ↗
              </Link>
            </div>
            <div className="tf-rate-list">
              {rateRows.map((row) => (
                <div key={row.label} className="tf-rate-row">
                  <span title={row.label}>{row.label}</span>
                  <strong>{formatNumber(row.failures)}</strong>
                </div>
              ))}
              {rateRows.length === 0 ? (
                <p className="muted">暂无限流记录</p>
              ) : null}
            </div>
          </section>
          <section>
            <div className="tf-section-line">
              <h3>备用切换链路</h3>
            </div>
            <div className="tf-chain-list">
              {data.fallback.map((row) => (
                <div key={row.label}>
                  <span title={row.label}>{row.label}</span>
                  <strong>{formatNumber(row.count)}</strong>
                </div>
              ))}
              {data.fallback.length === 0 ? (
                <p className="muted">暂无备用切换</p>
              ) : null}
            </div>
          </section>
          <section>
            <div className="tf-section-line">
              <h3>流式中断原因</h3>
              <Link
                href={traceListHref(baseTraceQuery, {
                  errorCode: "stream_interrupted",
                })}
              >
                查看追踪 ↗
              </Link>
            </div>
            <div className="tf-reason-list">
              {streamReasons.map(([reason, count]) => (
                <div key={reason}>
                  <span>{reasonLabel(reason)}</span>
                  <strong>{formatNumber(count)}</strong>
                </div>
              ))}
              {streamReasons.length === 0 ? (
                <p className="muted">暂无流式中断</p>
              ) : null}
            </div>
          </section>
        </CardContent>
      </Card>
    </main>
  );
}
