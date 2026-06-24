# TraceForge · 工程 PRD

> 面向 AI 应用开发者的企业级 **AI 网关 + Agent 可观测平台**。
> 一句话：让 AI 应用从「能跑」变成「可观测、可评估、可治理、可上线」。

---

## 0. 定位精修（在原 PRD 基础上）

- **核心卖点是「可观测 + 可评估」；网关是数据入口与性能热路径，但不是最终差异化本身**。网关负责零侵入接管 LLM 调用、SSE 透传和基础治理，真正的增量亮点在 Trace 链路可归因、成本归因与 Eval 回归。
- **差异化叙事钩子**：「一次失败的 Agent 调用，3 步定位到根因」——把可观测做到「可归因」，而不只是「可展示」。这是区别于 Langfuse 简化版的关键。
- **接入体验**：OpenAI Compatible，仅改 `baseURL` 即可接管普通 LLM 调用；Agent 多步链路通过 Trace API / SDK 手动上报 tool、workflow、db、review 等 Span。

## 1. 目标用户与痛点

**用户**：AI 应用开发者、全栈工程师、内部 AI 平台维护者、小团队技术负责人。

**痛点**：
1. AI 调用失败后，不知是模型 / Prompt / 工具 / 网络 / 业务逻辑的问题。
2. 多模型接入分散，OpenAI / 第三方 OpenAI-compatible 接口难统一治理。
3. token、成本、失败率、延迟缺少项目维度统计。
4. Prompt 修改后效果不可回归，缺版本管理和评测集。
5. Agent 多步执行过程不可见，排查只能翻日志。

## 2. 架构设计（核心）

**数据面 / 控制面分离**——工业界经典模式，也是本项目最强的面试点。

```
                 ┌─────────────────────────────────────────┐
  Client          │            Rust 数据面 (Data Plane)        │      上游 LLM
 (改 baseURL) ───▶ │  TraceForge Gateway                       │ ───▶ OpenAI
                  │  · OpenAI Compatible 入口                  │      OpenAI
                  │  · 代理转发 + SSE 流式透传                  │      兼容接口
                  │  · token/耗时统计 · Key 校验 · 限流         │
                  └───────────────┬─────────────────────────┘
                                  │ 有界 channel + async worker（观测写入不阻塞主转发）
                                  ▼
                          ┌───────────────┐
                          │  PostgreSQL    │  ← Prisma schema 作为单一事实源 / 数据契约
                          └───────┬───────┘
                                  │ 读 / 管理
                  ┌───────────────▼─────────────────────────┐
                  │           TS 控制面 (Control Plane)        │
                  │  TraceForge Console (Next.js)             │
                  │  · Dashboard · Trace 可视化(瀑布图)        │
                  │  · Prompt 版本 · Eval · 项目/Key 管理      │
                  └───────────────────────────────────────────┘
```

| 层 | 职责 | 技术栈 | 选型理由 |
|----|------|--------|----------|
| **Rust 数据面** | 网关入口、代理转发、SSE 流式透传、token/耗时统计、Trace 写库、Key 校验 + 限流 | Rust + axum + tokio + reqwest + sqlx | 性能热路径，高并发低延迟，Rust 主场 |
| **TS 控制面** | 控制台 UI、Dashboard、Trace 可视化、Prompt 版本、Eval、业务 API | Next.js + React + Prisma + Tailwind | 迭代密集，生产力优先 |
| **共享存储** | 单一事实源 + 数据契约 | PostgreSQL（Prisma 定义 schema，Rust 用 sqlx 按表读写） | 改表两边同步，是混合架构的主要协调成本 |

### 2.1 接入边界

- **网关自动 Trace**：仅改 `baseURL` 的接入方式，默认只能自动记录 `TraceRun -> LLM Span`，适合普通模型调用。
- **SDK / Trace API 手动上报**：Agent 内部的工具调用、工作流节点、数据库写入、人工审核等业务步骤，必须由业务系统主动上报 Span，网关不能自动推断。
- **示例 Agent 验证路径**：内置示例写作 Agent 的“选题 -> 抓取资料 -> 成文 -> 审稿 -> 保存草稿”链路使用 SDK 上报多步 Span，用来证明 TraceForge 能观测真实多步 Agent 流程，而不是只展示单次模型调用。

### 2.2 Trace API / SDK 协议边界

MVP 先提供 HTTP Trace API，Node SDK 只做薄封装，避免为了 SDK 设计拖慢主线。

