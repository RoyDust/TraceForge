import Link from "next/link";
import { TraceEventType, TraceStatus, type Prisma } from "@prisma/client";
import {
  compactId,
  formatDate,
  formatMoney,
  formatMs,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import { prisma } from "@/lib/prisma";

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

function kpi(label: string, value: string, detail?: string) {
  return (
    <div className="summary-cell">
      <small>{label}</small>
      <strong>{value}</strong>
      {detail ? <span className="metric-note">{detail}</span> : null}
    </div>
  );
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

  for (const [day, dayRuns] of Object.entries(Object.groupBy(runs, (run) => isoDay(run.startedAt)))) {
    if (!dayRuns) continue;
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
      const provider = span.provider ?? "unknown provider";
      const model = span.model ?? "unknown model";
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
    readError = "无法读取 Dashboard 数据。请确认 DATABASE_URL 可用，并先运行 Stage 4 demo 或聚合脚本。";
  }

  const metrics = collectMetrics(runs);
  const trendRows = dailyTrend(usageRows, runs);
  const modelRows = modelBreakdown(runs);
  const governanceData = governance(runs);
  const maxDailyCost = Math.max(0.000001, ...trendRows.map((row) => row.totalCost));

  return (
    <main>
      <header className="page-head">
        <div>
          <p className="eyebrow">Stage 4 Dashboard</p>
          <h1>成本与运行治理</h1>
          <p className="muted">从项目成本、模型稳定性、限流和 fallback 事件定位治理问题。</p>
        </div>
        <Link className="button secondary" href={traceListHref(baseTraceQuery, {})}>
          查看 TraceRuns
        </Link>
      </header>

      <form className="filter-form dashboard-filter" method="get">
        <label>
          项目
          <select name="projectId" defaultValue={filters.projectId ?? ""}>
            <option value="">全部项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          起始
          <input name="from" type="date" defaultValue={filters.from} />
        </label>
        <label>
          结束
          <input name="to" type="date" defaultValue={filters.to} />
        </label>
        <div className="filter-actions">
          <button type="submit">刷新</button>
          <Link className="button secondary" href="/dashboard">
            重置
          </Link>
        </div>
      </form>

      {readError ? (
        <section className="error-state" role="alert">
          <h2>读取失败</h2>
          <p>{readError}</p>
        </section>
      ) : runs.length === 0 && usageRows.length === 0 ? (
        <section className="empty-state">
          <h2>没有 Dashboard 数据</h2>
          <p className="muted">运行 `node scripts/stage4-demo.mjs` 生成 mock Trace 并重建 UsageDaily。</p>
        </section>
      ) : (
        <>
          <section className="summary-grid dashboard-kpis" aria-label="Dashboard KPIs">
            {kpi("Requests", formatNumber(metrics.requestCount), `${formatNumber(metrics.successCount)} success`)}
            {kpi("Failures", formatNumber(metrics.failureCount), formatPercent(metrics.failureRate))}
            {kpi("Prompt Tokens", formatNumber(metrics.promptTokens))}
            {kpi("Completion Tokens", formatNumber(metrics.completionTokens))}
            {kpi("Total Tokens", formatNumber(metrics.totalTokens))}
            {kpi("Cost", formatMoney(metrics.totalCost))}
            {kpi("Avg Latency", formatMs(metrics.averageLatencyMs))}
            {kpi("P95 Latency", formatMs(metrics.p95LatencyMs))}
          </section>

          <section className="section">
            <div className="section-heading">
              <div>
                <h2>UsageDaily 日趋势</h2>
                <p className="muted">长期趋势来自 UsageDaily；P95 由所选区间内 TraceRun 明细计算。</p>
              </div>
              <span className="badge">{formatNumber(trendRows.length)} days</span>
            </div>
            {trendRows.length === 0 ? (
              <div className="empty-state">
                <h3>UsageDaily 还没有聚合行</h3>
                <p className="muted">运行 `node scripts/aggregate-usage-daily.mjs --from={filters.from} --to={filters.to}` 后刷新。</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Requests</th>
                      <th>Failure</th>
                      <th>Prompt</th>
                      <th>Completion</th>
                      <th>Cost</th>
                      <th>Avg</th>
                      <th>P95</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trendRows.map((row) => (
                      <tr key={row.date}>
                        <td>{row.date}</td>
                        <td>{formatNumber(row.requestCount)}</td>
                        <td>
                          <span className="meta-stack">
                            <strong>{formatNumber(row.failureCount)}</strong>
                            <small className="muted">{formatPercent(ratio(row.failureCount, row.requestCount))}</small>
                          </span>
                        </td>
                        <td>{formatNumber(row.promptTokens)}</td>
                        <td>{formatNumber(row.completionTokens)}</td>
                        <td>
                          <span className="trend-cell">
                            {formatMoney(row.totalCost)}
                            <span className="trend-track">
                              <span className="trend-bar" style={{ width: `${Math.max(3, (row.totalCost / maxDailyCost) * 100)}%` }} />
                            </span>
                          </span>
                        </td>
                        <td>{formatMs(row.averageLatencyMs)}</td>
                        <td>{formatMs(row.p95LatencyMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="detail-grid">
            <section className="section">
              <div className="section-heading">
                <div>
                  <h2>Model / Provider 拆分</h2>
                  <p className="muted">按上游模型比较成本、token、失败率和 P95。</p>
                </div>
                <span className="badge">{formatNumber(modelRows.length)} groups</span>
              </div>
              {modelRows.length === 0 ? (
                <div className="empty-state">
                  <h3>没有模型 Span</h3>
                  <p className="muted">网关拒绝类 Run 不会生成上游模型 Span。</p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Provider / Model</th>
                        <th>Requests</th>
                        <th>Failure</th>
                        <th>Tokens</th>
                        <th>Cost</th>
                        <th>Latency</th>
                        <th>Usage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modelRows.map((row) => (
                        <tr key={`${row.provider}/${row.model}`}>
                          <td>
                            <div className="meta-stack">
                              <Link className="row-link" href={traceListHref(baseTraceQuery, { model: row.model })}>
                                {row.provider} / {row.model}
                              </Link>
                              <small className="muted">drill back to TraceRuns</small>
                            </div>
                          </td>
                          <td>{formatNumber(row.requestCount)}</td>
                          <td>
                            <span className="meta-stack">
                              <strong>{formatNumber(row.failureCount)}</strong>
                              <small className="muted">{formatPercent(row.failureRate)}</small>
                            </span>
                          </td>
                          <td>{formatNumber(row.promptTokens + row.completionTokens)}</td>
                          <td>{formatMoney(row.totalCost)}</td>
                          <td>
                            <span className="meta-stack">
                              <strong>{formatMs(row.averageLatencyMs)}</strong>
                              <small className="muted">P95 {formatMs(row.p95LatencyMs)}</small>
                            </span>
                          </td>
                          <td>
                            <span className="meta-stack">
                              <span className="badge provider">{formatNumber(row.providerUsage)} provider</span>
                              <span className="badge estimated">{formatNumber(row.estimatedUsage)} estimated</span>
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <aside className="section">
              <div className="section-heading">
                <div>
                  <h2>治理事件</h2>
                  <p className="muted">限流、网关拒绝和 fallback 是治理事实，不混入 Prompt/Eval。</p>
                </div>
              </div>
              <div className="governance-grid">
                <div className="section-band">
                  <h3>限流拒绝</h3>
                  <strong className="metric-large">{formatNumber(governanceData.limitRuns.length)}</strong>
                  <Link className="button secondary" href={traceListHref(baseTraceQuery, { status: "failed", errorCode: "rate_limited" })}>
                    查看 rate_limited
                  </Link>
                </div>
                <div className="section-band">
                  <h3>网关拒绝</h3>
                  <strong className="metric-large">{formatNumber(governanceData.authRuns.length)}</strong>
                  <Link className="button secondary" href={traceListHref(baseTraceQuery, { status: "failed", errorCode: "revoked_api_key" })}>
                    查看 revoked_key
                  </Link>
                </div>
                <div className="section-band">
                  <h3>Fallback Triggered</h3>
                  <strong className="metric-large">{formatNumber(governanceData.fallbackTriggered.length)}</strong>
                  {governanceData.fallbackTriggered[0] ? (
                    <Link className="button secondary" href={`/traces/${governanceData.fallbackTriggered[0].run.id}`}>
                      打开样例
                    </Link>
                  ) : null}
                </div>
                <div className="section-band">
                  <h3>Fallback Failed</h3>
                  <strong className="metric-large">{formatNumber(governanceData.fallbackFailed.length)}</strong>
                  <span className="muted">全链路失败时出现</span>
                </div>
                <div className="section-band">
                  <h3>Stream Interrupted</h3>
                  <strong className="metric-large">{formatNumber(governanceData.streamInterruptedRuns.length)}</strong>
                  {governanceData.streamInterruptedRuns[0] ? (
                    <Link className="button secondary" href={`/traces/${governanceData.streamInterruptedRuns[0].id}`}>
                      打开样例
                    </Link>
                  ) : null}
                </div>
              </div>

              {governanceData.fallbackTriggered.length > 0 ? (
                <section className="section-band">
                  <h3>最近 fallback Run</h3>
                  <div className="metric-list">
                    {governanceData.fallbackTriggered.slice(0, 5).map(({ run, event }) => (
                      <Link key={event.id} href={`/traces/${run.id}`}>
                        {run.name ?? "unnamed"} · {compactId(run.id)} · {formatDate(run.startedAt)}
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null}
            </aside>
          </div>
        </>
      )}
    </main>
  );
}
