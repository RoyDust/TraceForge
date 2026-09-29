import { expireEvalRuns } from "@/lib/eval-runner";
import { randomUUID } from "node:crypto";
import { ActionForm } from "@/components/traceforge/action-form";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/validation";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  ExternalLink,
  Play,
  RotateCcw,
  Rocket,
  Star,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { runEvalDatasetAction } from "@/app/(console)/evals/actions";
import { compactId, formatDate, formatMoney, formatMs, formatNumber, formatPercent } from "@/lib/format";
import { passRate } from "@/lib/eval-runner";
import { diffLines, diffSummary } from "@/lib/prompt-diff";
import { getConsoleDb } from "@/lib/dal";
import { createPromptVersionAction, setActivePromptVersionAction } from "../actions";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type PromptDetail = Prisma.PromptGetPayload<{
  include: {
    project: true;
    activeVersion: true;
    versions: {
      include: {
        _count: {
          select: { traceRuns: true; evalRuns: true };
        };
      };
    };
  };
}>;
type PromptEvalRun = Prisma.EvalRunGetPayload<{
  include: {
    dataset: true;
    promptVersion: true;
    modelConfig: { include: { provider: true } };
    results: { include: { evalCase: true } };
  };
}>;
type EvalDatasetRow = Prisma.EvalDatasetGetPayload<{
  include: {
    _count: { select: { cases: true; runs: true } };
  };
}>;
type ModelRow = Prisma.ModelConfigGetPayload<{ include: { provider: true } }>;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function pickVersion(prompt: PromptDetail, value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return prompt.versions.find((version) => version.version === parsed) ?? prompt.versions.find((version) => version.version === fallback) ?? prompt.versions[0];
}

function pairedDiffRows(base: string, candidate: string) {
  const baseLines = base.split(/\r?\n/);
  const candidateLines = candidate.split(/\r?\n/);
  const max = Math.max(baseLines.length, candidateLines.length);
  return Array.from({ length: max }, (_, index) => {
    const left = baseLines[index];
    const right = candidateLines[index];
    const type = left === right ? "same" : left === undefined ? "added" : right === undefined ? "removed" : "changed";
    return {
      line: index + 1,
      type,
      base: left ?? "",
      candidate: right ?? "",
    };
  });
}

function score(value: { toString(): string } | null | undefined) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value.toString());
  return Number.isFinite(numeric) ? numeric : null;
}

function latestForVersion(evalRuns: PromptEvalRun[], versionId: string | undefined) {
  return evalRuns.find((run) => run.promptVersionId === versionId) ?? null;
}

function movement(latest: PromptEvalRun | null, previous: PromptEvalRun | null) {
  if (!latest) return { regressions: 0, improvements: 0 };
  if (!previous) return { regressions: 0, improvements: 0 };

  const previousByCase = new Map(previous.results.map((result) => [result.evalCaseId, result]));
  let regressions = 0;
  let improvements = 0;
  for (const result of latest.results) {
    const old = previousByCase.get(result.evalCaseId);
    if (!old) continue;
    if (old.pass === true && result.pass !== true) regressions += 1;
    if (old.pass !== true && result.pass === true) improvements += 1;
  }
  return { regressions, improvements };
}

function dimensionRate(results: PromptEvalRun["results"], tag: string) {
  const tagged = results.filter((r) => r.evalCase.tags.includes(tag));
  return tagged.length ? Math.round((passRate(tagged) ?? 0) * 100) : null;
}

function matrixRows(run: PromptEvalRun | null) {
  if (!run || run.results.length === 0) return [];

  const groups = new Map<string, PromptEvalRun["results"]>();
  for (const result of run.results) {
    const label = result.evalCase.tags[0] ?? result.evalCase.assertionType;
    groups.set(label, [...(groups.get(label) ?? []), result]);
  }

  return [...groups.entries()].slice(0, 5).map(([label, results]) => {
    const pass = passRate(results) ?? 0;
    const base = Math.round(pass * 100);
    return {
      label,
      policy: dimensionRate(results, "policy"),
      action: dimensionRate(results, "action"),
      tone: dimensionRate(results, "tone"),
      logic: dimensionRate(results, "logic"),
      overall: base,
    };
  });
}

function heatClass(value: number | null) {
  if (value === null) return "";
  if (value >= 90) return "excellent";
  if (value >= 80) return "good";
  if (value >= 70) return "warn";
  return "fail";
}

function evalStatusLabel(status: string | null | undefined) {
  if (status === "completed") return "已完成";
  if (status === "running") return "运行中";
  if (status === "failed") return "失败";
  if (status === "needs_review") return "需复核";
  if (status === "pending") return "待处理";
  return status ?? "未知";
}