- `POST /api/traces/start`：创建一次 TraceRun。
- `POST /api/traces/{run_id}/spans`：创建 Span，支持 `parent_id` 形成嵌套链路。
- `PATCH /api/traces/{run_id}/spans/{span_id}`：更新 Span 状态、输出、耗时与错误。
- `POST /api/traces/{run_id}/end`：结束 TraceRun，汇总状态、耗时、token 与成本。
- Span 上报字段包括：`parent_id`、`type`、`name`、`status`、`input_preview`、`output_preview`、`started_at`、`ended_at`、`error_code`、`error`。
- SDK / Trace API 上报失败不能影响业务主流程，只记录本地错误或降级日志。
- MVP 不做 OpenTelemetry 全量兼容，仅保留 Trace / Span 字段未来映射空间。
- **托管与写入单源化**：`/api/traces/*` 由 Rust 数据面托管并鉴权（project API Key）；网关自动 Span 与 SDK 手动 Span 复用同一条「有界 channel + async worker」写入管线和同一套脱敏 / 截断 / 成本逻辑，避免观测写入在 Rust 与 TS 双实现。Next.js 控制面只读 Trace。

### 2.3 Provider 支持边界

MVP 只支持 OpenAI-compatible Provider，统一走文本版 `/v1/chat/completions`。

- 支持 OpenAI 官方接口。
- 支持任何兼容 `/v1/chat/completions` 的第三方模型服务。
- Gemini 只有在走 OpenAI-compatible endpoint 时进入 MVP。
- 暂不做 Gemini native API adapter、Claude native Messages API adapter。
- **请求体原样透传**：网关把客户端请求体整体转发给上游（保证零侵入、调用效果与直连一致），只解析 `model`（路由）、`stream`（响应处理）、`messages`（估算 / preview）；其余字段（含各 provider 私有参数）透传不丢，不做白名单过滤。
- **fallback 配置**：每个对外 model 可配置有序 fallback 目标（`ModelConfig.fallback_model_id` 或 provider 优先级）；网关在首 chunk 前按链尝试下一个，首 chunk 后不切。
- 后续如扩展 native provider，再抽象 Provider Adapter 层，把私有请求 / 响应 / usage 映射为 TraceForge 内部统一结构。

### 2.4 Console 认证边界

MVP 控制台使用单管理员模式，保护 Console 页面和控制面管理 API；Gateway 热路径不走 Console 登录态，只认项目 API Key。

- Console 登录使用 NextAuth Credentials。
- 管理员凭证通过环境变量配置：`ADMIN_EMAIL`、`ADMIN_PASSWORD_HASH`。
- Console 页面、项目管理、API Key 管理、Provider Key 管理、Prompt / Eval 管理 API 都必须校验登录态。
- `POST /v1/chat/completions` 不走 NextAuth，只校验项目 API Key、限流与 provider 配置。
- `/api/traces/*`（trace 上报）与 `/v1/chat/completions` 同属数据面，只认 project API Key，不走 NextAuth；不要把它当成需要登录态的控制面 API。
- 暂不做多用户团队、RBAC 权限矩阵、SSO / GitHub OAuth、公开注册。
- 如需要公网展示，后续可增加 read-only demo mode，避免暴露真实管理权限。

### 2.5 Gateway 健康检查与运行指标

Rust Gateway 必须暴露基础运行健康信号，支撑 Docker 部署、线上排障和“生产级网关”叙事。

- `GET /healthz`：只表示进程存活，不检查 PostgreSQL / Redis。
- `GET /readyz`：检查 PostgreSQL 连接、Redis 连接和关键配置是否存在。
- `GET /metrics`：返回 Prometheus 文本格式运行指标。
- 核心指标包括：`request_total`、`request_duration_ms`、`first_token_latency_ms`、`inflight_requests`、`rate_limited_total`、`upstream_error_total`、`stream_error_total`、`trace_queue_depth`、`trace_write_failed_total`。
- Docker healthcheck 使用 `/readyz`。
- MVP 不做完整告警系统，只把指标作为部署、容量观察和排障依据。

### 2.6 根因定位：3 步路径（差异化卖点的落地定义）

「一次失败的 Agent 调用，3 步定位根因」不是口号，对应固定的查询路径与数据支撑：

