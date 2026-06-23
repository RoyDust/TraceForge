# 下一步计划 · 本地原生跑通（无 Docker）

> 环境约束：当前 Windows 无 Docker。故下一步走**本地原生运行**——gateway 用 `cargo run`、console 用 `npm run dev`，直连已配好的远程 PostgreSQL（`traceforge` schema）。
> Docker / Compose 降级为**部署阶段（PRD Stage 6）或装了 Docker 之后**再做，见末尾「已延后」。
>
> 当前状态：数据契约（Prisma schema）+ seed + 最小 sqlx 示例 + CI 已落地。

## 目标与验收

本地两个进程跑起来：
1. gateway（axum）常驻，`curl :8080/healthz` 得 200，`/readyz` 能反映 Postgres 连通；
2. console（Next.js）`npm run dev`，页面能连库列出 seed 的 Demo Project。

不依赖 Docker，不依赖 Redis（Redis 留到 Stage 1 限流再引入）。

## 计划（每项 → 验证）

- [x] **1. gateway 转常驻 axum 服务**（核心下一步，原生可跑）✅
  - 加 `axum 0.8` + tokio `net` 依赖；`main.rs` 改为 axum HTTP server
  - 监听地址可配 `GATEWAY_ADDR`（默认 `0.0.0.0:8080`；本机 8080 被占，gateway/.env 设 8787）
  - `GET /healthz`：返回 200 `ok`，不查 DB（`connect_lazy` 让 DB 不可用时仍存活）
  - `GET /readyz`：跑 `SELECT 1`，连通 200 `ready`、否则 503
  - 一次性 sqlx 示例已挪到 `gateway/examples/sqlx_smoke.rs`；CI 改 `cargo build --bins --examples` 保住闸门
  - ✅ 验证通过：服务起在 `:8787`，`curl /healthz`→`ok` 200、`curl /readyz`→`ready` 200（实测）
- [x] **2. console — Next.js 最小骨架 + Prisma**（建在仓库根 = TS 控制面，复用现有 Prisma 配置）✅
  - Next 16 + React 19，App Router：`app/layout.tsx` + `app/page.tsx`（server component 查库）
  - `lib/prisma.ts` 单例：PrismaPg 适配器 + 从 `DATABASE_URL` 解析 `?schema=`（同 seed.ts 口径）
  - `next.config.ts` serverExternalPackages 排除 prisma/pg；`.gitignore` 加 Next 产物
  - ✅ 验证通过：`npm run dev` → `http://localhost:3000` HTTP 200，页面列出 seed 的 “Demo Project / TraceForge 示例项目”（实测）
- [x] **3. README 补「本地原生开发」段**✅
  - 新增「本地原生开发（无 Docker）」小节：两进程怎么起、端口、`GATEWAY_ADDR`/`-p` 覆盖、闸门冒烟、Docker 延后说明
  - 同步更新「当前状态」「目录」「快速开始」反映 axum 服务 + console 落地

## 范围边界（本阶段不做）

- 不实现 `/v1/chat/completions` 代理与 SSE 透传（Stage 1）
- 不做 Key 校验 / 限流 / fallback（Stage 1，届时引入 Redis）
- 不做 Trace 写入管线（Stage 2）
- console 只做「能连库」最小页，不做 dashboard / NextAuth（Stage 3）

## 待定决策（Stage 1 前需定，不阻塞下一步）

- **Redis 怎么提供**（Stage 1 限流依赖）：本机装（Memurai / WSL2 redis）、用远程 Redis、还是先内存兜底后接 Redis？下一步不碰，先记下。

## 已延后（环境就绪后再做）

- **Docker 化**：gateway 多阶段 Dockerfile（`SQLX_OFFLINE` + 提交 `.sqlx/`）、console Dockerfile、`docker-compose.yml`（postgres + redis + 两服务）。
  - 归入 PRD Stage 6（部署：Docker + Nginx + GitHub Actions），或本机装了 Docker Desktop / WSL2 后提前做。
  - 前置：Docker build 阶段无 DB，需先 `cargo sqlx prepare` 生成并提交 `gateway/.sqlx/`。

## Review

三步全部完成并各自实测通过、逐步提交推送：

- **第1步** `e84bfc1`：gateway → axum 常驻服务 + `/healthz` `/readyz`，实测两探针 200。过程发现本机 8080 被占，改 `GATEWAY_ADDR` 配置化用 8787。
- **第2步** `cec39d7`：Next.js 16 控制台建在仓库根（复用 Prisma 配置，未单独建 `console/`），`localhost:3000` 列出 seed 的 Demo Project。
- **第3步**：README 补本地原生开发说明 + 同步状态/目录/快速开始。

偏差与取舍：
- 计划写的是 `console/` 目录，实际建在仓库根（根已是 TS/Prisma 包，避免重复配置）。
- Redis、Docker 化均按计划延后（Stage 1 / Stage 6）。

下一步候选（未开始）：PRD Stage 1 —— `/v1/chat/completions` 代理 + SSE 流式透传，届时引入 Redis 做限流。
