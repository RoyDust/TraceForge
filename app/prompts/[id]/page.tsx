import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { compactId, formatDate, formatFullDate, formatNumber, formatPercent } from "@/lib/format";
import { passRate } from "@/lib/eval-runner";
import { diffLines, diffSummary } from "@/lib/prompt-diff";
import { prisma } from "@/lib/prisma";
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
    results: { select: { pass: true } };
  };
}>;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function pickVersion(prompt: PromptDetail, value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return prompt.versions.find((version) => version.version === parsed) ?? prompt.versions.find((version) => version.version === fallback) ?? prompt.versions[0];
}

export default async function PromptDetailPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params;
  const rawParams = await searchParams;
  let prompt: PromptDetail | null = null;
  let evalRuns: PromptEvalRun[] = [];
  let readError: string | null = null;

  try {
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
      evalRuns = await prisma.evalRun.findMany({
        where: { promptVersion: { promptId: prompt.id } },
        include: {
          dataset: true,
          promptVersion: true,
          results: { select: { pass: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 8,
      });
    }
  } catch (error) {
    console.error(error);
    readError = "无法读取 Prompt 详情。请确认数据库连接可用。";
  }

  if (readError) {
    return (
      <main>
        <Link className="back-link" href="/prompts">
          返回 Prompts
        </Link>
        <section className="error-state" role="alert">
          <h1>读取失败</h1>
          <p>{readError}</p>
        </section>
      </main>
    );
  }

  if (!prompt) {
    return (
      <main>
        <Link className="back-link" href="/prompts">
          返回 Prompts
        </Link>
        <section className="empty-state">
          <h1>没有找到这个 Prompt</h1>
          <p className="muted">Prompt 可能已删除，或 URL 中的 id 不属于当前数据库。</p>
        </section>
      </main>
    );
  }

  const highest = prompt.versions[0]?.version ?? 1;
  const baseVersion = pickVersion(prompt, one(rawParams.base), prompt.activeVersion?.version ?? highest);
  const compareVersion = pickVersion(prompt, one(rawParams.compare), highest);
  const diff = baseVersion && compareVersion ? diffLines(baseVersion.content, compareVersion.content) : [];
  const summary = diffSummary(diff);

  return (
    <main>
      <Link className="back-link" href="/prompts">
        返回 Prompts
      </Link>
      <header className="page-head">
        <div>
          <p className="eyebrow">Prompt Detail</p>
          <h1>{prompt.name}</h1>
          <p className="muted">{prompt.project.name} · {prompt.description ?? "无描述"}</p>
        </div>
        {prompt.activeVersion ? <span className="badge provider">active v{prompt.activeVersion.version}</span> : <span className="badge">no active</span>}
      </header>

      <section className="summary-grid">
        <div className="summary-cell">
          <small>Prompt ID</small>
          <strong>{compactId(prompt.id)}</strong>
        </div>
        <div className="summary-cell">
          <small>Versions</small>
          <strong>{formatNumber(prompt.versions.length)}</strong>
        </div>
        <div className="summary-cell">
          <small>Active Status</small>
          <strong>{prompt.activeVersion?.status ?? "—"}</strong>
        </div>
        <div className="summary-cell">
          <small>Created</small>
          <strong>{formatDate(prompt.createdAt)}</strong>
        </div>
      </section>

      <div className="detail-grid">
        <section className="section">
          <div className="section-heading">
            <div>
              <h2>版本历史</h2>
              <p className="muted">创建新版本不会修改旧版本；发布/回滚只移动 active 指针。</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Status</th>
                  <th>Trace</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {prompt.versions.map((version) => {
                  const active = prompt.activeVersionId === version.id;
                  return (
                    <tr key={version.id}>
                      <td>
                        <Link className="row-link" href={`/prompts/${prompt.id}?base=${prompt.activeVersion?.version ?? version.version}&compare=${version.version}`}>
                          v{version.version}
                        </Link>
                      </td>
                      <td>
                        <span className={`badge ${active ? "provider" : version.status === "draft" ? "estimated" : ""}`}>
                          {active ? "active" : version.status}
                        </span>
                      </td>
                      <td>{formatNumber(version._count.traceRuns)} runs</td>
                      <td>{formatFullDate(version.createdAt)}</td>
                      <td>
                        {active ? (
                          <span className="muted">当前线上</span>
                        ) : (
                          <form action={setActivePromptVersionAction}>
                            <input type="hidden" name="promptId" value={prompt.id} />
                            <input type="hidden" name="versionId" value={version.id} />
                            <button className="button secondary" type="submit">
                              发布 / 回滚
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <section className="section-band prompt-block">
            <h2>Active Content</h2>
            <pre>{prompt.activeVersion?.content ?? "—"}</pre>
          </section>

          <section className="section-band">
            <div className="section-heading">
              <div>
                <h2>Diff</h2>
                <p className="muted">当前比较：v{baseVersion?.version ?? "—"} → v{compareVersion?.version ?? "—"}</p>
              </div>
              <span className="badge">+{summary.added} / -{summary.removed}</span>
            </div>
            {prompt.versions.length < 2 ? (
              <p className="muted">至少需要两个版本才能比较 diff。</p>
            ) : (
              <>
                <form className="filter-form prompt-diff-filter" method="get">
                  <label>
                    Base
                    <select name="base" defaultValue={String(baseVersion?.version ?? "")}>
                      {prompt.versions.map((version) => (
                        <option key={version.id} value={version.version}>
                          v{version.version}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Compare
                    <select name="compare" defaultValue={String(compareVersion?.version ?? "")}>
                      {prompt.versions.map((version) => (
                        <option key={version.id} value={version.version}>
                          v{version.version}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit">比较</button>
                </form>
                <div className="diff-view">
                  {diff.map((line, index) => (
                    <div className={`diff-line ${line.type}`} key={`${line.type}-${index}`}>
                      <span>{line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}</span>
                      <code>{line.text || " "}</code>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="section-band">
            <div className="section-heading">
              <div>
                <h2>EvalRuns</h2>
                <p className="muted">PromptVersion 的回归证据，供发布前复核。</p>
              </div>
              <span className="badge">{formatNumber(evalRuns.length)}</span>
            </div>
            {evalRuns.length === 0 ? (
              <p className="muted">这个 Prompt 还没有 EvalRun。</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>Dataset</th>
                      <th>Version</th>
                      <th>Pass Rate</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evalRuns.map((run) => (
                      <tr key={run.id}>
                        <td>
                          <Link className="row-link" href={`/evals/runs/${run.id}`}>
                            {compactId(run.id)}
                          </Link>
                        </td>
                        <td>{run.dataset.name}</td>
                        <td>v{run.promptVersion?.version ?? "—"}</td>
                        <td>{formatPercent(passRate(run.results))}</td>
                        <td><span className={`badge ${run.status === "needs_review" ? "estimated" : "provider"}`}>{run.status}</span></td>
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
            <h2>创建新版本</h2>
            <form className="stack-form" action={createPromptVersionAction}>
              <input type="hidden" name="promptId" value={prompt.id} />
              <label>
                内容
                <textarea name="content" required rows={16} defaultValue={prompt.activeVersion?.content ?? ""} />
              </label>
              <label className="checkbox-row">
                <input name="publish" type="checkbox" />
                创建后立即发布为 active
              </label>
              <button type="submit">保存为新版本</button>
            </form>
          </section>
        </aside>
      </div>
    </main>
  );
}
