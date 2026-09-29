# TraceForge

AI 网关与 Agent 可观测控制台。Rust Gateway 代理 OpenAI-compatible 调用并写入 Trace；Next.js Console 提供治理看板、追踪瀑布图、对话调试、Prompt 版本管理和 Eval 回归。两者共享 PostgreSQL，Prisma schema 是数据契约。

## 当前能力（2026-09-29）

- **治理看板**：请求量、失败率、P95、Token、成本、日趋势、模型/供应商、限流、fallback 与流式错误，全部读取持久化数据。最近列表最多 9 个 Run，统计不受列表限制。
- **Trace**：Run / Span / Event、调用树、瀑布图、责任域归因；可识别项目的网关拒绝允许没有 Span。
- **Chat Playground**：预声明 Run ID，响应后由 Next.js after() 派发到真实 Gateway，支持非流式/流式调用及有截止时间的结果等待。
- **Prompt / Eval**：版本发布和回滚；六种断言（llm_judge 真实调用所选模型，返回评分和理由）、人工复核、运行对比；同步评测有样本上限、超时和提交幂等。
- **权限与展示**：单管理员、每个敏感入口独立校验 Session、全站 noindex；显式 DEMO_MODE 与 NODE_ENV 无关。
- **部署与测试**：Node standalone、非 root Console / 预编译 Gateway 容器、SQLx 离线编译、数据库迁移、真实 PostgreSQL + Rust Gateway + mock 上游的 Playwright 回归。

当前没有 Redis、持久化任务队列、独立 Worker、多用户权限或持久化 Chat 会话。网关限流为进程内状态；公开部署需要另外准备服务器、DNS、TLS 和真实密钥。验收矩阵见 [测试说明](docs/testing.md)，历史计划与交付记录见 [tasks/todo.md](tasks/todo.md)。

## 本地快速开始

需要 Node.js 22.13+、Rust stable、PostgreSQL 16（可用 Docker）。以下流程连接自己选择的数据库，不清空已有数据。

~~~bash
cp .env.example .env
npm ci
npm run db:generate
# 在 .env 填写下方变量；新数据库应用迁移
npm run db:deploy
npm run db:seed
npm run usage:aggregate
npm run dev
~~~

本地演示的 .env 至少设置：

~~~dotenv
DATABASE_URL="postgresql://traceforge:traceforge@localhost:5432/traceforge"
DEMO_MODE="true"
ADMIN_EMAIL=""
ADMIN_PASSWORD_HASH=""
MASTER_ENCRYPTION_KEY="<openssl rand -base64 32 的输出，保留此值>"
TRACEFORGE_CHAT_GATEWAY_URL="http://localhost:8787"
TRACEFORGE_CHAT_API_KEY="<自行生成的演示网关 Key>"
TRACEFORGE_EVAL_GATEWAY_URL="http://localhost:8787"
TRACEFORGE_EVAL_API_KEY="<同一个演示网关 Key>"
TRACEFORGE_DEMO_UPSTREAM_URL="http://localhost:8799/v1"
~~~

Seed 仅在 DEMO_MODE=true 时允许运行，幂等写入 Demo Project、mock 模型及定价、Prompt 两个版本、Eval 样本和 24 条 Run（每条两个 Span）；将上述显式配置的 Gateway Key 哈希写入数据库，不调用付费模型。重复 seed 不清空已有数据，但会更新固定 demo provider 的 mock 地址与加密凭据。

另开两个终端，从仓库根目录启动上游和网关。让 Gateway 使用与 seed 相同的 DATABASE_URL 和 MASTER_ENCRYPTION_KEY：

~~~bash
# 终端 2
cargo run --manifest-path gateway/Cargo.toml --bin mock_upstream
# 终端 3（根 .env 由 Gateway dotenv 加载；已导出的环境变量优先）
GATEWAY_ADDR=0.0.0.0:8787 cargo run --manifest-path gateway/Cargo.toml --bin traceforge-gateway
~~~

打开 http://localhost:3000/dashboard。显式 Demo 且未配置自定义管理员时，使用 demo@traceforge.local / traceforge-demo；界面持续显示演示标识。关闭 Demo 后必须配置自有管理员，演示密码和 change-me 占位密码（包括其哈希）均被拒绝。所有页面仍需登录。

~~~bash
curl http://localhost:8787/healthz
curl http://localhost:8787/readyz
~~~

如果已有旧版数据库，请先按 [部署说明](DEPLOYMENT.md) 备份、核对差异并建立迁移基线，不能对有数据的库直接重放完整首次迁移。

## 接入真实 DeepSeek / 兼容中转

在本地 .env 配置上游地址、密钥与模型，复用现有初始化脚本：

~~~dotenv
DEEPSEEK_BASE_URL="https://your-relay.example/v1"
DEEPSEEK_API_KEY="<上游网关密钥，仅初始化使用>"
DEEPSEEK_MODEL="deepseek-v4.1-flash"
TRACEFORGE_CHAT_MODEL="deepseek-v4.1-flash"
~~~

~~~bash
npx tsx scripts/seed-deepseek.ts
~~~

脚本在同一事务内更新 DeepSeek 配置槽的地址、模型和 AES-256-GCM 密文。上游密钥加密入库后可从 .env 删除；不要把它当作 TRACEFORGE_CHAT_API_KEY，后者仍是本地 Gateway 的项目密钥。改动默认模型后重启 Console，Chat 会默认选择对应模型，Eval 模型列表也可直接选择它。Demo 标识与持久化演示记录不因接入真实模型而自动改变。