1. **筛失败**：Trace 列表按 `status=failed` + `error_code` 过滤，定位到出问题的 TraceRun。
2. **看链路**：进 Trace 详情瀑布图，系统高亮 critical path 并标红失败 / 最慢 / 最贵的 Span，直接锁定可疑步骤。
3. **定责任域**：展开该 Span，结合 `Span.type`（llm/tool/workflow/db/review）、标准化 `error_code` 分类、脱敏错误摘要、input/output preview 与关联 TraceEvent（如 `stream_error` / `fallback_triggered`），把失败归因到 模型 / Prompt / 工具 / 网络 / 限流 / 业务 之一。

归因能力来自两条设计：`error_code` 的分类维度（见 §3.4）给出「失败类型」，`Span.type` + 父子层级给出「失败位置」，二者交叉即根因责任域。这是区别于「只展示 trace」的关键。

> ⚠️ **已修订（见 §9.2）**：责任域收敛为 5 个 + 「网关拒绝」、**砍掉 Prompt**，并给出 `(span.type × error_code) → 责任域` 映射表；第 2 步**去掉 critical path**，只做失败 / 最慢 / 最贵的扁平染色。

## 3. 核心数据模型

| 实体 | 关键字段 | 说明 |
|------|---------|------|
| `Project` | id, name | 隔离单位 |
| `ApiKey` | id, project_id, key_hash, scope, rpm_limit, concurrency_limit, revoked_at | 作用域化 Key（`scope` ∈ {`gateway` 调模型 / `trace_ingest` 上报 trace}，可组合）；热路径通过 Redis / 内存 TTL 缓存，支持撤销后快速失效 |
| `TraceRun` | id, project_id, name, prompt_version_id, status, error_code, total_tokens, cost, latency_ms, started_at, ended_at | 一次完整调用 / Agent 运行（root）；`prompt_version_id` 可空，记录本次用的 Prompt 版本；网关自动调用 `name` 默认取 model / endpoint，SDK 调用由业务命名 |
| `TraceSpan` | id, run_id, parent_id, type(llm/tool/workflow/db/review), name, model, provider, input_preview, output_preview, raw_payload_ref, prompt_tokens, completion_tokens, usage_source, cost, latency_ms, status, error_code, error, started_at, ended_at | 运行内步骤；`parent_id` 还原 Agent 链路；`provider` + `model` 用于按 ModelPricing 精确核价；默认只存脱敏截断后的 preview，raw 可配置关闭或单独表存储 |
| `TraceEvent` | id, span_id, type, payload, created_at | 记录 stream_start、first_token、chunk_count、stream_end、fallback 等细粒度事件 |
| `ModelPricing` | provider, model, input_price, output_price, effective_from | 成本核算定价表，支持 provider / model / 时间版本 |
| `PromptVersion` | id, prompt_id, version, content, created_at | Prompt 版本快照 |
| `EvalCase` / `EvalRun` / `EvalResult` | case: input + expected_output + assertion_type + assertion_config + tags；run: prompt_version_id；result: pass/score/judge_reason | 评测集 / 跑批 / 结果 |

> 本表只列契约关键实体；`ModelProvider`、`ModelConfig`、`Prompt`、`EvalDataset`、`UsageDaily` 等完整字段以[完整版 PRD](TraceForge_AI网关与Agent可观测平台_PRD.md) 「核心数据表」章节为准（已按本精修层口径对齐：`run_id` / `parent_id` / `span_id` / `latency_ms` / `cost` / `rpm_limit`）。
>
> **可直接生成迁移的 Prisma schema 草稿见 [`prisma/schema.prisma`](prisma/schema.prisma)**（15 model + 6 enum，列名 snake_case 对齐 sqlx；落地前跑 `npx prisma format && npx prisma validate`）。

### 3.1 观测数据安全策略

- 默认对 request / response 做敏感字段脱敏：`authorization`、`api_key`、`password`、`token`、`cookie` 等字段必须 mask。
- `input_preview` / `output_preview` 设置最大长度，超长内容截断并记录 `truncated = true`。
- raw payload 默认不直接入库；如需调试，可通过项目级开关写入单独的 raw 表（MVP 优先，不引入对象存储），并设置过期时间。
- Trace 详情页明确标记数据来源：`provider` 表示上游返回真实 usage，`estimated` 表示本地 tokenizer / 估算得到。

### 3.2 Provider API Key 安全策略

- Provider API Key 入库前必须使用 AES-256-GCM 加密。
- master encryption key 只从环境变量读取，不入库，不进日志。
- 控制台只允许创建 / 替换 Provider API Key，不允许明文回显。
- 保存后只显示尾号，例如 `sk-****abcd`。
- 网关运行时解密后只放在内存中用于转发，不写入日志、Trace 或错误信息。
- 日志和 Trace 脱敏规则必须覆盖 Provider API Key。
- key rotation 第一版只支持手动替换，不做自动轮换。

