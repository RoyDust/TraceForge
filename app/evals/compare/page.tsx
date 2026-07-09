import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { compactId, formatMoney, formatMs, formatPercent } from "@/lib/format";
import { passRate } from "@/lib/eval-runner";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type RunWithResults = Prisma.EvalRunGetPayload<{
  include: {
    dataset: true;
    promptVersion: { include: { prompt: true } };
    results: { include: { evalCase: true } };
  };
}>;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function score(value: { toString(): string } | null) {
  return value === null ? null : Number(value.toString());
}

function movementLabel(value: string) {
  if (value === "new") return "新增";
  if (value === "improved") return "改善";
  if (value === "regressed") return "回归";
  if (value === "unchanged") return "不变";
  return value;
}

function passLabel(pass: boolean | null, status: string) {
  if (pass === true) return "通过";
  if (status === "needs_review") return "需复核";
  if (status === "failed") return "失败";
  return status;
}

function promptLabel(run: RunWithResults) {
  return run.promptVersion ? `${run.promptVersion.prompt.name} v${run.promptVersion.version}` : compactId(run.id);
}

export default async function EvalComparePage({ searchParams }: { searchParams: SearchParams }) {
  const rawParams = await searchParams;
  const baseRunId = one(rawParams.baseRun)?.trim();
  const compareRunId = one(rawParams.compareRun)?.trim();
  let baseRun: RunWithResults | null = null;
  let compareRun: RunWithResults | null = null;
  let readError: string | null = null;

  try {
    if (baseRunId && compareRunId) {
      [baseRun, compareRun] = await Promise.all([
        prisma.evalRun.findUnique({
          where: { id: baseRunId },
          include: { dataset: true, promptVersion: { include: { prompt: true } }, results: { include: { evalCase: true } } },
        }),
        prisma.evalRun.findUnique({
          where: { id: compareRunId },
          include: { dataset: true, promptVersion: { include: { prompt: true } }, results: { include: { evalCase: true } } },
        }),
      ]);
    }
  } catch (error) {
    console.error(error);
    readError = "无法读取评测运行对比数据。请确认数据库连接可用。";
  }

  if (readError) {
    return (
      <main>
        <section className="error-state" role="alert">
          <h1>读取失败</h1>
          <p>{readError}</p>
        </section>
      </main>
    );
  }

  if (!baseRunId || !compareRunId || !baseRun || !compareRun) {
    return (
      <main>
        <header className="page-head">
          <div>
            <p className="eyebrow">评测对比</p>
            <h1>选择两个评测运行</h1>
            <p className="muted">从评测运行详情页进入对比，URL 需要 `baseRun` 和 `compareRun`。</p>
          </div>
        </header>
        <section className="empty-state">
          <h2>没有可比较的运行</h2>
          <p className="muted">运行 `node scripts/stage6-demo.mjs` 后打开脚本打印的对比 URL。</p>
        </section>
      </main>
    );
  }

  const sameDataset = baseRun.datasetId === compareRun.datasetId;
  const baseByCase = new Map(baseRun.results.map((result) => [result.evalCaseId, result]));
  const rows = compareRun.results.map((current) => {
    const previous = baseByCase.get(current.evalCaseId);
    const previousScore = previous ? score(previous.score) : null;
    const currentScore = score(current.score);
    const delta = previousScore === null || currentScore === null ? null : currentScore - previousScore;
    const movement =
      !previous ? "new" : previous.pass !== true && current.pass === true ? "improved" : previous.pass === true && current.pass !== true ? "regressed" : "unchanged";
    return { current, previous, delta, movement };
  });
  const regressions = rows.filter((row) => row.movement === "regressed");
  const improvements = rows.filter((row) => row.movement === "improved");
  const passDelta = (passRate(compareRun.results) ?? 0) - (passRate(baseRun.results) ?? 0);
  const scoreDelta = Number(compareRun.averageScore?.toString() ?? 0) - Number(baseRun.averageScore?.toString() ?? 0);

  return (
    <main>
      <Link className="back-link" href={`/evals/runs/${compareRun.id}`}>
        返回对比运行
      </Link>
      <header className="page-head">
        <div>
          <p className="eyebrow">评测对比</p>
          <h1>{promptLabel(baseRun)} → {promptLabel(compareRun)}</h1>
          <p className="muted">{baseRun.dataset.name} · 逐样本回归报告</p>
        </div>
        {sameDataset ? <span className="badge provider">同一数据集</span> : <span className="badge failed">数据集不一致</span>}
      </header>

      {!sameDataset ? (
        <section className="error-state" role="alert">
          <h2>数据集不一致</h2>
          <p>只能比较同一个评测数据集下的两个评测运行。</p>
        </section>
      ) : (
        <>
          <section className="summary-grid">
            <div className="summary-cell">
              <small>通过率变化</small>
              <strong>{passDelta >= 0 ? "+" : ""}{formatPercent(passDelta)}</strong>
            </div>
            <div className="summary-cell">
              <small>得分变化</small>
              <strong>{scoreDelta >= 0 ? "+" : ""}{scoreDelta.toFixed(3)}</strong>
            </div>
            <div className="summary-cell">
              <small>回归</small>
              <strong>{regressions.length}</strong>
            </div>
            <div className="summary-cell">
              <small>改善</small>
              <strong>{improvements.length}</strong>
            </div>
            <div className="summary-cell">
              <small>基线成本</small>
              <strong>{formatMoney(baseRun.totalCost)}</strong>
            </div>
            <div className="summary-cell">
              <small>对比成本</small>
              <strong>{formatMoney(compareRun.totalCost)}</strong>
            </div>
            <div className="summary-cell">
              <small>基线耗时</small>
              <strong>{formatMs(baseRun.durationMs)}</strong>
            </div>
            <div className="summary-cell">
              <small>对比耗时</small>
              <strong>{formatMs(compareRun.durationMs)}</strong>
            </div>
          </section>

          <section className="section">
            <div className="section-heading">
              <div>
                <h2>样本变化</h2>
                <p className="muted">按评测样本身份对齐，突出从通过到失败的回归。</p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>样本</th>
                    <th>变化</th>
                    <th>基线</th>
                    <th>对比</th>
                    <th>得分变化</th>
                    <th>原因</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ current, previous, delta, movement }) => (
                    <tr key={current.evalCaseId}>
                      <td>{current.evalCase.input.slice(0, 80)}</td>
                      <td><span className={`badge ${movement === "improved" ? "provider" : movement === "regressed" ? "failed" : ""}`}>{movementLabel(movement)}</span></td>
                      <td>{previous ? passLabel(previous.pass, previous.status) : "—"}</td>
                      <td>{passLabel(current.pass, current.status)}</td>
                      <td>{delta === null ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(3)}`}</td>
                      <td>{current.judgeReason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
