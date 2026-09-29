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
          <p className="eyebrow">对话调试台</p>
          <h1>对话测试</h1>
          <p className="muted">右侧正常对话，左侧实时观察这次网关调用。</p>
        </div>
        <span className="badge">{models.length} 个可用模型</span>
      </header>

      {(
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