### 3.3 限流策略

> ⚠️ **已修订（见 §9.3 决策 9）**：MVP 用**进程内存**实现限流（限流器抽象成 trait），**不用 Redis**；下文 Redis 方案作为后续增强的目标形态保留。

- RPM 限流使用 Redis fixed window：`rate:{api_key_id}:{yyyyMMddHHmm}`，每次请求 `INCR`，首次创建设置 60 秒 TTL，超过 `rpm_limit` 返回 `rate_limited`。
- 并发限流使用 Redis counter：`concurrent:{api_key_id}`，请求开始时 `INCR`，请求结束 / 失败 / 客户端断开时 `DECR`；给该 key 设较短 TTL（如 60 秒）并在请求 / 流式活跃期定期心跳续期，进程崩溃后计数在约一个 TTL 内自愈、长流也不会被误判释放，避免计数泄漏永久占满并发额度。
- 流式请求占用并发直到 `stream_end` / `stream_error` / `cancelled`，避免长连接绕过并发控制。
- 超限返回 OpenAI-compatible error：`type = rate_limit_error`，`code = rate_limited`。
- Stage 1 不做 sliding window，先用 Redis 保证多实例下的计数一致性。

### 3.4 错误分类策略

对客户端返回 OpenAI-compatible error，对 Trace 内部记录标准化 `error_code` 和脱敏后的错误摘要。客户端不暴露上游 provider 原始报错细节，Trace 详情页保留定位所需的 root cause。

| 分类 | error_code | 记录口径 |
|------|------------|----------|
| 鉴权 | `invalid_api_key`、`revoked_api_key` | 请求拒绝，写入 TraceRun 失败状态；不创建上游 LLM Span |
| 限流 / 并发 | `rate_limited`、`concurrency_limited` | 返回 `rate_limit_error`；TraceEvent 记录命中的 Key 与限制类型 |
| 上游模型 | `upstream_timeout`、`upstream_error`、`provider_rate_limited`、`provider_auth_failed` | TraceSpan 标记失败，保存脱敏后的 provider 错误摘要 |
| 流式请求 | `stream_interrupted`、`stream_timeout`、`client_cancelled` | 首 chunk 后只记录错误或取消，不做 provider 切换 |
| fallback | `fallback_triggered`、`fallback_failed` | `fallback_triggered` 作为 TraceEvent；全部 fallback 失败时最终错误为 `fallback_failed` |
| 观测写入 | `trace_write_failed` | 只进内部日志 / dead-letter，不影响客户端调用 |

> `quota_exceeded`（配额 / 预算超限）依赖尚未纳入 MVP 的 quota 模型，留待 quota 功能落地后再启用，当前错误码集合不含它。

流式相关口径统一（消除 status / error_code / event / metric 命名漂移）：

| 场景 | TraceSpan status | error_code | TraceEvent | metric |
|------|------------------|------------|------------|--------|
| 首 chunk 后上游中断 | failed | `stream_interrupted` | `stream_error` | `stream_error_total` |
| 首 chunk 后超时 | failed | `stream_timeout` | `stream_error` | `stream_error_total` |
| 客户端主动断开 | cancelled | `client_cancelled` | `stream_cancelled` | — |
| fallback 触发 / 全失败 | failed（全失败时） | `fallback_failed`（全失败时） | `fallback_triggered` / `fallback_failed` | — |

### 3.5 Trace 数据保留策略

- `TraceRun` / `TraceSpan` 的 preview 数据默认保留 30 天。
- `TraceEvent` 默认保留 30 天。
- raw payload 默认关闭；项目级开启后只保留 7 天。
- `UsageDaily` 聚合数据长期保留，用于成本趋势和容量分析。
- `EvalDataset`、`EvalCase`、`PromptVersion` 长期保留。
- MVP 使用每日定时任务清理过期 trace，不引入 PostgreSQL 分区表。
- 优先索引：`TraceRun(project_id, started_at)`、`TraceRun(status, started_at)`、`TraceSpan(run_id)`、`UsageDaily(project_id, date)`。

### 3.6 Eval 断言策略

Eval 用于验证 Prompt / 模型配置变更是否带来回归。MVP 每条 `EvalCase` 至少包含 `input`、`expected_output`、`assertion_type`、`assertion_config`、`tags`。

