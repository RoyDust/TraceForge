// Stage 5 demo: create a multi-version Prompt and a TraceRun linked to one PromptVersion.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const PROMPT_ID = "00000000-0000-0000-0000-000000000501";
const RUN_ID = "00000000-0000-0000-0000-000000000511";
const SPAN_ID = "00000000-0000-0000-0000-000000000512";
const CONSOLE_URL = process.env.STAGE5_CONSOLE_URL ?? "http://localhost:3000";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("缺 DATABASE_URL");
  const schema = new URL(process.env.DATABASE_URL).searchParams.get("schema") ?? undefined;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }, schema ? { schema } : undefined),
  });

  const project = await prisma.project.findUnique({ where: { id: PROJECT_ID } });
  if (!project) {
    throw new Error("Demo Project 不存在。请先运行 npm run db:seed 或 scripts/stage3-demo.mjs。");
  }

  const prompt = await prisma.prompt.upsert({
    where: { id: PROMPT_ID },
    update: {
      projectId: PROJECT_ID,
      name: "stage5-support-agent",
      description: "Stage 5 demo prompt with version history, diff, rollback, and trace link.",
    },
    create: {
      id: PROMPT_ID,
      projectId: PROJECT_ID,
      name: "stage5-support-agent",
      description: "Stage 5 demo prompt with version history, diff, rollback, and trace link.",
    },
  });

  const versions = [
    {
      version: 1,
      status: "published",
      content: [
        "You are a concise support assistant.",
        "Answer in Chinese.",
        "Ask one clarifying question when the request is ambiguous.",
      ].join("\n"),
    },
    {
      version: 2,
      status: "published",
      content: [
        "You are a precise support assistant for TraceForge operators.",
        "Answer in Chinese.",
        "When the request is ambiguous, ask one clarifying question.",
        "Always include the related TraceRun or PromptVersion when available.",
      ].join("\n"),
    },
    {
      version: 3,
      status: "draft",
      content: [
        "You are a precise support assistant for TraceForge operators.",
        "Answer in Chinese with short operational steps.",
        "When the request is ambiguous, ask one clarifying question.",
        "Always include the related TraceRun, PromptVersion, and suggested verification command when available.",
      ].join("\n"),
    },
  ];

  const savedVersions = [];
  for (const version of versions) {
    savedVersions.push(
      await prisma.promptVersion.upsert({
        where: { promptId_version: { promptId: prompt.id, version: version.version } },
        update: {
          content: version.content,
          status: version.status,
        },
        create: {
          promptId: prompt.id,
          version: version.version,
          content: version.content,
          status: version.status,
        },
      }),
    );
  }

  const activeVersion = savedVersions.find((version) => version.version === 2) ?? savedVersions[0];
  await prisma.prompt.update({
    where: { id: prompt.id },
    data: { activeVersionId: activeVersion.id },
  });

  await prisma.traceRun.upsert({
    where: { id: RUN_ID },
    update: {
      promptVersionId: activeVersion.id,
      status: "success",
      name: "stage5 prompt-linked run",
      inputPreview: "user: explain why PromptVersion links matter",
      outputPreview: "PromptVersion links make runtime behavior traceable.",
      totalTokens: 31,
      cost: "0.0000310",
      latencyMs: 430,
      usageSource: "provider",
      endedAt: new Date(),
    },
    create: {
      id: RUN_ID,
      projectId: PROJECT_ID,
      promptVersionId: activeVersion.id,
      name: "stage5 prompt-linked run",
      status: "success",
      inputPreview: "user: explain why PromptVersion links matter",
      outputPreview: "PromptVersion links make runtime behavior traceable.",
      totalTokens: 31,
      cost: "0.0000310",
      latencyMs: 430,
      usageSource: "provider",
      endedAt: new Date(),
      spans: {
        create: {
          id: SPAN_ID,
          type: "llm",
          name: "chat.completions",
          model: "mock-ok",
          provider: "Mock Upstream",
          promptTokens: 18,
          completionTokens: 13,
          usageSource: "provider",
          cost: "0.0000310",
          latencyMs: 390,
          status: "success",
          inputPreview: "stage5 prompt-linked request",
          outputPreview: "stage5 prompt-linked response",
          endedAt: new Date(),
        },
      },
    },
  });

  console.log("Stage 5 demo data ready");
  console.log(`Prompt:       ${CONSOLE_URL}/prompts/${prompt.id}`);
  console.log(`Diff v1->v3:  ${CONSOLE_URL}/prompts/${prompt.id}?base=1&compare=3`);
  console.log(`Trace detail: ${CONSOLE_URL}/traces/${RUN_ID}`);
  console.log("");
  console.log("Expected evidence:");
  console.log("- Prompt list shows stage5-support-agent.");
  console.log("- Prompt detail has v1/v2/v3, active v2, and diff output.");
  console.log("- Publishing/rollback moves the active badge without mutating version content.");
  console.log("- Trace detail shows Prompt Version stage5-support-agent · v2.");

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