function resultStateLabel(status: string | null | undefined) {
  if (status === "needs_review") return "复核";
  if (status === "failed") return "失败";
  if (status === "passed") return "通过";
  return "失败";
}

function promptVersionLabel(version: PromptDetail["versions"][number] | undefined, suffix: string) {
  if (!version) return suffix;
  return `v${version.version} ${suffix}`;
}

export default async function PromptDetailPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const prisma = await getConsoleDb();
  await expireEvalRuns(prisma);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const rawParams = await searchParams;
  let prompt: PromptDetail | null = null;
  let evalRuns: PromptEvalRun[] = [];
  let datasets: EvalDatasetRow[] = [];
  let models: ModelRow[] = [];

  prompt = await prisma.prompt.findUnique({
    where: { id },
    include: {
      project: true,
      activeVersion: true,
      versions: {
        include: {
          _count: { select: { traceRuns: true, evalRuns: true } },
        },
        orderBy: { version: "desc" },
      },
    },
  });
  if (prompt) {
    [evalRuns, datasets, models] = await Promise.all([
      prisma.evalRun.findMany({
        where: { promptVersion: { promptId: prompt.id } },
        include: {
          dataset: true,
          promptVersion: true,
          modelConfig: { include: { provider: true } },
          results: { include: { evalCase: true }, orderBy: { createdAt: "asc" } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.evalDataset.findMany({
        where: { projectId: prompt.projectId },
        include: { _count: { select: { cases: true, runs: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.modelConfig.findMany({
        where: { status: "active" },
        include: { provider: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);
  }


  if (!prompt) notFound();

  const highest = prompt.versions[0]?.version ?? 1;
  const baseline = pickVersion(prompt, one(rawParams.base), prompt.activeVersion?.version ?? highest);
  const candidate = pickVersion(prompt, one(rawParams.compare), highest);
  const selectedDatasetId = one(rawParams.dataset)?.trim() || datasets[0]?.id;
  const selectedDataset = datasets.find((dataset) => dataset.id === selectedDatasetId) ?? datasets[0];
  const selectedModel = models[0];
  const diff = baseline && candidate ? diffLines(baseline.content, candidate.content) : [];
  const diffStats = diffSummary(diff);
  const diffRows = baseline && candidate ? pairedDiffRows(baseline.content, candidate.content) : [];
  const scopedRuns = evalRuns.filter((run) => run.datasetId === selectedDataset?.id);
  const latestRun = latestForVersion(scopedRuns, candidate?.id);
  const previousRun = scopedRuns.find((run) => run.id !== latestRun?.id && run.promptVersionId === baseline?.id) ?? null;
  const pass = latestRun ? passRate(latestRun.results) : null;
  const moves = movement(latestRun, previousRun);
  const failedResults = latestRun?.results.filter((result) => result.pass === false || result.status === "needs_review") ?? [];
  const manualReviewCount = latestRun?.results.filter((result) => result.status === "needs_review").length ?? 0;
  const linkedTraceCount = prompt.versions.reduce((sum, version) => sum + version._count.traceRuns, 0);
  const matrices = matrixRows(latestRun);

  return (
    <main className="tf-regression">
      <header className="tf-regression-title">
        <div>
          <p className="eyebrow">回归工作台</p>
          <h1>{prompt.name}</h1>
          <p>{prompt.project.name} · {prompt.description ?? "提示词发布工作区"}</p>
        </div>
        <div className="tf-regression-title-actions">
          <Button size="icon-sm" variant="ghost" aria-label="复制提示词编号">
            <Copy aria-hidden="true" />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="收藏提示词">
            <Star aria-hidden="true" />
          </Button>
        </div>
      </header>

      <section className="tf-regression-controls">
        <form method="get" className="tf-regression-selectors">
          <label>
            <span>基线版本</span>
            <NativeSelect name="base" defaultValue={String(baseline?.version ?? "")}>
              {prompt.versions.map((version) => (
                <NativeSelectOption key={version.id} value={version.version}>
                  v{version.version}{prompt.activeVersionId === version.id ? " · 现行" : ""}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <ArrowRight aria-hidden="true" className="tf-regression-arrow" />
          <label>
            <span>候选版本</span>
            <NativeSelect name="compare" defaultValue={String(candidate?.version ?? "")}>
              {prompt.versions.map((version) => (
                <NativeSelectOption key={version.id} value={version.version}>
                  v{version.version}{version.status === "draft" ? " · 草稿" : ""}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label>
            <span>数据集</span>
            <NativeSelect name="dataset" defaultValue={selectedDataset?.id ?? ""}>
              {datasets.length === 0 ? <NativeSelectOption value="">暂无数据集</NativeSelectOption> : null}
              {datasets.map((dataset) => (
                <NativeSelectOption key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <Button type="submit" size="sm" variant="outline">应用</Button>
        </form>

        <div className="tf-release-actions">
          <ActionForm action={runEvalDatasetAction}><input type="hidden" name="requestId" value={randomUUID()} />
            <input type="hidden" name="datasetId" value={selectedDataset?.id ?? ""} />
            <input type="hidden" name="promptVersionId" value={candidate?.id ?? ""} />
            <input type="hidden" name="modelConfigId" value={selectedModel?.id ?? ""} />
            <Button type="submit" size="sm" disabled={!selectedDataset || !candidate || !selectedModel}>
              <Play aria-hidden="true" />
              运行评测
            </Button>
          </ActionForm>
          {candidate && prompt.activeVersionId !== candidate.id ? (
            <ActionForm action={setActivePromptVersionAction}><input type="hidden" name="requestId" value={randomUUID()} />
              <input type="hidden" name="promptId" value={prompt.id} />
              <input type="hidden" name="versionId" value={candidate.id} />
              <Button type="submit" size="sm" variant="outline">
                <Rocket aria-hidden="true" />
                发布 {promptVersionLabel(candidate, "")}
              </Button>
            </ActionForm>
          ) : null}
          {baseline && prompt.activeVersionId !== baseline.id ? (
            <ActionForm action={setActivePromptVersionAction}><input type="hidden" name="requestId" value={randomUUID()} />
              <input type="hidden" name="promptId" value={prompt.id} />
              <input type="hidden" name="versionId" value={baseline.id} />
              <Button type="submit" size="sm" variant="outline">
                <RotateCcw aria-hidden="true" />
                回滚
              </Button>
            </ActionForm>
          ) : null}
        </div>
      </section>

      <div className="tf-regression-grid">
        <section className="tf-regression-main">
          <Card className="tf-panel">
            <CardHeader className="tf-panel-head">
              <div>
                <CardTitle>提示词差异</CardTitle>
                <CardDescription>
                  {promptVersionLabel(baseline, "基线")} → {promptVersionLabel(candidate, "候选")}
                </CardDescription>
              </div>
              <CardAction className="tf-panel-actions">
                <Badge variant="outline">-{diffStats.removed} 行</Badge>
                <Badge variant="secondary">+{diffStats.added} 行</Badge>
              </CardAction>
            </CardHeader>
            <CardContent data-source="derived">
              {prompt.versions.length < 2 ? (
                <div className="tf-empty-panel">
                  <span>单版本提示词</span>
                  <p>创建候选版本后即可启用双栏差异与发布复核。</p>
                </div>
              ) : (
                <div className="tf-diff-grid">
                  <div className="tf-diff-column">
                    <div className="tf-diff-head">
                      <Badge variant="outline">{promptVersionLabel(baseline, "基线")}</Badge>
                      <span>{baseline?._count.traceRuns ?? 0} 条关联追踪</span>
                    </div>
                    <div className="tf-diff-code">
                      {diffRows.map((row) => (
                        <div key={`base-${row.line}`} className={`tf-diff-row ${row.type === "removed" || row.type === "changed" ? "removed" : ""}`}>
                          <span>{row.line}</span>
                          <code>{row.base || " "}</code>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="tf-diff-column">
                    <div className="tf-diff-head">
                      <Badge variant="secondary">{promptVersionLabel(candidate, "候选")}</Badge>
                      <span>{candidate?._count.evalRuns ?? 0} 次评测</span>
                    </div>
                    <div className="tf-diff-code">
                      {diffRows.map((row) => (
                        <div key={`candidate-${row.line}`} className={`tf-diff-row ${row.type === "added" || row.type === "changed" ? "added" : ""}`}>
                          <span>{row.line}</span>
                          <code>{row.candidate || " "}</code>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="tf-regression-lower">
            <Card className="tf-panel">
              <CardHeader className="tf-panel-head">
                <div>
                  <CardTitle>评测数据集</CardTitle>
                  <CardDescription>按数据集检查候选版本安全性</CardDescription>
                </div>
                {selectedDataset ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/evals/${selectedDataset.id}`}>打开数据集</Link>
                  </Button>
                ) : null}
              </CardHeader>
              <CardContent>
                <div className="tf-table-shell compact">
                  <Table className="tf-dense-table tf-regression-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>数据集</TableHead>
                        <TableHead>样本</TableHead>
                        <TableHead>运行</TableHead>
                        <TableHead>最新通过率</TableHead>
                        <TableHead>Δ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {datasets.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5}>暂无数据集，请在评测工作区创建。</TableCell>
                        </TableRow>
                      ) : (
                        datasets.map((dataset) => (
                          <TableRow key={dataset.id}>
                            <TableCell>
                              <Link className="tf-run-link" href={`/evals/${dataset.id}`}>{dataset.name}</Link>
                            </TableCell>
                            <TableCell>{formatNumber(dataset._count.cases)}</TableCell>
                            <TableCell>{formatNumber(dataset._count.runs)}</TableCell>
                            <TableCell>{pass === null ? "—" : formatPercent(pass)}</TableCell>
                            <TableCell className={moves.regressions > 0 ? "tf-danger-text" : "tf-ok-text"}>
                              {moves.regressions > 0 ? `↓ ${moves.regressions}` : `↑ ${moves.improvements}`}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card className="tf-panel">
              <CardHeader className="tf-panel-head">
                <div>
                  <CardTitle>断言矩阵</CardTitle>
                  <CardDescription>按标签或断言类型分组</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <div className="tf-assertion-matrix">
                  <div className="tf-assertion-head">
                    <span>数据集</span>
                    <span>规则</span>
                    <span>动作</span>
                    <span>语气</span>
                    <span>逻辑</span>
                    <span>整体</span>
                  </div>
                  {matrices.map((row) => (
                    <div className="tf-assertion-row" key={row.label}>
                      <strong>{row.label}</strong>
                      {[row.policy, row.action, row.tone, row.logic, row.overall].map((value, index) => (
                        <span key={`${row.label}-${index}`} className={heatClass(value)}>
                          {value}%
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="tf-panel">
              <CardHeader className="tf-panel-head">
                <div>
                  <CardTitle>评测对比</CardTitle>
                  <CardDescription>通过率、延迟、成本和失败域变化</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="tf-compare-stack">
                {latestRun && previousRun ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/evals/compare?baseRun=${previousRun.id}&compareRun=${latestRun.id}`}>
                      打开对比
                      <ExternalLink aria-hidden="true" />
                    </Link>
                  </Button>
                ) : null}
                <div>
                  <span>通过率</span>
                  <strong>{previousRun ? formatPercent(passRate(previousRun.results)) : "—"} → {pass === null ? "—" : formatPercent(pass)}</strong>
                </div>
                <div>
                  <span>P50 延迟</span>
                  <strong>{formatMs(previousRun?.durationMs)} → {formatMs(latestRun?.durationMs)}</strong>
                </div>
                <div>
                  <span>每千轮成本</span>
                  <strong>${formatMoney(previousRun?.totalCost)} → ${formatMoney(latestRun?.totalCost)}</strong>
                </div>
                <div>
                  <span>失败域</span>
                  <strong>回归 {moves.regressions} · 改善 {moves.improvements}</strong>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="tf-panel">
            <CardHeader className="tf-panel-head">
              <div>
                <CardTitle>近期评测运行</CardTitle>
                <CardDescription>历史记录可继续用于人工复核和对比</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="tf-table-shell compact">
                <Table className="tf-dense-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>运行 ID</TableHead>
                      <TableHead>数据集</TableHead>
                      <TableHead>版本</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>通过率</TableHead>
                      <TableHead>成本</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {evalRuns.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7}>暂无评测运行。</TableCell>
                      </TableRow>
                    ) : (
                      evalRuns.map((run) => (
                        <TableRow key={run.id}>
                          <TableCell>{compactId(run.id)}</TableCell>
                          <TableCell>{run.dataset.name}</TableCell>
                          <TableCell>v{run.promptVersion?.version ?? "—"}</TableCell>
                          <TableCell><Badge variant="outline" className={run.status === "completed" ? "tf-status success" : "tf-status running"}>{evalStatusLabel(run.status)}</Badge></TableCell>
                          <TableCell>{formatPercent(passRate(run.results))}</TableCell>
                          <TableCell>${formatMoney(run.totalCost)}</TableCell>
                          <TableCell>
                            <Button asChild size="xs" variant="outline">
                              <Link href={`/evals/runs/${run.id}`}>打开</Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </section>

        <aside className="tf-regression-rail" data-source="database">
          <Card className="tf-panel">
            <CardHeader className="tf-panel-head">
              <div>
                <CardTitle>评测摘要</CardTitle>
                <CardDescription>{selectedDataset?.name ?? "未选择数据集"}</CardDescription>
              </div>
              {latestRun ? <Badge variant="outline" className="tf-status success">{evalStatusLabel(latestRun.status)}</Badge> : <Badge variant="outline">暂无评测</Badge>}
            </CardHeader>
            <CardContent className="tf-evidence-stack">
              <section className="tf-eval-summary-grid">
                <div>
                  <small>通过率</small>
                  <strong>{pass === null ? "—" : formatPercent(pass)}</strong>
                  <span className={moves.regressions > 0 ? "danger" : "ok"}>{moves.regressions > 0 ? "↓" : "↑"} {moves.regressions || moves.improvements} 对比基线</span>
                </div>
                <div>
                  <small>回归</small>
                  <strong>{formatNumber(moves.regressions)}</strong>
                </div>
                <div>
                  <small>改善</small>
                  <strong>{formatNumber(moves.improvements)}</strong>
                </div>
                <div>
                  <small>总样本</small>
                  <strong>{formatNumber(latestRun?.results.length ?? selectedDataset?._count.cases ?? 0)}</strong>
                </div>
              </section>

              <section data-source="database">
                <div className="tf-section-line">
                  <h3>人工复核</h3>
                  <Badge variant="secondary">{formatNumber(manualReviewCount)} 待处理</Badge>
                </div>
                <div className="tf-failed-case-list">
                  {(failedResults.length > 0 ? failedResults.slice(0, 3) : []).map((result) => (
                    <div key={result.id}>
                      <strong>{result.evalCase.tags[0] ?? result.evalCase.assertionType}</strong>
                      <span>{result.evalCase.input.slice(0, 44)}</span>
                      <em>{resultStateLabel(result.status)}</em>
                    </div>
                  ))}
                  {failedResults.length === 0 ? <p>最近一次运行没有失败样本。</p> : null}
                </div>
                {latestRun ? (
                  <Link className="tf-rail-link" href={`/evals/runs/${latestRun.id}`}>打开人工复核</Link>
                ) : null}
              </section>

              <section data-source="database">
                <div className="tf-section-line">
                  <h3>失败样本</h3>
                  <Badge variant="destructive">{formatNumber(failedResults.length || moves.regressions)}</Badge>
                </div>
                <div className="tf-failed-case-list">
                  {failedResults.slice(0, 3).map((item) => <div key={item.id}><strong>{item.evalCase.tags[0] ?? item.assertionType}</strong><span>{item.evalCase.input.slice(0,44)}</span><Link href={"/evals/runs/" + item.evalRunId}>打开评测结果</Link></div>)}
                  {failedResults.length === 0 ? <p>暂无失败样本。</p> : null}
                </div>
              </section>

              <section>
                <div className="tf-section-line">
                  <h3>追踪证据</h3>
                  <Badge variant="secondary">{formatNumber(linkedTraceCount)} 已关联</Badge>
                </div>
                <p className="tf-rail-copy">存在关联时会指向可用追踪运行；否则该数量来自确定性暂无评测，用于发布复核。</p>
                <Link className="tf-rail-link" href={`/traces?promptId=${encodeURIComponent(prompt.id)}`}>打开追踪证据</Link>
              </section>

              <section className="tf-release-checklist">
                <h3>发布检查清单</h3>
                <div><CheckCircle2 aria-hidden="true" /><span>评测已完成</span><strong>{latestRun ? "完成" : "模拟"}</strong></div>
                <div><CheckCircle2 aria-hidden="true" /><span>无关键失败样本</span><strong>{failedResults.length === 0 ? "正常" : failedResults.length}</strong></div>
                <div><CheckCircle2 aria-hidden="true" /><span>人工复核已解决</span><strong>{manualReviewCount === 0 ? "正常" : `${manualReviewCount} 待处理`}</strong></div>
                <div><CheckCircle2 aria-hidden="true" /><span>关联追踪已检查</span><strong>{formatNumber(linkedTraceCount)}</strong></div>
              </section>

              <section className="tf-create-version">
                <h3>创建候选版本</h3>
                <ActionForm className="stack-form" action={createPromptVersionAction}><input type="hidden" name="requestId" value={randomUUID()} />
                  <input type="hidden" name="promptId" value={prompt.id} />
                  <textarea name="content" required rows={8} defaultValue={candidate?.content ?? prompt.activeVersion?.content ?? ""} />
                  <label className="checkbox-row">
                    <input name="publish" type="checkbox" />
                    立即发布
                  </label>
                  <Button type="submit" size="sm">保存新版本</Button>
                </ActionForm>
              </section>
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}
