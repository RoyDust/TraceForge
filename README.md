# TraceForge

> 面向 AI 应用开发者的 **AI 网关 + Agent 可观测平台**。
> 让 AI 应用从「能跑」变成「可观测、可评估、可治理、可上线」。

数据面 / 控制面分离：**Rust（axum / tokio / sqlx）网关** + **Next.js（Prisma 7）控制台**，共享 PostgreSQL，以 Prisma schema 作单一事实源。

## 核心卖点

- **一次失败的 Agent 调用，3 步定位根因**——筛失败 → 看链路瀑布图 → 定责任域（模型 / Prompt / 工具 / 网络 / 限流 / 业务）。把可观测做到「可归因」，而不只是「可展示」。
- **零侵入接入**：OpenAI Compatible，普通 LLM 调用仅改 `baseURL` 即可被网关接管并自动 Trace；Agent 多步链路通过 Trace API / SDK 上报 tool / workflow / db / review 等 Span。
- **统一治理**：多 Provider 接入、按 Key 限流（RPM / 并发）、首 chunk 前 fallback、token / 成本 / 失败率 / P95 延迟项目维度看板。
- **Prompt 版本管理 + Eval 回归**：改 Prompt 产生新版本可 diff / 回滚，跑评测集看通过率与回归对比。

## 架构

```
                  ┌─────────────────────────────────────────┐
  Client          │            Rust 数据面 (Data Plane)        │      上游 LLM
 (改 baseURL) ───▶ │  TraceForge Gateway                       │ ───▶ OpenAI /
                  │  · OpenAI Compatible 入口 + SSE 流式透传    │      兼容接口
                  │  · token/耗时统计 · Key 校验 · 限流 · 采集  │
                  └───────────────┬─────────────────────────┘
                                  │ 有界 channel + async worker（观测写入不阻塞主转发）
                                  ▼
                          ┌───────────────┐
                          │  PostgreSQL    │  ← Prisma schema 作单一事实源 / 数据契约
                          └───────┬───────┘
                                  │ 读 / 管理
                  ┌───────────────▼─────────────────────────┐
                  │           TS 控制面 (Control Plane)        │
                  │  TraceForge Console (Next.js)             │
                  │  · Dashboard · Trace 瀑布图 · Prompt · Eval │
                  └───────────────────────────────────────────┘
```

| 层 | 职责 | 技术栈 |
|----|------|--------|
| **Rust 数据面** | 网关入口、代理转发、SSE 透传、token/耗时统计、Trace 写库、Key 校验 + 限流 | Rust · axum · tokio · reqwest · sqlx |
| **TS 控制面** | 控制台 UI、Dashboard、Trace 可视化、Prompt 版本、Eval、业务 API | Next.js · React · Prisma 7 · Tailwind |
| **共享存储** | 单一事实源 + 数据契约 | PostgreSQL · Redis（限流 / 缓存） |

### 可交互架构文档

