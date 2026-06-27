import Link from "next/link";
import { TraceStatus, type Prisma } from "@prisma/client";
import { compactId, formatDate, formatMoney, formatMs, formatNumber } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import {
  type ResponsibilityDomain,
  responsibilityDescription,
  responsibilityForRun,
} from "@/lib/responsibility";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type ProjectRow = Prisma.ProjectGetPayload<Record<string, never>>;
type TraceRunRow = Prisma.TraceRunGetPayload<{
  include: {
    project: true;
    spans: {
      select: {
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

const PAGE_SIZE = 20;
const STATUS_OPTIONS = new Set<string>(Object.values(TraceStatus));
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

function displaySpan(run: TraceRunRow) {
  return (
    run.spans.find((span) => span.errorCode || span.status === TraceStatus.failed || span.status === TraceStatus.cancelled) ??
    run.spans.find((span) => span.model || span.provider) ??
    null
  );
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
  };

  const page = Math.max(1, Number.parseInt(filters.page ?? "1", 10) || 1);
  const clauses: Prisma.TraceRunWhereInput[] = [];
  if (filters.projectId) clauses.push({ projectId: filters.projectId });
  if (filters.status && STATUS_OPTIONS.has(filters.status)) clauses.push({ status: filters.status as TraceStatus });
  if (filters.errorCode) clauses.push({ errorCode: filters.errorCode });
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
          spans: {
            select: {
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
  };
  const hasNext = page * PAGE_SIZE < total;

  return (
    <main>
      <header className="page-head">
        <div>
          <p className="eyebrow">TraceRun List</p>
          <h1>TraceRuns</h1>
          <p className="muted">按失败状态、错误码、模型和时间窗口筛出需要定位的调用。</p>
        </div>
        <span className="badge">{formatNumber(total)} runs</span>
      </header>

      <form className="filter-form" method="get">
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
          状态
          <select name="status" defaultValue={filters.status ?? ""}>
            <option value="">全部状态</option>
            <option value="running">running</option>
            <option value="success">success</option>
            <option value="failed">failed</option>
            <option value="cancelled">cancelled</option>
          </select>
        </label>
        <label>
          错误码
          <input name="errorCode" defaultValue={filters.errorCode ?? ""} placeholder="stream_interrupted" />
        </label>
        <label>
          模型 / Provider
          <input name="model" defaultValue={filters.model ?? ""} placeholder="mock / deepseek" />
        </label>
        <label>
          起始
          <input name="from" type="date" defaultValue={filters.from ?? ""} />
        </label>
        <label>
          结束
          <input name="to" type="date" defaultValue={filters.to ?? ""} />
        </label>
        <div className="filter-actions">
          <button type="submit">筛选</button>
          <Link className="button secondary" href="/traces">
            重置
          </Link>
        </div>
      </form>

      {readError ? (
        <section className="error-state" role="alert">
          <h2>读取失败</h2>
          <p>{readError}</p>
        </section>
      ) : rows.length === 0 ? (
        <section className="empty-state">
          <h2>没有匹配的 TraceRun</h2>
          <p className="muted">运行 `node scripts/stage3-demo.mjs` 生成 success、stream、fallback、限流和撤销 Key 样例。</p>
        </section>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>项目</th>
                  <th>状态</th>
                  <th>错误码</th>
                  <th>责任域</th>
                  <th>模型 / Provider</th>
                  <th>Latency</th>
                  <th>Tokens</th>
                  <th>Cost</th>
                  <th>Usage</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((run) => {
                  const span = displaySpan(run);
                  const domain = responsibilityForRun(run);
                  const modelProvider = span ? `${span.provider ?? "—"} / ${span.model ?? "—"}` : "网关层拒绝";
                  return (
                    <tr key={run.id}>
                      <td>
                        <div className="meta-stack">
                          <Link className="row-link" href={`/traces/${run.id}`}>
                            {run.name ?? "unnamed"} · {compactId(run.id)}
                          </Link>
                          <small className="muted">{run.id}</small>
                        </div>
                      </td>
                      <td>{run.project.name}</td>
                      <td>
                        <span className={badgeClass(run.status)}>{run.status}</span>
                      </td>
                      <td>{run.errorCode ? <code>{run.errorCode}</code> : "—"}</td>
                      <td>{domainBadge(domain) ?? "—"}</td>
                      <td>{modelProvider}</td>
                      <td>{formatMs(run.latencyMs)}</td>
                      <td>{formatNumber(run.totalTokens)}</td>
                      <td>{formatMoney(run.cost)}</td>
                      <td>{run.usageSource ? <span className={badgeClass(run.usageSource)}>{run.usageSource}</span> : "—"}</td>
                      <td>{formatDate(run.startedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <nav className="pager" aria-label="分页">
            {page > 1 ? (
              <Link className="button secondary" href={buildQuery(baseQuery, { page: page - 1 })}>
                上一页
              </Link>
            ) : (
              <span />
            )}
            {hasNext ? (
              <Link className="button secondary" href={buildQuery(baseQuery, { page: page + 1 })}>
                下一页
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </>
      )}
    </main>
  );
}
