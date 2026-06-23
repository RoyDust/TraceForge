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
- [ ] **2. console — Next.js 最小骨架 + Prisma**
  - 初始化最小 Next.js app（App Router），复用根 `prisma/schema.prisma` + `@prisma/adapter-pg`
  - 一个页面调 `prisma.project.findMany()` 列出 seed 项目，证明「控制台能连库」
  - 注意：runtime 适配器需带 `?schema=traceforge`（同 `seed.ts` 的解析逻辑）
  - → 验证：`npm run dev` 浏览器能列出 Demo Project
- [ ] **3. README 补「本地原生开发」段**
  - 写明两个进程怎么各自起、端口、依赖的 `.env`
  - → 验证：照 README 从零跑通两个服务

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

## Review（实施后补）

_待实施完成后在此记录实际结果与偏差。_
