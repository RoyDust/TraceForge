import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { formatDate, formatNumber, formatPercent } from "@/lib/format";
import { passRate } from "@/lib/eval-runner";
import { prisma } from "@/lib/prisma";
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

export default async function EvalsPage({ searchParams }: { searchParams: SearchParams }) {
  const rawParams = await searchParams;
  const projectId = one(rawParams.projectId)?.trim();
  let projects: ProjectRow[] = [];
  let datasets: DatasetRow[] = [];
  let readError: string | null = null;

  try {
    [projects, datasets] = await Promise.all([
      prisma.project.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.evalDataset.findMany({
        where: projectId ? { projectId } : {},
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
  } catch (error) {
    console.error(error);
    readError = "无法读取 Eval 数据。请确认数据库连接可用。";
  }

  return (
    <main>
      <header className="page-head">
        <div>
          <p className="eyebrow">Stage 6 Eval</p>
          <h1>Eval 回归评测</h1>
          <p className="muted">把 PromptVersion 变成可重复验证的上线闸门。</p>
        </div>
        <span className="badge">{formatNumber(datasets.length)} datasets</span>
      </header>

      <form className="filter-form prompt-filter" method="get">
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
        <div className="filter-actions">
          <button type="submit">筛选</button>
          <Link className="button secondary" href="/evals">
            重置
          </Link>
        </div>
      </form>

      {readError ? (
        <section className="error-state" role="alert">
          <h2>读取失败</h2>
          <p>{readError}</p>
        </section>
      ) : (
        <div className="detail-grid">
          <section className="section">
            <div className="section-heading">
              <div>
                <h2>Dataset 列表</h2>
                <p className="muted">每个 Dataset 是一组可复跑的 Prompt 回归样本。</p>
              </div>
            </div>
            {datasets.length === 0 ? (
              <div className="empty-state">
                <h3>还没有 EvalDataset</h3>
                <p className="muted">运行 `node scripts/stage6-demo.mjs` 生成样例，或在右侧创建。</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Project</th>
                      <th>Cases</th>
                      <th>Runs</th>
                      <th>Latest</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datasets.map((dataset) => {
                      const run = latestRun(dataset);
                      return (
                        <tr key={dataset.id}>
                          <td>
                            <div className="meta-stack">
                              <Link className="row-link" href={`/evals/${dataset.id}`}>
                                {dataset.name}
                              </Link>
                              <small className="muted">{dataset.description ?? "—"}</small>
                            </div>
                          </td>
                          <td>{dataset.project.name}</td>
                          <td>{formatNumber(dataset._count.cases)}</td>
                          <td>{formatNumber(dataset._count.runs)}</td>
                          <td>
                            {run ? (
                              <Link className="row-link" href={`/evals/runs/${run.id}`}>
                                {run.promptVersion?.prompt.name ?? "Prompt"} · {formatPercent(passRate(run.results))}
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

          <aside className="section">
            <section className="section-band">
              <h2>创建 Dataset</h2>
              <form className="stack-form" action={createEvalDatasetAction}>
                <label>
                  项目
                  <select name="projectId" required defaultValue={projectId ?? projects[0]?.id ?? ""}>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  名称
                  <input name="name" required placeholder="support-agent-regression" />
                </label>
                <label>
                  描述
                  <input name="description" placeholder="覆盖关键回复格式、JSON 和人工复核样本" />
                </label>
                <button type="submit">创建 Dataset</button>
              </form>
            </section>
          </aside>
        </div>
      )}
    </main>
  );
}