| assertion_type | 适用场景 | 判断方式 |
|----------------|----------|----------|
| `exact_match` | 固定输出、分类标签 | 输出与期望值完全一致 |
| `contains` | 关键词、必备要点 | 输出包含指定文本或要点 |
| `regex` | 结构化文本、格式要求 | 输出匹配正则表达式 |
| `json_schema` | JSON 输出、结构化抽取 | 输出可解析且符合 JSON Schema |
| `llm_judge` | 开放式回答质量 | 由 judge prompt 评分并保存 `judge_reason` |
| `manual_review` | 自动评测无法覆盖的样本 | 人工标记 pass / fail / score |

MVP 暂不做 embedding similarity / 多轮对话评测，避免引入向量模型、上下文回放和不稳定评测变量。

## 4. 分阶段交付（每阶段可验证）

**Stage 0 · 骨架**（约 2 天）
Docker Compose 跑通 Rust gateway + Next console + PostgreSQL 三件套空架子。
→ 验收：三个容器起得来，控制台能连库。

**Stage 1 · Rust 网关 MVP**（约 1 周，核心难点）
`/v1/chat/completions` 代理转发到上游；**SSE 流式透传**（边转发边不阻塞）；非流式也支持；API Key 校验使用 Redis / 内存 TTL 缓存，缓存 miss 再读 PG；按 Key 执行 Redis fixed-window RPM 限流和 Redis counter 并发限流；暴露 `/healthz`、`/readyz`、`/metrics`。
→ 验收：客户端改 `baseURL` 指向网关，调用效果（含流式）与直连一致；超过 `rpm_limit` / `concurrency_limit` 的请求被拒并返回 OpenAI-compatible `rate_limit_error`；Docker healthcheck 可通过 `/readyz` 判断服务是否可接流量。

**MVP 兼容边界**：Stage 1 只支持文本版 `/v1/chat/completions` 子集，包括 `messages`、`model`、`stream`、`temperature`、`max_tokens`、`top_p`、`stop` 和普通文本输出；暂不支持 `tools/tool_calls`、`response_format/JSON mode`、multimodal image/audio input、`/v1/responses`、embeddings 和 batch。这里的“暂不支持”指 TraceForge 不为它们做特别解析 / 可视化 / 测试，请求体仍原样透传上游（零侵入）；唯独 `/v1/responses`、embeddings、batch 属不同 endpoint，不在本网关 `/v1/chat/completions` 路由内。

**SSE fallback 边界**：流式请求只允许在首个 chunk 返回客户端之前 fallback。上游连接失败、鉴权失败、首 chunk 前超时可以切换备用 provider；首 chunk 后失败不再 fallback，只记录 `stream_error` / `stream_timeout`；客户端主动断开时取消上游请求，TraceSpan 标记为 `cancelled`。

**Stage 2 · Trace 采集与建模**（约 1 周）
每次请求生成 `TraceRun + TraceSpan`，经**有界 channel + async worker** 异步写库，不阻塞主转发；记录 model / input_preview / output_preview / usage / usage_source / 耗时 / 状态 / `error_code` / 错误摘要；嵌套 Span 预留（MVP 可先单层）。流式请求对上游注入 `stream_options.include_usage=true` 以拿到 provider 真实 usage（消费末尾 usage chunk，不强制透传客户端），拿不到才回退本地估算。DB 慢或写入失败时进入 retry / dead-letter 记录，观测失败不影响主调用。
→ 验收：一次调用在 PG 有完整 trace；流式请求能精确记录首 token 延迟、总耗时、chunk 数和最终输出；token 优先使用 provider final usage，不返回 usage 时用估算值并标记 `usage_source=estimated`。

**Stage 2.5 · Trace SDK / 手动 Span 上报**（约 3 天）
提供 HTTP Trace API / Node SDK 薄封装，让业务系统主动创建 tool / workflow / db / review Span；支持 start / create span / update span / end 四类接口，SDK 上报失败不影响业务主流程；内置示例写作 Agent 接入 SDK 后，一次 AI 写作任务能落库为多步 Trace。
→ 验收：仅改 baseURL 的调用生成单层 LLM Span；示例写作 Agent 通过 SDK 上报多层 Agent Span，父子关系可查询；故意关闭 Trace API 时，业务写作流程仍能完成。

