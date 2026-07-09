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

const ASSERTION_LABELS: Record<AssertionType, string> = {
  [AssertionType.exact_match]: "精确匹配",
  [AssertionType.contains]: "包含",
  [AssertionType.regex]: "正则",
  [AssertionType.json_schema]: "JSON 结构",
  [AssertionType.llm_judge]: "模型裁判",
  [AssertionType.manual_review]: "人工复核",
};

function assertionLabel(type: AssertionType) {
  return ASSERTION_LABELS[type];
}

function evalStatusLabel(status: string | null | undefined) {
  if (status === "completed") return "已完成";
  if (status === "running") return "运行中";
  if (status === "failed") return "失败";
  if (status === "needs_review") return "需复核";
  if (status === "pending") return "待处理";
  return status ?? "未知";
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
    readError = "无法读取评测数据集。请确认数据库连接可用。";
  }

  if (readError) {
    return (
      <main>
        <Link className="back-link" href="/evals">
          返回评测
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
          返回评测
        </Link>
        <section className="empty-state">
          <h1>没有找到这个评测数据集</h1>
          <p className="muted">数据集可能已删除，或 URL 中的 id 不属于当前数据库。</p>
        </section>
      </main>
    );
  }

  const promptVersions = prompts.flatMap((prompt) =>
    prompt.versions.map((version) => ({
      ...version,
      label: `${prompt.name} · v${version.version}${prompt.activeVersionId === version.id ? " · 现行" : ""}`,
    })),
  );

  return (
    <main>
      <Link className="back-link" href="/evals">
        返回评测
      </Link>
      <header className="page-head">
        <div>
          <p className="eyebrow">评测数据集</p>
          <h1>{dataset.name}</h1>
          <p className="muted">{dataset.project.name} · {dataset.description ?? "无描述"}</p>
        </div>
        <span className="badge">{formatNumber(dataset.cases.length)} 个样本</span>
      </header>

      <section className="summary-grid">
        <div className="summary-cell">
          <small>数据集 ID</small>
          <strong>{compactId(dataset.id)}</strong>
        </div>
        <div className="summary-cell">
          <small>样本</small>
          <strong>{formatNumber(dataset.cases.length)}</strong>
        </div>
        <div className="summary-cell">
          <small>运行</small>
          <strong>{formatNumber(dataset.runs.length)}</strong>
        </div>
        <div className="summary-cell">
          <small>创建时间</small>
          <strong>{formatDate(dataset.createdAt)}</strong>
        </div>
      </section>

      <div className="detail-grid">
        <section className="section">
          <div className="section-heading">
            <div>
              <h2>评测样本</h2>
              <p className="muted">样本定义输入、期望和断言方式；跑批后不会改写样本。</p>
            </div>
          </div>
          {dataset.cases.length === 0 ? (
            <div className="empty-state">
              <h3>还没有样本</h3>
              <p className="muted">先添加至少一个样本，再运行评测。</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>输入</th>
                    <th>断言</th>
                    <th>期望</th>
                    <th>标签</th>
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
            <h2>历史评测运行</h2>
            {dataset.runs.length === 0 ? (
              <p className="muted">还没有运行记录。</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>运行</th>
                      <th>提示词</th>
                      <th>模型</th>
                      <th>通过率</th>
                      <th>得分</th>
                      <th>成本</th>
                      <th>耗时</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dataset.runs.map((run) => (
                      <tr key={run.id}>
                        <td>
                          <Link className="row-link" href={`/evals/runs/${run.id}`}>
                            {evalStatusLabel(run.status)} · {compactId(run.id)}
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
            <h2>运行评测</h2>
            <form className="stack-form" action={runEvalDatasetAction}>
              <input type="hidden" name="datasetId" value={dataset.id} />
              <label>
                提示词版本
                <select name="promptVersionId" required defaultValue={promptVersions[0]?.id ?? ""}>
                  {promptVersions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                模型配置
                <select name="modelConfigId" required defaultValue={models[0]?.id ?? ""}>
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.provider.name} / {model.modelName}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={dataset.cases.length === 0 || promptVersions.length === 0 || models.length === 0}>
                运行评测
              </button>
            </form>
          </section>

          <section className="section-band">
            <h2>添加样本</h2>
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
                断言配置
                <textarea name="assertionConfig" rows={6} placeholder='{"contains":["hello"],"pass_keywords":["safe"]}' />
              </label>
              <label>
                标签
                <input name="tags" placeholder="安全, 结构化, 冒烟" />
              </label>
              <button type="submit">添加样本</button>
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
