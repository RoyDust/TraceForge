import { expireEvalRuns } from "@/lib/eval-runner";
import { randomUUID } from "node:crypto";
import { ActionForm } from "@/components/traceforge/action-form";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/validation";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { compactId, formatDate, formatFullDate, formatMoney, formatMs, formatPercent } from "@/lib/format";
import { passRate } from "@/lib/eval-runner";
import { getConsoleDb } from "@/lib/dal";
import { reviewEvalResultAction } from "../../actions";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type EvalRunDetail = Prisma.EvalRunGetPayload<{
  include: {
    dataset: { include: { project: true } };
    promptVersion: { include: { prompt: true } };
    modelConfig: { include: { provider: true } };
    results: { include: { evalCase: true } };
  };
}>;

function resultBadge(result: EvalRunDetail["results"][number]) {
  if (result.status === "needs_review") return <span className="badge estimated">需复核</span>;
  if (result.pass === true) return <span className="badge provider">通过</span>;
  return <span className="badge failed">失败</span>;
}

function scoreText(value: { toString(): string } | null) {
  return value?.toString() ?? "—";
}

function evalStatusLabel(status: string | null | undefined) {
  if (status === "completed") return "已完成";
  if (status === "running") return "运行中";
  if (status === "failed") return "失败";
  if (status === "needs_review") return "需复核";
  if (status === "pending") return "待处理";
  return status ?? "未知";
}