**Stage 3 · Console + Trace 可视化**（约 1 周）
Next.js 控制台：NextAuth Credentials 单管理员登录、项目/Key 管理、Trace 列表、Trace 详情；详情页 **Span 瀑布图/火焰图**。
→ 验收：未登录无法访问 Console 和管理 API；登录后点开一条 trace 看到完整链路与耗时分布；失败请求能看到标准化 `error_code`、错误摘要和关联 Span，并定位根因（呼应「3 步定位根因」）。

**Stage 4 · 成本 Dashboard + 治理可视化**（约 4 天）
项目维度 token / 成本(按 ModelPricing) / 失败率 / P95 延迟 / 调用量趋势；把 Stage 1 已实现的 RPM/并发限流与 fallback 事件落入 Trace 与 Dashboard（`rate_limited`、并发占用、`fallback_triggered` 等），便于按项目 / Key 复盘。
→ 验收：Dashboard 数据与实际调用对得上；限流 / fallback 事件在 Trace 与看板可见。

**Stage 5 · Prompt 版本管理**（约 4 天）
Prompt 实体 + 版本快照；版本 diff 视图；调用时关联 prompt 版本——网关调用通过 `X-TraceForge-Prompt-Version` header 声明、SDK 调用通过字段传入（网关无法自行推断），写入 `TraceRun.prompt_version_id`。
→ 验收：改 Prompt 产生新版本，可 diff、可回滚，trace 能追溯版本。

**Stage 6 · Eval 回归评测 + 上线**（约 1 周）
评测集(EvalCase：输入 + 期望输出 + 断言类型)；支持 `exact_match` / `contains` / `regex` / `json_schema` / `llm_judge` / `manual_review`；对某 Prompt 版本跑批产出 EvalResult；版本对比报告（改前/改后回归）；Docker + Nginx + GitHub Actions 部署，公网可访问。
→ 验收：改 Prompt → 跑 eval → 看到通过率、平均分、失败样本、judge_reason 和回归对比；线上可访问。

> **节奏**：Stage 0–4 是「能写进简历的核心闭环」(约 4–5 周)；Stage 5–6 把它做成生产级主力项目，凑满 1–2 个月。

## 5. 避坑与差异化

- **坑 1 · 网关复刻** → 网关是入口与热路径，差异化放在 Trace 归因 + Eval 回归 + 成本治理。
- **坑 2 · Langfuse 简化版** → 立「3 步定位根因」钩子，做到可归因。
- **坑 3 · 零侵入过度承诺** → baseURL 零侵入只承诺普通 LLM 调用；Agent 多步链路通过 SDK / Trace API 上报。
- **坑 4 · Trace 泄露敏感信息** → 默认脱敏、截断和 raw payload 开关，正式环境不无脑保存完整请求体。
- **明确「我自研了什么」**（面试必答）：Rust 流式代理 + Trace 异步采集、TraceRun/Span 嵌套建模、多模型成本核算、Eval 回归框架。

## 6. 面试弹药（技术难点 = 加分点）

1. SSE 流式代理时如何**边转发边记录首 token / chunk / 耗时而不破坏流**，以及 provider usage 与本地估算 token 的取舍。
2. 为什么网关用 Rust：tokio 异步 + 数据面/控制面分离的架构选型理由。
3. TraceRun/TraceSpan 嵌套建模 + **写入不阻塞主路径**（有界 channel / 异步 worker / retry / dead-letter）。
4. 多模型成本核算（定价表 + token 计费）。
5. Eval 设计：断言机制、回归对比。
6. Gateway 健康信号：`/healthz`、`/readyz`、`/metrics` 如何区分存活、就绪和运行指标。

## 7. 风险与取舍

