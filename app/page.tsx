import { prisma } from "@/lib/prisma";

// 每次请求查库, 不在 build 时预渲染 (避免 build 阶段连库)。
export const dynamic = "force-dynamic";

export default async function Home() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { traceRuns: true, apiKeys: true } } },
  });

  return (
    <main
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        maxWidth: 720,
        margin: "48px auto",
        padding: "0 16px",
        lineHeight: 1.6,
      }}
    >
      <h1>TraceForge Console</h1>
      <p style={{ color: "#666" }}>控制面连库验证 —— 共 {projects.length} 个项目</p>
      {projects.length === 0 ? (
        <p>没有项目。先跑 <code>npm run db:seed</code> 灌示例数据。</p>
      ) : (
        <ul>
          {projects.map((p) => (
            <li key={p.id}>
              <strong>{p.name}</strong>
              {p.description ? ` — ${p.description}` : ""}{" "}
              <small style={{ color: "#999" }}>
                (traces: {p._count.traceRuns}, keys: {p._count.apiKeys})
              </small>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
