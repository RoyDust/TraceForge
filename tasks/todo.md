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

---

# Stage 1 拆解 · Rust 网关 MVP

> 目标（PRD Stage 1 验收）：客户端改 `baseURL` 指向网关，调用效果（含流式）与直连一致；
> 超 `rpm_limit` / `concurrency_limit` 的请求被拒并返回 OpenAI-compatible `rate_limit_error`；
> `/readyz` 可判断能否接流量，`/metrics` 暴露运行指标。
>
> **范围切割**：Trace 持久化（TraceRun/Span 落库）属 **Stage 2**。本阶段错误只「返回客户端 + 计入 metrics」，**不落库**。
> 限流改为**进程内存实现**（决策 9），不再依赖 Redis，无外部基础设施阻塞。决策详见 PRD §9。

## 前置（决策已定，见 PRD §9）

- **限流**：内存实现 + trait 抽象（决策 9），Redis 留作后续增强。
- **真实上游**：DeepSeek（OpenAI 兼容）；key 放 `.env`，经 TS 脚本加密灌库（决策 10、11）。
- **测试夹具**：自写 mock OpenAI-compatible 上游，造首 chunk 前失败 / 流中途断 / 超时 / usage chunk（决策 10）。

## 步骤 0 · 前置 setup

- [ ] **0a. mock 上游**：最小 OpenAI-compatible 上游（可配流式/非流式、注入 usage chunk、首 chunk 前失败、流中途断、超时），放仓库当测试夹具
- [ ] **0b. DeepSeek key 灌库**：TS 脚本用 `MASTER_ENCRYPTION_KEY` 加密 DeepSeek key 写入 `model_provider.api_key_encrypted`（格式 `base64(nonce‖密文‖tag)`，决策 11）；并配好 DeepSeek 的 provider / model 行

## 计划（每步 → 验证；尽量互相解耦）

- [ ] **1. 路由骨架 + 请求体解析**
  - 加 `reqwest`（rustls）依赖；`POST /v1/chat/completions` 路由先返回占位
  - 解析并只取 `model`（路由）、`stream`（响应处理）、`messages`（后续 preview/估算）；**其余字段保留原始 body 不动**
  - → 验证：`curl` 命中路由；能从 body 正确读出 `model` / `stream`
- [ ] **2. Provider 解析 + Key 解密（AES-256-GCM，§3.2）**
  - `model` → 查 `ModelConfig` + `ModelProvider`（PG）得 `base_url` + `api_key_encrypted`
  - crypto util：`MASTER_ENCRYPTION_KEY`（env）解密，密钥/明文只在内存，不进日志
  - → 验证：单测 加密↔解密 round-trip 通过；seed/自测 provider 能解析出 base_url + 明文 key（日志不含明文）
- [ ] **3. 非流式代理转发（happy path，先不鉴权不限流）**
  - 原始 body **整体透传**上游 `{base_url}/v1/chat/completions`，响应原样回传；只注入 Authorization
  - → 验证：对 mock 上游，非流式响应与直连一致（状态码/体一致）
- [ ] **4. SSE 流式透传（核心难点）**
  - `stream=true`：边收边转 SSE chunk，**首 chunk 不被缓冲**、不阻塞；正确透传 `[DONE]`
  - → 验证：流式响应与直连一致；首 token 能即时到达客户端（非整体缓冲后吐出）
- [ ] **5. 客户端断开 → 取消上游**
  - 检测客户端断连，`abort` 上游请求；（trace 标记 `cancelled` 留 Stage 2）
  - → 验证：客户端中途断开后，上游连接被取消（mock 上游观测到 abort）
- [ ] **6. API Key 校验（内存 TTL 缓存 + miss 读 PG）**
  - 取 `Authorization: Bearer`，按 `key_hash` 查 `ApiKey`，校验 `scope` 含 `gateway`、`status`/`expires_at`/`revoked_at`
  - 内存 TTL 缓存，miss 再读 PG；撤销后随 TTL 失效
  - → 验证：有效 key 放行；无效 / 撤销 / 无 `gateway` scope → `invalid_api_key` / `revoked_api_key`（401，OpenAI-compatible）
- [ ] **7. OpenAI-compatible 错误响应统一（§3.4）**
  - 统一错误信封 `{error:{type,code,message}}`；对内 `error_code` 分类，对外不泄露上游原始细节
  - 覆盖：鉴权 / 上游（`upstream_timeout`/`upstream_error`/`provider_*`）/ 流式（`stream_interrupted`/`stream_timeout`/`client_cancelled`）
  - → 验证：各类故障（mock 制造）返回规范结构与正确 code；客户端看不到上游内部报错
- [ ] **8. 内存 fixed-window RPM 限流（trait 抽象，决策 9）**
  - 限流器抽象成 trait；内存实现按分钟窗口对 `api_key_id` 计数，超 `rpm_limit` 拒
  - → 验证：超 `rpm_limit` 返回 `rate_limit_error` / code `rate_limited`；跨分钟窗口重置
- [ ] **9. 内存并发限流 + 流式占用（trait 抽象，决策 9）**
  - 内存计数器：请求始 +1、结束/失败/断开 -1，用 RAII guard 确保释放防泄漏
  - 流式请求占用并发直到 `stream_end`/`stream_error`/`cancelled`
  - → 验证：超 `concurrency_limit` → `concurrency_limited`；长流式正确占用与释放；异常路径不漏计数
- [ ] **10. 首 chunk 前 fallback（SSE fallback 边界）**
  - 按 `ModelConfig.fallback_model_id` 链，**首 chunk 前**失败（连接/鉴权/超时）切下一个；**首 chunk 后不切**
  - → 验证：首 chunk 前上游失败→切备用成功；首 chunk 后失败只记 `stream_error`/`stream_timeout`，不切
- [ ] **11. `/metrics`（Prometheus，§2.5）**
  - 暴露 `request_total`、`request_duration_ms`、`first_token_latency_ms`、`inflight_requests`、`rate_limited_total`、`upstream_error_total`、`stream_error_total`（`trace_queue_depth`/`trace_write_failed_total` 留 Stage 2）
  - → 验证：`curl /metrics` 返回 Prometheus 文本格式，发请求后计数变化
- [ ] **12. `/readyz` 补配置检查（§2.5；无 Redis，决策 9）**
  - 现仅探 PG，扩展为校验关键配置（`MASTER_ENCRYPTION_KEY` 等）存在；本阶段无 Redis 需探
  - → 验证：缺关键配置时 `/readyz` 返 503

## 范围边界（Stage 1 不做）

- 不做 Trace 落库（TraceRun/Span 持久化）→ Stage 2
- 不解析 / 不特别支持 `tools`、`response_format`、multimodal、`/v1/responses`、embeddings、batch（请求体仍原样透传）
- 不做 sliding window / token bucket（先 fixed window）
- 不做 Gemini / Claude native adapter（仅 OpenAI-compatible）
- Console 侧不动（鉴权只认 project API Key，不走 NextAuth）

## 风险

- **SSE 流式是真难点**：tokio stream + 背压 + 不破坏流地边转边记；步骤 4/5/10 预留学习时间。
- **并发计数泄漏**：内存计数器在异常 / 断开路径上必须用 RAII guard 确保释放（崩溃则随进程重置）。
- **验收依赖测试上游**：mock 上游要能造「首 chunk 前失败 / 首 chunk 后中断 / 超时 / 流式 usage chunk」等场景。

## Review（实施后补）

_待实施完成后在此记录实际结果与偏差。_