export default async function EvalRunPage({ params }: { params: Params }) {
  const prisma = await getConsoleDb();
  await expireEvalRuns(prisma);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  let run: EvalRunDetail | null = null;
  let siblingRuns: Array<{ id: string; createdAt: Date; promptVersion: { version: number; prompt: { name: string } } | null }> = [];

  run = await prisma.evalRun.findUnique({
    where: { id },
    include: {
      dataset: { include: { project: true } },
      promptVersion: { include: { prompt: true } },
      modelConfig: { include: { provider: true } },
      results: { include: { evalCase: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (run) {
    siblingRuns = await prisma.evalRun.findMany({
      where: { datasetId: run.datasetId, NOT: { id: run.id } },
      include: { promptVersion: { include: { prompt: true } } },
      orderBy: { createdAt: "desc" },
      take: 8,
    });
  }


  if (!run) notFound();

  const failedResults = run.results.filter((result) => result.pass === false || result.status === "needs_review");
  const promptLabel = run.promptVersion ? `${run.promptVersion.prompt.name} · v${run.promptVersion.version}` : "—";

  return (
    <main>
      <Link className="back-link" href={`/evals/${run.datasetId}`}>
        返回数据集
      </Link>
      <header className="page-head">
        <div>
          <p className="eyebrow">评测运行详情</p>
          <h1>{run.dataset.name} · {compactId(run.id)}</h1>
          <p className="muted">{run.dataset.project.name} · {promptLabel}</p>
        </div>
        <span className={`badge ${run.status === "needs_review" ? "estimated" : "provider"}`}>{evalStatusLabel(run.status)}</span>
      </header>

      <section className="summary-grid">
        <div className="summary-cell">
          <small>通过率</small>
          <strong>{formatPercent(passRate(run.results))}</strong>
        </div>
        <div className="summary-cell">
          <small>平均得分</small>
          <strong>{scoreText(run.averageScore)}</strong>
        </div>
        <div className="summary-cell">
          <small>成本</small>
          <strong>{formatMoney(run.totalCost)}</strong>
        </div>
        <div className="summary-cell">
          <small>耗时</small>
          <strong>{formatMs(run.durationMs)}</strong>
        </div>
        <div className="summary-cell">
          <small>提示词版本</small>
          <strong>
            {run.promptVersion ? (
              <Link className="row-link" href={`/prompts/${run.promptVersion.prompt.id}?compare=${run.promptVersion.version}`}>
                v{run.promptVersion.version}
              </Link>
            ) : (
              "—"
            )}
          </strong>
        </div>
        <div className="summary-cell">
          <small>模型</small>
          <strong>{run.modelConfig ? run.modelConfig.modelName : "—"}</strong>
        </div>
        <div className="summary-cell">
          <small>创建时间</small>
          <strong>{formatDate(run.createdAt)}</strong>
        </div>
        <div className="summary-cell">
          <small>运行 ID</small>
          <strong>{compactId(run.id)}</strong>
        </div>
      </section>

      <div className="detail-grid">
        <section className="section">
          <div className="section-heading">
            <div>
              <h2>失败 / 待复核样本</h2>
              <p className="muted">先看会阻塞发布的样本，再扫全量结果。</p>
            </div>
            <span className="badge">{failedResults.length}</span>
          </div>
          {failedResults.length === 0 ? (
            <div className="empty-state">
              <h3>没有失败样本</h3>
              <p className="muted">这个 run 的自动断言已全部通过。</p>
            </div>
          ) : (
            <div className="eval-result-list">
              {failedResults.map((result) => (
                <article className="section-band" key={result.id}>
                  <div className="section-heading">
                    <div>
                      <h3>{result.evalCase.input}</h3>
                      <p className="muted">{result.evalCase.assertionType} · 得分 {scoreText(result.score)}</p>
                    </div>
                    {resultBadge(result)}
                  </div>
                  <p>{result.judgeReason ?? "—"}</p>
                  <div className="preview-grid single">
                    <div>
                      <h3>输出</h3>
                      <pre>{result.output ?? "—"}</pre>
                    </div>
                  </div>
                  {result.status === "needs_review" ? (
                    <div className="inline-actions">
                      <ActionForm action={reviewEvalResultAction}><input type="hidden" name="requestId" value={randomUUID()} />
                        <input type="hidden" name="resultId" value={result.id} />
                        <input type="hidden" name="evalRunId" value={run.id} />
                        <input type="hidden" name="pass" value="true" />
                        <button type="submit">标记通过</button>
                      </ActionForm>
                      <ActionForm action={reviewEvalResultAction}><input type="hidden" name="requestId" value={randomUUID()} />
                        <input type="hidden" name="resultId" value={result.id} />
                        <input type="hidden" name="evalRunId" value={run.id} />
                        <input type="hidden" name="pass" value="false" />
                        <button className="button secondary" type="submit">标记未通过</button>
                      </ActionForm>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}

          <section className="section-band prompt-block">
            <div className="section-heading">
              <div>
                <h2>全量结果</h2>
                <p className="muted">每行保留 output、score、judge_reason 和耗时成本。</p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>样本</th>
                    <th>状态</th>
                    <th>得分</th>
                    <th>成本</th>
                    <th>耗时</th>
                    <th>创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {run.results.map((result) => (
                    <tr key={result.id}>
                      <td>
                        <div className="meta-stack">
                          <strong>{result.evalCase.input.slice(0, 80)}</strong>
                          <details><summary>查看输出</summary><pre>{result.output ?? "暂无输出"}</pre></details>
                          <small className="muted">{result.judgeReason ?? "—"}</small>
                        </div>
                      </td>
                      <td>{resultBadge(result)}</td>
                      <td>{scoreText(result.score)}</td>
                      <td>{formatMoney(result.cost)}</td>
                      <td>{formatMs(result.durationMs)}</td>
                      <td>{formatFullDate(result.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <aside className="section">
          <section className="section-band">
            <h2>比较运行</h2>
            {siblingRuns.length === 0 ? (
              <p className="muted">同一数据集还没有其它运行。</p>
            ) : (
              <div className="metric-list">
                {siblingRuns.map((sibling) => (
                  <Link key={sibling.id} href={`/evals/compare?baseRun=${sibling.id}&compareRun=${run.id}`}>
                    对比 {sibling.promptVersion ? `${sibling.promptVersion.prompt.name} v${sibling.promptVersion.version}` : compactId(sibling.id)} → 当前
                  </Link>
                ))}
              </div>
            )}
          </section>
          <section className="section-band">
            <h2>运行上下文</h2>
            <div className="kv-grid">
              <div className="kv">
                <small>数据集</small>
                <strong><Link className="row-link" href={`/evals/${run.datasetId}`}>{run.dataset.name}</Link></strong>
              </div>
              <div className="kv">
                <small>供应商</small>
                <strong>{run.modelConfig?.provider.name ?? "—"}</strong>
              </div>
              <div className="kv">
                <small>提示词</small>
                <strong>{promptLabel}</strong>
              </div>
              <div className="kv">
                <small>结果</small>
                <strong>{run.results.length}</strong>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
