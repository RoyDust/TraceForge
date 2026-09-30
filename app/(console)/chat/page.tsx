import type { Prisma } from "@prisma/client";
import { getConsoleDb } from "@/lib/dal";
import { ChatForm } from "./chat-form";

export const dynamic = "force-dynamic";

type ModelRow = Prisma.ModelConfigGetPayload<{ include: { provider: true } }>;

export default async function ChatPage() {
  const prisma = await getConsoleDb();
  let models: ModelRow[] = [];

  models = await prisma.modelConfig.findMany({
    where: {
      status: "active",
      provider: { status: "active" },
    },
    include: { provider: true },
    orderBy: [{ provider: { name: "asc" } }, { modelName: "asc" }],
  });

  const hasChatApiKey = Boolean(process.env.TRACEFORGE_CHAT_API_KEY?.trim());

  return (
    <main className="chat-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">PLAYGROUND</p>
          <h1>对话测试</h1>
          <p className="muted">发送一次真实请求，同步查看延迟、用量和运行证据。</p>
        </div>
        <span className="badge">{models.length} 个可用模型</span>
      </header>

      {(
        <ChatForm
          hasChatApiKey={hasChatApiKey}
          defaultModel={process.env.TRACEFORGE_CHAT_MODEL?.trim() || undefined}
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
