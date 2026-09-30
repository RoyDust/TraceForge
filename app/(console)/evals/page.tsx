import { expireEvalRuns } from "@/lib/eval-runner";
import { randomUUID } from "node:crypto";
import {
  ActionForm,
  CreateActionDialog,
} from "@/components/traceforge/action-form";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { passRate } from "@/lib/eval-runner";
import { getConsoleDb } from "@/lib/dal";
import { createEvalDatasetAction } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type ProjectRow = Prisma.ProjectGetPayload<Record<string, never>>;
type DatasetRow = Prisma.EvalDatasetGetPayload<{
  include: {
    project: true;
    _count: { select: { cases: true; runs: true } };
    runs: {
      include: {
        results: { select: { pass: true } };
        promptVersion: { include: { prompt: true } };
      };
    };
  };
}>;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function latestRun(dataset: DatasetRow) {
  return dataset.runs[0] ?? null;
}

export default async function EvalsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const prisma = await getConsoleDb();
  await expireEvalRuns(prisma);
  const rawParams = await searchParams;
  const projectId = one(rawParams.projectId)?.trim();
  const q = one(rawParams.q)?.trim() ?? "";
  let projects: ProjectRow[] = [];
  let datasets: DatasetRow[] = [];

  [projects, datasets] = await Promise.all([
    prisma.project.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.evalDataset.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        project: true,
        _count: { select: { cases: true, runs: true } },
        runs: {
          include: {
            results: { select: { pass: true } },
            promptVersion: { include: { prompt: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <main className="tf-library-page">
      <header className="page-head">
        <div>
          <h1>回归评测</h1>
          <p className="muted">把提示词版本变成可重复验证的上线闸门。</p>
        </div>
        <CreateActionDialog
          title="创建数据集"
          trigger="新建数据集"
          description="创建数据集后添加样本，再选择提示词版本执行回归。"
        >
          <ActionForm className="stack-form" action={createEvalDatasetAction}>
            <input type="hidden" name="requestId" value={randomUUID()} />
            <label>
              项目
              <select
                name="projectId"
                required
                defaultValue={projectId ?? projects[0]?.id ?? ""}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              名称
              <input name="name" required placeholder="客服智能体回归" />
            </label>
            <label>
              描述
              <input
                name="description"
                placeholder="覆盖关键回复格式、结构化输出和人工复核样本"
              />
            </label>
            <button type="submit">创建数据集</button>
          </ActionForm>
        </CreateActionDialog>
      </header>

      <form
        className="filter-form prompt-filter tf-library-filter"
        method="get"
      >
        <label>
          项目
          <select name="projectId" defaultValue={projectId ?? ""}>
            <option value="">全部项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          搜索
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="搜索数据集名称或描述"
            aria-label="搜索数据集"
          />
        </label>
        <div className="filter-actions">
          <button type="submit">筛选</button>
          <Link className="button secondary" href="/evals">
            重置
          </Link>
        </div>
      </form>

      {
        <div className="tf-library-content">
          <section className="section">
            <div className="section-heading">
              <div>
                <h2>
                  数据集列表{" "}
                  <span className="tf-count">
                    {formatNumber(datasets.length)}
                  </span>
                </h2>
                <p className="muted">
                  每个数据集是一组可复跑的提示词回归样本。
                </p>
              </div>
            </div>
            {datasets.length === 0 ? (
              <div className="empty-state">
                <h3>
                  {q || projectId ? "没有匹配的数据集" : "还没有评测数据集"}
                </h3>
                <p className="muted">
                  调整搜索或项目条件，或点击“新建数据集”开始。
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th>项目</th>
                      <th>样本</th>
                      <th>运行</th>
                      <th>最新结果</th>
                      <th>创建时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datasets.map((dataset) => {
                      const run = latestRun(dataset);
                      return (
                        <tr key={dataset.id}>
                          <td>
                            <div className="meta-stack">
                              <Link
                                className="row-link"
                                href={`/evals/${dataset.id}`}
                              >
                                {dataset.name}
                              </Link>
                              <small className="muted">
                                {dataset.description ?? "—"}
                              </small>
                            </div>
                          </td>
                          <td>{dataset.project.name}</td>
                          <td>{formatNumber(dataset._count.cases)}</td>
                          <td>{formatNumber(dataset._count.runs)}</td>
                          <td>
                            {run ? (
                              <Link
                                className="row-link"
                                href={`/evals/runs/${run.id}`}
                              >
                                {run.promptVersion?.prompt.name ?? "提示词"} ·{" "}
                                {formatPercent(passRate(run.results))}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>{formatDate(dataset.createdAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      }
    </main>
  );
}