- **Rust 流式是真难点**：tokio stream + SSE 转发 + 背压，对当前 Rust 水平有挑战，Stage 1 预留学习时间。
- **混合架构协调成本**：PG schema 改动要 Prisma 与 Rust sqlx 两边同步；Prisma 负责 migration，Rust 使用 sqlx offline prepare / 编译期校验，CI 同时跑 Prisma migrate 与 sqlx check。
- **范围控制**：Agent 多步嵌套 trace 不靠网关自动推断，MVP 先做 LLM Span 自动采集，再通过 SDK / Trace API 扩展多步链路。
- **Trace SDK 边界**：Node SDK 只是 HTTP Trace API 的薄封装，MVP 不做 OpenTelemetry 全量兼容，也不让观测上报失败影响业务主流程。
- **错误分类边界**：对外错误保持 OpenAI-compatible，避免泄露 provider 原始细节；对内必须用 `error_code` 分类，否则 Trace 详情页无法稳定聚合和排障。
- **Eval 范围边界**：MVP 只做 deterministic assertion、JSON Schema、LLM judge 和人工复核；embedding similarity / 多轮对话评测后置，避免 Eval 先变成另一个大项目。
- **OpenAI Compatible 边界**：MVP 不追求完整 OpenAI API parity，只做文本版 `/v1/chat/completions` 子集，避免 tools、multimodal、responses API 把 Stage 1 拖成兼容性黑洞。
- **Provider 支持边界**：MVP 只支持 OpenAI-compatible Provider；Gemini / Claude native adapter 后置，避免 Stage 1 被各家私有协议和特殊参数拖散。
- **Console 认证边界**：Console 登录只保护控制面；Gateway `/v1/chat/completions` 只认项目 API Key，避免把管理后台登录态和模型调用鉴权混在一起。
- **Gateway 健康信号边界**：`/healthz` 只代表进程存活，不能当成依赖就绪；Docker healthcheck 使用 `/readyz`，运行指标通过 `/metrics` 暴露。
- **SSE fallback 边界**：fallback 不能牺牲流式响应语义完整性；首 chunk 后不切 provider，只记录 stream error / timeout / cancelled。
- **观测写入可靠性**：异步写库必须使用有界队列，避免 DB 慢时内存无限增长；队列满时按策略降级或丢弃低优先级观测事件。
- **隐私与合规**：Trace 默认不保存完整敏感 payload，必须支持脱敏、截断、raw 存储开关和过期策略。
- **Provider API Key 安全**：上游 provider key 必须加密存储、永不明文回显、运行时只在内存解密；第一版只做手动替换，不做自动轮换。
- **Trace 数据膨胀**：MVP 通过 30 天 trace preview / event 保留、7 天 raw payload 保留、UsageDaily 长期聚合和每日清理任务控制数据库增长。
- **限流算法取舍**：MVP 使用 Redis fixed window，边界分钟可能存在短时突刺；该取舍换来实现简单和多实例一致性，sliding window / token bucket 放到后续优化。

## 8. 目标简历描述（北极星，做完据实微调）

```
### TraceForge · AI 网关与 Agent 可观测平台
`Rust` `axum/tokio` `Next.js` `TypeScript` `Prisma` `PostgreSQL` `SSE` `Docker`

- 数据面/控制面分离架构：Rust(axum + tokio)实现高并发网关数据面，
  Next.js 实现控制台，共享 PostgreSQL、Prisma schema 作数据契约
- Rust 网关 OpenAI-compatible provider 入口 + SSE 流式透传，边转发边采集
  首 token 延迟/耗时/错误；token 优先取 provider usage，缺失时估算并标记来源
- TraceRun/TraceSpan 嵌套建模还原 Agent 执行链路，瀑布图可视化，
  普通 LLM 调用零侵入接入，Agent 多步链路通过 Trace SDK 上报，从失败调用 3 步定位根因
- 项目维度成本/延迟/失败率 Dashboard；Prompt 版本管理 + Eval 回归评测
- Docker + Nginx + GitHub Actions 自建服务器部署，公网持续可访问
```

## 9. 决策修订（grill 确认）

> 本节是对前文的**修订层**（关系同 §0 对全量 PRD 的精修）。**与前文冲突处，以本节为准。**
> 总立场：**作品集 / 面试优先**——把两块做深、其余诚实最小实现。

### 9.1 立场与重点

- **决策 1 · 作品集 / 面试优先**：两块做到生产级深度，其余功能跑通即可、边缘场景明确标注「已知简化」。解释了为什么 schema 是生产级口径、但部分边缘会被有意从简。
- **决策 2 · 要做深的两块**：① **Rust SSE 流式代理 + 不阻塞采集**；② **TraceRun/Span 嵌套建模 + 失败归因**。成本核算 / Eval / Prompt 版本走诚实最小实现。

### 9.2 Trace 建模与归因（影响 §2.6、§3）

