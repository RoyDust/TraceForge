import Link from "next/link";
import { AssertionType, type Prisma } from "@prisma/client";
import { compactId, formatDate, formatMoney, formatMs, formatNumber, formatPercent } from "@/lib/format";
import { passRate } from "@/lib/eval-runner";
import { prisma } from "@/lib/prisma";
import { createEvalCaseAction, runEvalDatasetAction } from "../actions";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type DatasetDetail = Prisma.EvalDatasetGetPayload<{
  include: {
    project: true;
    cases: true;
    runs: {
      include: {
        results: { select: { pass: true } };
        promptVersion: { include: { prompt: true } };
        modelConfig: { include: { provider: true } };
      };
    };
  };
}>;
type PromptRow = Prisma.PromptGetPayload<{
  include: {
    versions: true;
  };
}>;
type ModelRow = Prisma.ModelConfigGetPayload<{ include: { provider: true } }>;

function jsonText(value: Prisma.JsonValue | null | undefined) {
  if (value === null || value === undefined) return "";
  return JSON.stringify(value, null, 2);
}

function assertionLabel(type: AssertionType) {
  return type.replace("_", " ");
}

export default async function EvalDatasetPage({ params }: { params: Params }) {
  const { id } = await params;
  let dataset: DatasetDetail | null = null;
  let prompts: PromptRow[] = [];
  let models: ModelRow[] = [];
  let readError: string | null = null;

  try {
    dataset = await prisma.evalDataset.findUnique({
      where: { id },
      include: {
        project: true,
        cases: { orderBy: { createdAt: "asc" } },
        runs: {
          include: {
            results: { select: { pass: true } },
            promptVersion: { include: { prompt: true } },
            modelConfig: { include: { provider: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (dataset) {
      [prompts, models] = await Promise.all([
        prisma.prompt.findMany({
          where: { projectId: dataset.projectId },
          include: { versions: { orderBy: { version: "desc" } } },
          orderBy: { createdAt: "desc" },
        }),
        prisma.modelConfig.findMany({
          where: { status: "active" },
          include: { provider: true },
          orderBy: { createdAt: "desc" },
        }),
      ]);
    }
  } catch (error) {
    console.error(error);
    readError = "无法读取 EvalDataset。请确认数据库连接可用。";
  }

  if (readError) {
    return (
      <main>
        <Link className="back-link" href="/evals">
          返回 Evals
        </Link>
        <section className="error-state" role="alert">
          <h1>读取失败</h1>
          <p>{readError}</p>
        </section>
      </main>
    );
  }

  if (!dataset) {
    return (
      <main>
        <Link className="back-link" href="/evals">
          返回 Evals
        </Link>
        <section className="empty-state">
          <h1>没有找到这个 EvalDataset</h1>
          <p className="muted">Dataset 可能已删除，或 URL 中的 id 不属于当前数据库。</p>
        </section>
      </main>
    );
  }

  const promptVersions = prompts.flatMap((prompt) =>
    prompt.versions.map((version) => ({
      ...version,
      label: `${prompt.name} · v${version.version}${prompt.activeVersionId === version.id ? " · active" : ""}`,
    })),
  );

  return (
    <main>
      <Link className="back-link" href="/evals">
        返回 Evals
      </Link>
      <header className="page-head">
        <div>
          <p className="eyebrow">Eval Dataset</p>
          <h1>{dataset.name}</h1>
          <p className="muted">{dataset.project.name} · {dataset.description ?? "无描述"}</p>
        </div>
        <span className="badge">{formatNumber(dataset.cases.length)} cases</span>
      </header>

      <section className="summary-grid">
        <div className="summary-cell">
          <small>Dataset ID</small>
          <strong>{compactId(dataset.id)}</strong>
        </div>
        <div className="summary-cell">
          <small>Cases</small>
          <strong>{formatNumber(dataset.cases.length)}</strong>
        </div>
        <div className="summary-cell">
          <small>Runs</small>
          <strong>{formatNumber(dataset.runs.length)}</strong>
        </div>
        <div className="summary-cell">
          <small>Created</small>
          <strong>{formatDate(dataset.createdAt)}</strong>
        </div>
      </section>

      <div className="detail-grid">
        <section className="section">
          <div className="section-heading">
            <div>
              <h2>EvalCase</h2>
              <p className="muted">Case 定义输入、期望和断言方式；跑批后不会改写 Case。</p>
            </div>
          </div>
          {dataset.cases.length === 0 ? (
            <div className="empty-state">
              <h3>还没有 Case</h3>
              <p className="muted">先添加至少一个 Case，再运行 EvalRun。</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Input</th>
                    <th>Assertion</th>
                    <th>Expected</th>
                    <th>Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {dataset.cases.map((evalCase) => (
                    <tr key={evalCase.id}>
                      <td>
                        <div className="meta-stack">
                          <strong>{evalCase.input.slice(0, 80)}</strong>
                          <small className="muted">{compactId(evalCase.id)}</small>
                        </div>
                      </td>
                      <td><span className="badge">{assertionLabel(evalCase.assertionType)}</span></td>
                      <td>{evalCase.expectedOutput ?? "—"}</td>
                      <td>{evalCase.tags.length ? evalCase.tags.join(", ") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <section className="section-band prompt-block">
            <h2>历史 EvalRun</h2>
            {dataset.runs.length === 0 ? (
              <p className="muted">还没有运行记录。</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>Prompt</th>
                      <th>Model</th>
                      <th>Pass Rate</th>
                      <th>Score</th>
                      <th>Cost</th>
                      <th>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dataset.runs.map((run) => (
                      <tr key={run.id}>
                        <td>
                          <Link className="row-link" href={`/evals/runs/${run.id}`}>
                            {run.status} · {compactId(run.id)}
                          </Link>
                        </td>
                        <td>{run.promptVersion ? `${run.promptVersion.prompt.name} v${run.promptVersion.version}` : "—"}</td>
                        <td>{run.modelConfig ? `${run.modelConfig.provider.name} / ${run.modelConfig.modelName}` : "—"}</td>
                        <td>{formatPercent(passRate(run.results))}</td>
                        <td>{run.averageScore?.toString() ?? "—"}</td>
                        <td>{formatMoney(run.totalCost)}</td>
                        <td>{formatMs(run.durationMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </section>

        <aside className="section">
          <section className="section-band">
            <h2>运行 Eval</h2>
            <form className="stack-form" action={runEvalDatasetAction}>
              <input type="hidden" name="datasetId" value={dataset.id} />
              <label>
                PromptVersion
                <select name="promptVersionId" required defaultValue={promptVersions[0]?.id ?? ""}>
                  {promptVersions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                ModelConfig
                <select name="modelConfigId" required defaultValue={models[0]?.id ?? ""}>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.provider.name} / {model.modelName}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={dataset.cases.length === 0 || promptVersions.length === 0 || models.length === 0}>
                运行 EvalRun
              </button>
            </form>
          </section>

          <section className="section-band">
            <h2>添加 Case</h2>
            <form className="stack-form" action={createEvalCaseAction}>
              <input type="hidden" name="datasetId" value={dataset.id} />
              <label>
                输入
                <textarea name="input" required rows={4} placeholder="用户问题或任务输入" />
              </label>
              <label>
                期望输出
                <textarea name="expectedOutput" rows={3} placeholder="精确答案、必含片段或判分参考" />
              </label>
              <label>
                断言类型
                <select name="assertionType" required defaultValue={AssertionType.contains}>
                  {Object.values(AssertionType).map((type) => (
                    <option key={type} value={type}>
                      {assertionLabel(type)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                断言配置 JSON
                <textarea name="assertionConfig" rows={6} placeholder='{"contains":["hello"],"pass_keywords":["safe"]}' />
              </label>
              <label>
                Tags
                <input name="tags" placeholder="safety, json, smoke" />
              </label>
              <button type="submit">添加 Case</button>
            </form>
          </section>

          {dataset.cases.some((evalCase) => evalCase.assertionConfig) ? (
            <section className="section-band">
              <h2>最近配置</h2>
              <pre>{jsonText(dataset.cases.find((evalCase) => evalCase.assertionConfig)?.assertionConfig)}</pre>
            </section>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
