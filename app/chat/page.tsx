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
    readError = "无法读取 ModelConfig。请确认数据库连接可用。";
  }

  const hasChatApiKey = Boolean(process.env.TRACEFORGE_CHAT_API_KEY?.trim());

  return (
    <main>
      <header className="page-head">
        <div>
          <p className="eyebrow">Chat Playground</p>
          <h1>对话测试</h1>
          <p className="muted">发送一次真实 Gateway 调用，并进入对应 TraceRun。</p>
        </div>
        <span className="badge">{models.length} active models</span>
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
