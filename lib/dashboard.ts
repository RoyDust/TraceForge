import "server-only";
import { getConsoleDb } from "@/lib/dal";
import { dayRange } from "@/lib/format";
import { isUuid, InputError } from "@/lib/validation";

export type MetricRow = {
  date: string | null; requestCount: number; successCount: number; failureCount: number;
  promptTokens: bigint; completionTokens: bigint; totalCost: string | null;
  averageLatencyMs: number | null; p95LatencyMs: number | null;
};
type ModelRow = Omit<MetricRow, "date" | "successCount"> & { provider: string; model: string; limitCount: number };
type GovernanceRow = { fallbackTriggered: number; fallbackFailed: number; streamErrors: number; authCount: number; gatewayLimitCount: number; slowestSpan: number | null };
type CountRow = { label: string; count: number };

export async function getDashboardData(filters: { from: string; to: string; projectId?: string }) {
  const db = await getConsoleDb();
  filters = { ...filters, projectId: filters.projectId?.trim() || undefined };
  if (filters.projectId && !isUuid(filters.projectId)) throw new InputError("项目 ID 无效。");
  const range = dayRange(filters.from, filters.to);
  const values = [range.gte!, range.lt!, filters.projectId ?? null];
  // Values are bound parameters. Run counts are aggregated before joining spans/events.
  const base = [
    'WITH r AS (SELECT * FROM trace_run WHERE started_at >= $1::timestamp AND started_at < $2::timestamp AND ($3::uuid IS NULL OR project_id = $3::uuid)),',
    's AS (SELECT s.*, r.status AS run_status FROM trace_span s JOIN r ON r.id = s.run_id),',
    'e AS (SELECT e.*, s.run_id FROM trace_event e JOIN s ON s.id = e.span_id)',
  ].join('\n');
  const factQuery = base + ', tokens AS (SELECT run_id, SUM(prompt_tokens)::bigint AS pt, SUM(completion_tokens)::bigint AS ct FROM s GROUP BY run_id) ' +
    'SELECT to_char((r.started_at + interval \'8 hours\')::date, \'YYYY-MM-DD\') AS date, count(*)::int AS "requestCount", ' +
    'count(*) FILTER (WHERE r.status = \'success\')::int AS "successCount", count(*) FILTER (WHERE r.status IN (\'failed\',\'cancelled\'))::int AS "failureCount", ' +
    'COALESCE(SUM(t.pt),0)::bigint AS "promptTokens", COALESCE(SUM(t.ct),0)::bigint AS "completionTokens", SUM(r.cost)::text AS "totalCost", ' +
    'round(avg(r.latency_ms))::int AS "averageLatencyMs", percentile_disc(0.95) WITHIN GROUP (ORDER BY r.latency_ms)::int AS "p95LatencyMs" ' +
    'FROM r LEFT JOIN tokens t ON t.run_id = r.id GROUP BY GROUPING SETS ((), ((r.started_at + interval \'8 hours\')::date)) ORDER BY date NULLS FIRST';
  const modelQuery = base + ' SELECT COALESCE(provider,\'gateway\') AS provider, COALESCE(model,\'unknown\') AS model, ' +
    'count(DISTINCT run_id)::int AS "requestCount", count(DISTINCT run_id) FILTER (WHERE run_status IN (\'failed\',\'cancelled\') OR status IN (\'failed\',\'cancelled\'))::int AS "failureCount", ' +
    'COALESCE(SUM(prompt_tokens),0)::bigint AS "promptTokens", COALESCE(SUM(completion_tokens),0)::bigint AS "completionTokens", SUM(cost)::text AS "totalCost", ' +
    'round(avg(latency_ms))::int AS "averageLatencyMs", percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms)::int AS "p95LatencyMs", ' +
    'count(DISTINCT run_id) FILTER (WHERE error_code IN (\'rate_limited\',\'concurrency_limited\'))::int AS "limitCount" FROM s GROUP BY provider, model ORDER BY SUM(cost) DESC NULLS LAST';
  const governanceQuery = base + ' SELECT (SELECT count(*)::int FROM e WHERE type=\'fallback_triggered\') AS "fallbackTriggered", (SELECT count(*)::int FROM e WHERE type=\'fallback_failed\') AS "fallbackFailed", ' +
    '(SELECT count(*)::int FROM r WHERE error_code=\'stream_interrupted\' OR EXISTS (SELECT 1 FROM s WHERE s.run_id=r.id AND s.error_code=\'stream_interrupted\')) AS "streamErrors", ' +
    '(SELECT count(*)::int FROM r WHERE error_code IN (\'invalid_api_key\',\'revoked_api_key\')) AS "authCount", ' +
    '(SELECT count(*)::int FROM r WHERE error_code IN (\'rate_limited\',\'concurrency_limited\') AND NOT EXISTS (SELECT 1 FROM s WHERE s.run_id=r.id AND s.error_code IN (\'rate_limited\',\'concurrency_limited\'))) AS "gatewayLimitCount", ' +
    '(SELECT max(latency_ms)::int FROM s) AS "slowestSpan"';
  const fallbackQuery = base + ' SELECT COALESCE(payload->>\'from_model\',payload->>\'from\',\'未知起点\') || \' → \' || COALESCE(payload->>\'to_model\',payload->>\'to\',\'未知终点\') AS label, count(*)::int AS count FROM e WHERE type=\'fallback_triggered\' GROUP BY label ORDER BY count DESC LIMIT 20';
  const reasonsQuery = base + ' SELECT COALESCE(payload->>\'error_code\',payload->>\'reason\',type::text) AS label, count(*)::int AS count FROM e WHERE type IN (\'stream_error\',\'stream_cancelled\') GROUP BY label ORDER BY count DESC LIMIT 20';
  const [facts, models, governance, fallback, reasons, runs, projects, usage] = await db.$transaction([
    db.$queryRawUnsafe<MetricRow[]>(factQuery, ...values),
    db.$queryRawUnsafe<ModelRow[]>(modelQuery, ...values),
    db.$queryRawUnsafe<GovernanceRow[]>(governanceQuery, ...values),
    db.$queryRawUnsafe<CountRow[]>(fallbackQuery, ...values),
    db.$queryRawUnsafe<CountRow[]>(reasonsQuery, ...values),
    db.traceRun.findMany({ where: { startedAt: range, ...(filters.projectId ? { projectId: filters.projectId } : {}) }, orderBy: { startedAt: "desc" }, take: 9, include: { project: true, spans: { take: 20, orderBy: { startedAt: "asc" }, include: { events: { take: 10, orderBy: { createdAt: "desc" } } } } } }),
    db.project.findMany({ orderBy: { createdAt: "asc" } }),
    db.usageDaily.groupBy({ by: ["date"], orderBy: { date: "asc" }, where: { modelConfigId: null, date: { gte: new Date(filters.from + "T00:00:00Z"), lte: new Date(filters.to + "T00:00:00Z") }, ...(filters.projectId ? { projectId: filters.projectId } : {}) }, _sum: { requestCount: true, successCount: true, failureCount: true, promptTokens: true, completionTokens: true, totalCost: true } }),
  ], { isolationLevel: "RepeatableRead", timeout: 15000 });
  let rollupDays = 0;
  const trends = facts.filter((row) => row.date !== null).map((row) => {
    const bucket = usage.find((u) => u.date.toISOString().slice(0,10) === row.date)?._sum;
    // Use persisted rollups only when they reconcile with this snapshot. Never mix stale buckets.
    if (bucket && bucket.requestCount === row.requestCount && bucket.successCount === row.successCount && bucket.failureCount === row.failureCount && bucket.promptTokens === row.promptTokens && bucket.completionTokens === row.completionTokens && row.totalCost !== null && bucket.totalCost?.equals(row.totalCost)) {
      rollupDays++;
      return { ...row, requestCount: bucket.requestCount, totalCost: bucket.totalCost.toString() };
    }
    return row;
  });
  return { metrics: facts[0], trends, models, governance: governance[0], fallback, reasons, runs, projects, rollupDays };
}
