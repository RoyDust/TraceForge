import { randomUUID } from "node:crypto";
import { ActionForm } from "@/components/traceforge/action-form";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { formatDate, formatNumber } from "@/lib/format";
import { getConsoleDb } from "@/lib/dal";
import { createPromptAction } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type PromptRow = Prisma.PromptGetPayload<{
  include: {
    project: true;
    activeVersion: true;
    versions: { select: { id: true } };
  };
}>;
type ProjectRow = Prisma.ProjectGetPayload<Record<string, never>>;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PromptsPage({ searchParams }: { searchParams: SearchParams }) {
  const prisma = await getConsoleDb();
  const rawParams = await searchParams;
  const projectId = one(rawParams.projectId)?.trim();
  let prompts: PromptRow[] = [];
  let projects: ProjectRow[] = [];

  [prompts, projects] = await Promise.all([
    prisma.prompt.findMany({
      where: projectId ? { projectId } : {},
      include: {
        project: true,
        activeVersion: true,
        versions: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.project.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  return (
    <main>
      <header className="page-head">
        <div>
          <p className="eyebrow">PROMPT LIBRARY</p>
          <h1>提示词版本管理</h1>
          <p className="muted">把提示词改动固化成版本快照，支持差异对比、发布和回滚。</p>
        </div>
        <span className="badge">{formatNumber(prompts.length)} 个提示词</span>
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
          <Link className="button secondary" href="/prompts">
            重置
          </Link>
        </div>
      </form>

      {(
        <div className="detail-grid">
          <section className="section">
            <div className="section-heading">
              <div>
                <h2>提示词列表</h2>
                <p className="muted">当前现行版本是线上指针；历史版本保持不可变。</p>
              </div>
            </div>
            {prompts.length === 0 ? (
              <div className="empty-state">
                <h3>还没有提示词</h3>
                <p className="muted">运行 `node scripts/stage5-demo.mjs` 生成多版本样例，或直接在右侧创建。</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th>项目</th>
                      <th>现行版本</th>
                      <th>版本数</th>
                      <th>创建时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prompts.map((prompt) => (
                      <tr key={prompt.id}>
                        <td>
                          <div className="meta-stack">
                            <Link className="row-link" href={`/prompts/${prompt.id}`}>
                              {prompt.name}
                            </Link>
                            <small className="muted">{prompt.description ?? "—"}</small>
                          </div>
                        </td>
                        <td>{prompt.project.name}</td>
                        <td>{prompt.activeVersion ? <span className="badge provider">v{prompt.activeVersion.version}</span> : "—"}</td>
                        <td>{formatNumber(prompt.versions.length)}</td>
                        <td>{formatDate(prompt.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <aside className="section">
            <section className="section-band">
              <h2>创建提示词</h2>
              <ActionForm className="stack-form" action={createPromptAction}><input type="hidden" name="requestId" value={randomUUID()} />
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
                  <input name="name" required placeholder="写作系统" />
                </label>
                <label>
                  描述
                  <input name="description" placeholder="用途、调用场景或负责人" />
                </label>
                <label>
                  初始内容
                  <textarea name="content" required rows={8} placeholder="你是..." />
                </label>
                <button type="submit">创建并发布 v1</button>
              </ActionForm>
            </section>
          </aside>
        </div>
      )}
    </main>
  );
}
