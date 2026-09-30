import Link from "next/link";
import { TraceStatus, type Prisma } from "@prisma/client";
import {
  AlertTriangle,
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
import { getDashboardData } from "@/lib/dashboard";
import { shanghaiDay } from "@/lib/format";
import { ratio } from "@/lib/ui-metrics";
import { responsibilityForRun } from "@/lib/responsibility";
import { cn } from "@/lib/utils";

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

function defaultFrom() { return shanghaiDay(new Date(Date.now() - 13 * 86400000)); }

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
    route: run.spans.some((span) => span.events.some((event) => event.type === "fallback_triggered")) ? "fallback" : "primary",
    latencyMs: run.latencyMs ?? span?.latencyMs ?? null,
    tokens: run.totalTokens,
    cost: run.cost?.toString() ?? null,
    usageSource: run.usageSource,
    startedAt: run.startedAt,
  };
}

function Sparkline({ points, tone = "ok" }: { points: number[]; tone?: "ok" | "danger" | "warning" | "neutral" }) {
  if (points.length < 2) return <small className="muted">暂无趋势</small>;
  const max = Math.max(...points), min = Math.min(...points);
  const coords = points.map((v, i) => (i / (points.length - 1) * 128).toFixed(1) + "," + (34 - (v - min) / Math.max(max - min, 1) * 28).toFixed(1)).join(" ");
  return <svg className={"tf-sparkline " + tone} viewBox="0 0 128 40" role="img" aria-label="趋势"><polyline points={coords} fill="none" stroke="currentColor" strokeWidth="2" /></svg>;
}
function KpiTile({ label, value, points, tone = "ok" }: { label: string; value: string; points: number[]; tone?: "ok" | "danger" | "warning" | "neutral" }) {
  return <Card className="tf-kpi-card" size="sm" data-source="database"><CardHeader className="tf-kpi-head"><CardDescription>{label}</CardDescription></CardHeader><CardContent className="tf-kpi-content"><strong>{value}</strong><Sparkline points={points} tone={tone} /></CardContent></Card>;
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


function providerName(provider: string, model: string) {
  return `${provider} / ${model}`;
}

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const rawParams = await searchParams;
  const filters = { projectId: one(rawParams.projectId)?.trim() || undefined, from: one(rawParams.from)?.trim() || defaultFrom(), to: one(rawParams.to)?.trim() || shanghaiDay(new Date()) };
  const data = await getDashboardData(filters);
  const { metrics, runs, projects, trends: trendRows } = data;
  const modelRows = data.models.map((row) => ({ ...row, failureRate: ratio(row.failureCount, row.requestCount) }));
  const governanceData = data.governance;
  const baseTraceQuery = filters;
  const displayRows = runs.map(presentRun);
  const selectedRun = displayRows.find((run) => run.status === "failed") ?? displayRows[0];
  const selectedEvents = runs.find((run) => run.id === selectedRun?.id)?.spans.flatMap((span) => span.events).slice(0, 8) ?? [];
  const fallbackCount = governanceData.fallbackTriggered;
  const streamErrorCount = governanceData.streamErrors;
  const requestCount = metrics.requestCount;
  const failureRate = ratio(metrics.failureCount, requestCount);
  const p95Latency = metrics.p95LatencyMs;
  const tokenTotal = metrics.promptTokens + metrics.completionTokens;
  const totalCost = metrics.totalCost;
  const chartRows = trendRows.map((row) => ({ label: row.date!.slice(5), requests: row.requestCount, errors: row.failureCount }));
  const maxChartRequests = Math.max(1, ...chartRows.map((row) => row.requests));
  const providerRows = modelRows.map((row) => ({ label: providerName(row.provider, row.model), successRate: 100 * (1 - (row.failureRate ?? 0)), p95: row.p95LatencyMs, errors: row.failureCount }));
  const rateRows = modelRows.map((row) => ({ label: providerName(row.provider, row.model), failures: row.limitCount }));
  if (governanceData.gatewayLimitCount) rateRows.push({ label: "网关拒绝（未达模型）", failures: governanceData.gatewayLimitCount });
  const streamReasons = data.reasons.map((row) => [row.label, row.count] as const);

  return (
    <main className="tf-dashboard">
      <header className="tf-page-title">
        <div>
          <h1>治理总览</h1>
          <p>集中查看追踪运行、供应商健康、限流、成本和 Token 压力。</p>
        </div>
        <form className="tf-title-filter" method="get">
          <input type="hidden" name="from" value={filters.from} />
          <input type="hidden" name="to" value={filters.to} />
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

      {requestCount === 0 ? <p className="empty-state" role="status">当前范围暂无运行数据。接入网关或显式执行演示 seed 后查看指标。</p> : null}
      <section className="tf-kpi-strip" aria-label="治理总览关键指标">
        <KpiTile label="请求量" value={formatNumber(requestCount) + " 次"} points={trendRows.map((r) => r.requestCount)} />
        <KpiTile label="失败率" value={formatPercent(failureRate)} points={trendRows.map((r) => r.requestCount ? r.failureCount / r.requestCount : 0)} tone="danger" />
        <KpiTile label="P95 延迟" value={formatMs(p95Latency)} points={trendRows.flatMap((r) => r.p95LatencyMs === null ? [] : [r.p95LatencyMs])} />
        <KpiTile label="成本" value={totalCost === null ? "—" : "$" + formatMoney(totalCost)} points={trendRows.flatMap((r) => r.totalCost === null ? [] : [Number(r.totalCost)])} />
        <KpiTile label="令牌" value={compactNumber(tokenTotal)} points={trendRows.map((r) => Number(r.promptTokens + r.completionTokens))} />
        <KpiTile label="备用切换" value={formatNumber(fallbackCount)} points={[]} tone="warning" />
        <KpiTile label="流式错误" value={formatNumber(streamErrorCount)} points={[]} tone="danger" />
      </section>
      {requestCount > 0 && totalCost === null ? <p className="muted" role="status">当前范围存在成本未知的运行，成本合计及占比暂不展示。</p> : null}

      <form className="tf-filter-strip" method="get">
        <div className="tf-filter-tabs" aria-label="状态筛选">
          <Badge variant="secondary">全部状态</Badge>
          <Badge variant="outline">全部供应商</Badge>
          <Badge variant="outline">全部模型</Badge>
          <Badge variant="outline">全部错误码</Badge>
          <Badge variant="outline">所选日期范围</Badge>
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
                  {formatNumber(requestCount)} 条结果
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
                      <TableHead>延迟（毫秒）</TableHead>
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
                          <Link className="tf-run-link" href={`/traces/${run.id}`}>
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
                            {selectedRun.domain ?? "—"}
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
                    <ol className="tf-event-list">{selectedEvents.map((event) => <li key={event.id}><span>{formatDate(event.createdAt)}</span><strong>{event.type}</strong></li>)}</ol>
                    {selectedEvents.length === 0 ? <p>暂无事件记录</p> : null}
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
                  <CardDescription>上海日期范围 · {data.rollupDays} 天 UsageDaily 已核对</CardDescription>
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
                        <span style={{ height: `${(row.requests / maxChartRequests) * 100}%` }} />
                      </span>
                      <small>{row.label}</small>
                    </div>
                  ))}
                </div>
                <div className="tf-chart-summary">
                  <span>总计 {formatNumber(requestCount)} 次请求</span>
                  <span>错误 {formatNumber(metrics.failureCount)}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="tf-panel">
              <CardHeader className="tf-panel-head">
                <div>
                  <CardTitle>模型 / 供应商成本拆分</CardTitle>
                  <CardDescription>所选日期范围 · 按 Span 核算</CardDescription>
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
                      {(modelRows.length > 0 ? modelRows : []).map((row) => (
                        <TableRow key={`${row.provider}/${row.model}`}>
                          <TableCell>{row.model}</TableCell>
                          <TableCell>{formatNumber(row.requestCount)}</TableCell>
                          <TableCell>{compactNumber(row.promptTokens + row.completionTokens)}</TableCell>
                          <TableCell>{row.totalCost === null ? "—" : `$${formatMoney(row.totalCost)}`}</TableCell>
                          <TableCell>{formatPercent(totalCost && row.totalCost ? ratio(Number(row.totalCost), Number(totalCost)) : null)}</TableCell>
                        </TableRow>
                      ))}

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
                <CardDescription>本次请求数据库快照</CardDescription>
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
                      <small>限流拒绝次数</small>
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
                <div className="tf-chain-list">{data.fallback.map((row) => <div key={row.label}><span>{row.label}</span><strong>{formatNumber(row.count)}</strong></div>)}{data.fallback.length === 0 ? <p>暂无备用切换</p> : null}</div>
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
                    </div>
                  ))}
                </div>
              </section>

              <section className="tf-signal-grid">
                <div>
                  <AlertTriangle aria-hidden="true" />
                  <span>最慢调用跨度</span>
                  <strong>{formatMs(governanceData.slowestSpan)}</strong>
                </div>
                <div>
                  <CheckCircle2 aria-hidden="true" />
                  <span>备用切换失败</span>
                  <strong>{formatNumber(governanceData.fallbackFailed)}</strong>
                </div>
              </section>
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}