仓库内的 `.omm/` 由 [Oh My Mermaid](https://github.com/oh-my-mermaid/oh-my-mermaid) 生成，包含总体架构、请求生命周期、数据流、路由页面和外部集成五个可递归展开的视角。

```powershell
# 打开本地交互式架构浏览器
omm view

# 查看、校验或刷新文档
omm list
omm validate
# 在 Codex 中使用 /omm-scan 刷新架构文档
```

## 当前状态

当前已完成 Stage 0–6 的本地可验证闭环。已落地：

- ✅ **数据契约**：`prisma/schema.prisma`（15 model + 6 enum，列名 snake_case 对齐 sqlx），通过 `prisma validate`。
- ✅ **种子数据**：`prisma/seed.ts` 幂等灌入示例项目 / Key / Provider / Model / 定价 / Prompt / 一条 Trace。
- ✅ **双 ORM 闸门验证**：`gateway/examples/sqlx_smoke.rs`，`query!` 宏编译期连库校验 Rust SQL 与 schema 一致（CI 跑 `cargo build --bins --examples`）。
- ✅ **gateway 常驻服务**：axum HTTP server，`/healthz`（存活）+ `/readyz`（探 PostgreSQL）。
- ✅ **Console + Trace 可视化**：单管理员登录、TraceRun 列表/详情、Span Tree、瀑布图和责任域归因。
- ✅ **成本 Dashboard**：UsageDaily 聚合、模型/Provider 拆分、限流 / fallback / stream_interrupted 治理面板。
- ✅ **Prompt 版本管理**：Prompt 列表、版本历史、diff、发布/回滚、TraceRun.prompt_version_id 追溯。
- ✅ **Eval 回归评测**：EvalDataset / EvalCase / EvalRun / EvalResult 控制台，支持六类断言、人工复核和版本对比报告。
- ✅ **上线准备包**：Docker Compose、Console/Gateway Dockerfile、Nginx 反代样例、部署 readiness CI 和本地配置校验脚本。

按 PRD 分阶段推进：Rust 网关 MVP（SSE 透传 + 限流）→ Trace 采集 → 控制台 + 瀑布图 → 成本看板 → Prompt 版本 → Eval。见下方[路线图](#路线图)与 [工程 PRD](TraceForge-工程PRD.md)。

## 目录

| 路径 | 作用 |
|------|------|
| `prisma/schema.prisma` | 数据契约（单一事实源，15 model + 6 enum） |
| `prisma.config.ts` | Prisma 7 连接 / 迁移 / seed 配置 |
| `prisma/seed.ts` | 示例数据（项目 / Key / 模型 / 定价 / Prompt / 一条 Trace） |
| `app/`、`lib/` | Next.js 控制台（控制面，App Router + Prisma 客户端） |
| `gateway/` | Rust 数据面（axum 服务 + `examples/sqlx_smoke.rs` 闸门示例） |
| `.github/workflows/ci.yml` | Prisma schema 与 Rust sqlx 同步校验 |
| `TraceForge-工程PRD.md` | 工程实现依据（精修层） |
| `TraceForge_AI网关与Agent可观测平台_PRD.md` | 完整版 PRD（字段口径权威源） |

## 快速开始

前置：Node 22+、Rust stable、PostgreSQL（本地可用 `docker run -e POSTGRES_PASSWORD=traceforge -e POSTGRES_USER=traceforge -e POSTGRES_DB=traceforge -p 5432:5432 postgres:16`）。

```bash
cp .env.example .env            # 填好 DATABASE_URL
npm install
npm run db:push                 # 用 schema.prisma 建表 (首版无迁移文件; 正式用 db:migrate)
npm run db:seed                 # 灌示例数据
npm run db:studio               # 可选: 浏览数据
npm run dev                      # 起控制台 -> http://localhost:3000 (列出 seed 项目)
```

> 离线编译（无 DB 时 `cargo build`）：在能连库时跑 `cargo sqlx prepare` 生成并提交 `gateway/.sqlx/`。

### 本地原生开发（无 Docker）

两个服务各自一个进程，都直连同一个 PostgreSQL：

```bash
# 控制台 (TS 控制面) —— 仓库根
npm run dev                      # http://localhost:3000

# 网关 (Rust 数据面) —— gateway/
cd gateway
cargo run                       # 读 gateway/.env; 默认 http://0.0.0.0:8080
curl localhost:8080/healthz     # 存活 -> ok
curl localhost:8080/readyz      # 就绪 (探 PostgreSQL) -> ready
```

- 网关监听地址可用 `GATEWAY_ADDR` 覆盖（如 8080 被占）：在 `gateway/.env` 设 `GATEWAY_ADDR="0.0.0.0:8787"`。
- 控制台端口被占时用 `npm run dev -- -p 3001`。
- 双 ORM 闸门冒烟：`cd gateway && cargo run --example sqlx_smoke`（写读一条 Trace，验证 sqlx 与 schema 一致）。
- Docker / Compose 留到部署阶段（PRD Stage 6）或本机装 Docker 后再做。

### 在非 public schema / 共享库上开发

若 DB 账号没有 `CREATEDB` 权限（无法新建独立数据库），可退而把全部表放进现有库的一个独立 schema（如 `traceforge`），与该库其他表隔离，需要时 `DROP SCHEMA traceforge CASCADE` 即可清除。指定 schema 时 **Prisma 与 sqlx 写法不同，两个 `.env` 都要带**：

| 工具 | 文件 | DATABASE_URL 末尾 |
|------|------|------------------|
| Prisma（CLI / Studio / seed） | 根 `.env` | `?schema=traceforge` |
| Rust sqlx（编译期 `query!` + 运行期） | `gateway/.env` | `?options=-c%20search_path%3Dtraceforge`（sqlx 不解析 `?schema=`） |

`prisma/seed.ts` 会从 `DATABASE_URL` 解析 `?schema=` 并传给 `PrismaPg` 适配器（driver adapter 默认落 `public`，不传则找不到表）。两个 `.env` 均含真实凭证，**勿提交版本库**（已在 `.gitignore`）。

## 验证基线

```bash
npm ci
npm run db:generate
npm run lint
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

浏览器测试自动启动隔离的 PostgreSQL、真实 Console 和 Rust mock Gateway。没有 Docker 时，显式设置 `TEST_DATABASE_URL` 连接已有测试数据库；每次运行创建独立 schema，退出时清理。配置、测试范围和报告见 [测试说明](docs/testing.md)。

## 双 ORM 契约

PostgreSQL 是单一事实源：**Prisma 负责 migration**（改 `schema.prisma` 后 `npm run db:migrate`），**Rust 用 sqlx 按表读写**。两边靠 CI 同步——[`ci.yml`](.github/workflows/ci.yml) 先 `prisma db push` 建库，再 `cargo build` 让 sqlx 的 `query!` 宏在编译期校验 Rust SQL 是否与 schema 一致；schema 漂移会让 CI 失败。

约定：Rust 只写 Trace 热路径表（TraceRun / Span / Event）；Project / ApiKey / Prompt 等控制面实体由 Console（Prisma）写。主键 id 两边都应用侧生成（Prisma `uuid()` / Rust `uuid` crate）。

## 路线图

按 PRD 分阶段交付，每阶段可独立验收：

| 阶段 | 内容 |
|------|------|
| Stage 0 | Docker Compose 跑通 gateway + console + PostgreSQL 骨架 |
| Stage 1 | Rust 网关 MVP：`/v1/chat/completions` 代理 + SSE 透传 + Key 校验 + Redis 限流 + `/healthz` `/readyz` `/metrics` |
| Stage 2 | Trace 采集：有界 channel + async worker 异步写库，记录 usage / 耗时 / 状态 / error_code |
| Stage 2.5 | Trace SDK / 手动 Span 上报，示例写作 Agent 落库为多步 Trace |
| Stage 3 | Console + Trace 瀑布图，NextAuth 单管理员，3 步定位根因 |
| Stage 4 | 成本 Dashboard + 限流 / fallback 治理可视化 |
| Stage 5 | Prompt 版本管理 + diff / 回滚 |
| Stage 6 | Eval 回归评测 + 部署上线 |

## 许可

未定。