未确认中转价格时不创建 ModelPricing，真实调用照常记录 Token 与延迟，Trace 成本保持未知。官方费率存在缓存/高低峰差异，不能冒用为中转实际收费；核实记录见 [计价来源](docs/verification/relay-pricing.md)。

## Agent Trace API 与 Node SDK

Gateway 提供四个写接口：POST /api/traces/runs、POST /api/traces/runs/{id}/spans、POST /api/traces/runs/{id}/spans/{spanId}/end、POST /api/traces/runs/{id}/end；GET /api/traces/runs/{id} 可读取同项目 Agent 链路。全部使用项目 API Key 的 trace_ingest 权限，既有 Console Session 不参与。

~~~js
import { createTraceClient } from "./sdk/node/index.mjs";
const trace = createTraceClient({ gatewayUrl: "http://localhost:8787", apiKey: process.env.TRACEFORGE_AGENT_API_KEY });
const runId = await trace.startRun({ name: "My Agent", input: "topic" });
const spanId = await trace.startSpan(runId, { type: "workflow", name: "write" });
// 模型请求加 X-TraceForge-Agent-Run-Id: runId 和 X-TraceForge-Parent-Span-Id: spanId
// 使用同时含 gateway / trace_ingest 的项目 Key。不可与 X-TraceForge-Run-Id 混用。
await trace.endSpan(runId, spanId, { output: "draft" });
await trace.endRun(runId, { output: "draft" });
~~~

ID 可显式传入，重复创建返回 409，不覆盖旧记录。手工 Span 仅接受 workflow/tool/db/review；LLM Span 由网关管理且是叶节点。父子归属必须一致，结束时不能有活动子 Span；SDK 最多等待 10 秒读取异步写入结果，不能确认结束就报错，不自动重发模型请求或写操作。服务崩溃/写队列故障可能留下 running Span，不宣称持久队列保证。

~~~bash
# 真实执行选题、资料抓取、成文、审稿与写文件；会产生三次付费模型调用
# 使用已有活动模型和双 scope Key；输出文件已存在时拒绝覆盖
node examples/writing-agent.mjs https://example.com /tmp/my-new-draft.md
~~~

LLM Judge 的 assertion_config 支持 rubric 与 0–1 的 threshold（默认 0.7），输入、参考答案和候选输出作为待审数据。每个样本新增一次通过 Gateway 的真实评审调用，沿用当前所选模型和总预算；异常 JSON/超时记为 error，不退回关键词规则。生成与评审分别按实际 fallback 模型计费，缺一项价格则合计为未知。

## 验证

~~~bash
npm run lint
npm run typecheck
npm run test:unit
npx prisma validate
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:docker
npm run deploy:check
~~~

E2E 默认创建临时 PostgreSQL 容器；也可显式提供 TEST_DATABASE_URL。每轮只操作自己的随机 schema，测试后清理。Node 与 Docker 模式共用真实 Gateway 和浏览器用例；Docker 模式运行预编译 Gateway 与 mock 镜像，验证 UID 1001、普通配置、Demo 和缺少 API Key 的运行实例。deploy:check 校验当前 .env 的实际值，不代替网络就绪检查。

## 数据与运行契约

- 数据库存储和 API 时间均为 UTC，页面及筛选为 Asia/Shanghai。日期范围左闭右开；UsageDaily.date 是上海自然日标签。
- 请求数按 Run 计算；Token 对同范围 Span 求和；总成本取 Run.cost，不能与 Span.cost 再相加。P95 使用全区间有效延迟，不平均各日 P95。成本内部使用 Decimal；缺失成本显示“—”。
- UsageDaily 只有在与当前明细快照的数量、Token、成本一致时才用于趋势，否则使用数据库聚合；聚合脚本采用锁和事务重建选定日期范围。
- Chat after() 是进程内尽力派发，超时或重启可能留下未确认状态。签名 pending 凭据有截止时间，界面不会无限等待，也不会自动重发状态不明的付费请求。
- Eval 默认最多 20 样本、单次调用 30 秒、总预算 120 秒。读取页面时回收超期 running 任务，保留已有结果与费用；人工复核不会把执行失败伪装成成功。fallback 按 Gateway 实际模型计价，无定价或用量时成本未知。
- Next loading 已发出流式响应后，缺失资源显示标准 not-found UI，HTTP 状态可能为 200；未开始流式响应的缺失路由返回 404。

## 工程入口

| 路径 | 用途 |
| --- | --- |
| prisma/schema.prisma、prisma/migrations | 数据契约和可重复数据库迁移 |
| app/(console)、lib | Console 页面、权限、聚合与执行逻辑 |
| gateway | Rust 数据面、mock 上游与 SQLx 编译检查 |
| tests、scripts/run-e2e.mjs | 单元测试、真实进程验收与隔离资源清理 |
| DEPLOYMENT.md、docs/testing.md | 环境契约、部署流程与规格验收 |
| CONTEXT.md、docs/adr | 领域术语和已接受决策 |
| tasks/todo.md | 当前任务状态及历史审查记录 |

Schema 修改通过 Prisma migration 管理；CI 先部署迁移，再编译 Rust SQLx 查询宏，防止两套访问代码与数据库结构漂移。非 public schema 的 Console URL 使用 ?schema=traceforge；Rust URL 使用 ?options=-c%20search_path%3Dtraceforge。真实凭据只留在本地环境或部署秘密存储中。

## 许可

未定。