- **决策 3 · Run/Span/Event 边界**：一次普通网关调用 = **1 个 TraceRun + 1 个 llm TraceSpan**；Span 是**逻辑步骤**而非物理 attempt。fallback **不新建 Span**，只在该 Span 上记一条 `fallback_triggered` 的 TraceEvent，Span 最终 `model/provider` 记成功的那个。术语见 [`CONTEXT.md`](CONTEXT.md)。
- **决策 4 · 责任域收敛为 5 个 + 网关拒绝（修订 §2.6）**：失败责任域 = `模型 / 网络 / 限流 / 工具 / 业务`，外加「网关拒绝（请求未达模型）」。**砍掉「Prompt」**——Prompt 质量问题表现为输出差、不抛错，属 Eval 时段而非失败归因。责任域由下表 `(span.type × error_code)` 派生：

  | span.type / 场景 | error_code | 责任域 |
  |---|---|---|
  | llm | `upstream_error` / `provider_rate_limited` / `provider_auth_failed` / `fallback_failed` | 模型 |
  | llm | `upstream_timeout` / `stream_interrupted` / `stream_timeout` | 网络 |
  | 网关层（任意 span 前） | `rate_limited` / `concurrency_limited` | 限流 |
  | 网关鉴权 | `invalid_api_key` / `revoked_api_key` | 网关拒绝 |
  | tool | tool span 失败 | 工具 |
  | workflow / db / review | 对应 span 失败 / `client_cancelled` | 业务 |

- **决策 5 · 砍掉 critical path（修订 §2.6 第 2 步）**：瀑布图第 2 步只做**扁平染色**——失败（红）/ 最慢（单 Span max latency）/ 最贵（单 Span max cost），均 O(n) 取极值，不做树路径算法。critical path 延迟瓶颈分析 → 后续增强（§9.5）。

### 9.3 架构与数据面（影响 §2.1–2.2、§3.2–3.3）

- **决策 6 · Rust 写所有 Trace，Next.js 对 Trace 只读**：网关自动 Span 与 SDK 上报 Span 走**同一条写库管线、同一套脱敏 / 截断 / 成本逻辑**；`/api/traces/*` 由 Rust 托管。Next.js 只写控制类实体（Project / Key / Provider / Prompt / Eval），**不写 Trace**。避免双实现漂移。
- **决策 7 · 采集尽力而为、绝不阻塞主路径**：有界 channel，主路径 `try_send`；**队列满 → 整条丢弃 + 计数**（不做按事件优先级分级丢弃）；**worker 写库失败 → 重试 N 次 → dead-letter**（MVP 用日志 / 一张简单表，不引消息队列），计 `trace_write_failed_total`。转发请求**永不**因 Trace 写入而回压。
- **决策 9 · 限流用内存实现 + trait，Redis 降为可选增强（修订 §3.3）**：单实例 demo 下 RPM / 并发 / Key 缓存用**进程内存**即可，算法与 Redis 版一致，只是不跨实例。限流器抽象成 trait，Redis 实现留作后续增强。**偏离 PRD 原「用 Redis」**，理由：限流不在要做深的两块内，且本机无 Docker。
- **决策 11 · Provider key：TS 加密 / Rust 解密**：AES-256-GCM，`MASTER_ENCRYPTION_KEY`（32B，env），存储格式 `base64( nonce(12B) ‖ ciphertext ‖ tag(16B) )`。**加密在 TS 控制面（创建 / 替换 key 时），解密在 Rust 数据面（调用时）**，两边对齐同一方案。Stage 1 控制台未就绪，先用一个 TS 脚本把 key 加密灌库当测试数据。

### 9.4 流式 token 与测试上游（影响 §2.2、Stage 1–2）

- **决策 8 · 流式 token：注入 + 按需剥离**：转发上游时注入 `stream_options.include_usage=true` 拿真实用量；**若客户端自己没要 usage，则把这个 usage chunk 从转发给客户端的流里剥掉**（保证「与直连一致」）；拿不到 provider usage 才用本地 `tiktoken-rs` 估算并标 `usage_source=estimated`。非 OpenAI 的 compatible provider 估算**不保证精确**，老实标 `estimated`。
- **决策 10 · 测试上游**：真实上游用 **DeepSeek**（OpenAI 兼容）；另**自写一个 mock OpenAI-compatible 上游**放仓库，用来造首 chunk 前失败 / 流中途断 / 超时 / usage chunk 等真实 API 造不出的异常，跑确定性验证。

### 9.5 后续增强 backlog（明确推迟，非 MVP）

- **critical path 延迟瓶颈分析**（决策 5 推迟）：在 Span 树上算决定总耗时的根→叶链路。
- **Trace 队列分级丢弃**（决策 7 推迟）：队列满时按事件优先级丢弃（先丢 chunk_count 等低价值 Event，保 Run 级 + 错误 Span）。
- **Redis 分布式限流**（决策 9 推迟）：补 trait 的 Redis 实现，拿到「跨实例一致限流」面试点。
