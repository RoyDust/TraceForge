import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ChatForm } from "./chat-form";

export const dynamic = "force-dynamic";

type ModelRow = Prisma.ModelConfigGetPayload<{ include: { provider: true } }>;

export default async function ChatPage() {
  let models: ModelRow[] = [];
  let readError: string | null = null;

  try {
    models = await prisma.modelConfig.findMany({
      where: {
        status: "active",
        provider: { status: "active" },
      },
      include: { provider: true },
      orderBy: [{ provider: { name: "asc" } }, { modelName: "asc" }],
    });
  } catch (error) {
    console.error(error);
    readError = "无法读取模型配置。请确认数据库连接可用。";
  }

  const hasChatApiKey = Boolean(process.env.TRACEFORGE_CHAT_API_KEY?.trim());

  return (
    <main className="chat-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">对话调试台</p>
          <h1>对话测试</h1>
          <p className="muted">右侧正常对话，左侧实时观察这次网关调用。</p>
        </div>
        <span className="badge">{models.length} 个可用模型</span>
      </header>

      {readError ? (
        <section className="error-state" role="alert">
          <h2>读取失败</h2>
          <p>{readError}</p>
        </section>
      ) : (
        <ChatForm
          hasChatApiKey={hasChatApiKey}
          models={models.map((model) => ({
            id: model.id,
            modelName: model.modelName,
            displayName: model.displayName,
            providerName: model.provider.name,
          }))}
        />
      )}
    </main>
  );
}
