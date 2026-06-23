# TraceForge PRD

> **文档地位**：本文为完整版 / 详细数据字典与 User Stories 稿。**实现以[工程 PRD（精修层）](TraceForge-工程PRD.md)为准**；若本文与精修层冲突（字段命名、阶段编号、定价口径、错误码集合等），一律以精修层为准。本文已按精修层口径对齐。

## 项目定位

TraceForge 是一个面向 AI 应用开发者的企业级 AI 网关与 Agent 可观测平台，用于统一管理模型调用、追踪 Agent 执行链路、统计 token 成本，并支持 Prompt 版本管理与 Eval 回归评测。

一句话定位：让 AI 应用从“能跑”变成“可观测、可评估、可治理、可上线”。

## 成熟产品对标与差异化定位

TraceForge 所在方向已经存在成熟产品，项目不应包装成“首创方向”，而应定位为参考成熟 LLMOps / AgentOps 产品后，独立实现的轻量级 AI Gateway + Agent Observability 平台。

可参考的成熟产品：

- Langfuse：开源 AI engineering platform，主打 tracing、observability、prompt management、evals、datasets、human annotation 和自托管。
- Helicone：偏 AI Gateway + LLM Observability，主打 OpenAI-compatible gateway、多 provider 接入、routing、fallback 和成本观测。
- LangSmith：LangChain 生态的观测、评测、Prompt 工程和 Agent 调试平台，适合 LangChain / LangGraph Agent 的调试与回归评估。
- Phoenix：Arize 的开源 AI observability / evaluation 平台，强调 tracing、eval，并参考 OpenTelemetry / OpenInference 思路。

TraceForge 的合理定位：

```txt
TraceForge = Mini Helicone + Mini Langfuse
```

核心取舍：

- 从 Helicone 借鉴 AI Gateway、模型路由、fallback、API Key 管理、token 成本统计。
- 从 Langfuse 借鉴 Trace、Prompt 管理、Eval、Dataset、Human Review。
- 从 LangSmith 借鉴 Agent 调试、评测回归、线上质量监控。
- 从 Phoenix 借鉴 Trace / Span 结构、OpenTelemetry / OpenInference 的观测思想。

但 TraceForge 不追求完整复刻上述平台，而是做一个适合个人作品集和简历叙事的生产级最小闭环：

```txt
AI Gateway
+ TraceRun / TraceSpan
+ Token 成本统计
+ Prompt 版本管理
+ Eval 回归评测
```

差异化策略：

- OpenAI Compatible Gateway 优先，贴合内部 AI 平台和成本治理场景。
- TraceRun / TraceSpan 自己实现，证明理解调用链追踪，而不是只会接现成 SDK。
- 成本看板做细，支持按项目 / 模型 / 用户 / 日期统计 token、成本、失败率和延迟。
- 内置一个示例写作 Agent（多步流水线），让 TraceForge 观测真实多步 AI 应用，而不是只跑单次调用 demo。
- 明确接入边界：仅改 `baseURL` 的零侵入方式只能自动观测普通 LLM 调用；Agent 内部的 tool、workflow、db、review 等业务步骤需要通过 Trace API / SDK 手动上报。

简历和面试表达应避免：

```txt
自研业内领先 AI 可观测平台
首创 AgentOps 平台
```

推荐表达：

```txt
参考 Langfuse / Helicone 等成熟 LLMOps 产品，独立实现轻量级 AI Gateway 与 Agent 可观测平台，覆盖模型网关、调用链追踪、token 成本统计、Prompt 版本管理和 Eval 回归评测。
```

项目价值不在商业首创，而在证明自己理解 AI 应用上线后的真实工程问题：多模型接入、调用链追踪、成本归因、fallback、Prompt 回归评测和线上质量治理。

## 目标用户

- AI 应用开发者
- 全栈工程师
- 内部 AI 平台维护者
- 小团队技术负责人
- 需要治理模型调用成本和稳定性的业务团队

## 核心痛点

- AI 调用失败后，不知道问题来自模型、Prompt、工具、网络还是业务逻辑。
- 多模型接入分散，OpenAI 与第三方 OpenAI-compatible API 难以统一治理。
- token、成本、失败率、延迟缺少项目维度统计。
- Prompt 修改后效果不可回归，缺少版本管理和评测集。
- Agent 多步骤执行过程不可见，排查问题只能依赖零散日志。

## 产品目标

MVP 目标是在约 4–5 周内完成一个可部署的 AI Gateway + Trace 平台（对应[工程 PRD（精修层）](TraceForge-工程PRD.md) 的 Stage 0–4 核心闭环）；叠加 Prompt 版本管理与 Eval 回归评测后整体凑满 1–2 个月：

- 统一 OpenAI Compatible 模型调用入口。
- 记录每次 AI 请求的 TraceRun / TraceSpan。
- 展示模型调用、工具调用、耗时、token、错误信息。
- 支持项目级 API Key 和基础限流。
- 提供成本统计 Dashboard。
- 后续扩展 Prompt 版本管理和 Eval 回归评测。

## Problem Statement

AI 应用从 demo 进入真实使用后，开发者会同时面对模型调用不稳定、流式响应难观测、Agent 多步骤链路不可见、token 成本难归因、Prompt 改动无法回归验证等问题。仅靠业务日志很难判断一次失败到底来自模型服务、Prompt、工具调用、网络、限流还是业务逻辑。

TraceForge 要解决的是：让小团队或个人开发者能用一个可部署的轻量级 AI Gateway + Agent Observability 平台，把模型调用入口、Trace 调用链、成本统计、Prompt 版本和 Eval 回归评测串成一条可解释、可排障、可复盘的工程闭环。

## Solution

TraceForge 采用 Rust 数据面 + Next.js 控制面的分离架构。Rust Gateway 负责 OpenAI-compatible `/v1/chat/completions` 热路径，包括 SSE 流式透传、API Key 鉴权、限流、fallback、token / latency 统计和 LLM Span 自动采集；Next.js Console 负责项目管理、Trace 可视化、成本 Dashboard、Prompt 版本、Eval 和控制面认证。

普通 LLM 调用通过改 `baseURL` 自动进入 TraceForge；Agent 内部的 tool / workflow / db / review 等业务步骤通过 Trace API / Node SDK 手动上报 Span。平台默认脱敏和截断观测数据，用 Provider API Key 加密、Trace 保留策略、UsageDaily 聚合和运行指标保障可上线性。

## User Stories

1. As an AI application developer, I want to change only the model `baseURL`, so that existing OpenAI-style calls can be observed without rewriting business code.
2. As an AI application developer, I want streaming responses to pass through unchanged, so that user-facing SSE experience remains the same after adopting TraceForge.
3. As an AI application developer, I want every ordinary LLM call to create a TraceRun and LLM Span, so that I can see latency, token usage, cost, status, and error cause.
4. As an Agent developer, I want to report tool, workflow, db, and review spans manually, so that an Agent run can be reconstructed as a nested Span tree.
5. As an Agent developer, I want Trace SDK failures not to break my business flow, so that observability never becomes a production dependency hazard.
6. As a platform operator, I want project-level API Keys, so that each application can be isolated and revoked independently.
7. As a platform operator, I want API Key hot-path caching, so that gateway requests do not query PostgreSQL on every call.
8. As a platform operator, I want fixed-window RPM limits, so that runaway clients can be controlled with a simple MVP algorithm.
9. As a platform operator, I want concurrent request limits, so that long-running SSE requests cannot exhaust the gateway.
10. As a platform operator, I want rate limit and concurrency limit events in Trace, so that quota failures are explainable.
11. As a platform operator, I want Provider API Keys encrypted at rest, so that upstream credentials are not exposed through database reads.
12. As a platform operator, I want Provider API Keys never shown in plaintext after save, so that console usage does not leak secrets.
13. As a developer debugging production, I want standardized `error_code`, so that failures can be grouped and searched consistently.
14. As a developer debugging production, I want provider errors redacted in client responses but visible as safe summaries in Trace, so that clients are protected while operators can diagnose root causes.
15. As a developer debugging streaming calls, I want first token latency, chunk count, stream end, and stream error events, so that slow or broken streams can be explained.
16. As a developer debugging fallback, I want fallback events recorded before the first SSE chunk, so that provider switch behavior is auditable.
17. As a console user, I want a Trace list with project, model, status, time, and error filters, so that I can quickly find suspicious calls.
18. As a console user, I want a Trace detail page with Span tree and waterfall view, so that I can identify the slowest or failed step.
19. As a console user, I want input and output previews to be truncated and redacted, so that debugging does not casually expose sensitive content.
20. As a technical lead, I want daily usage aggregation, so that token cost trends remain available after raw traces expire.
21. As a technical lead, I want ModelPricing versions, so that historical cost calculations remain explainable when prices change.
22. As a Prompt engineer, I want PromptVersion snapshots and diffs, so that every prompt change is traceable.
23. As a Prompt engineer, I want trace records to link to prompt versions, so that online behavior can be explained by the exact prompt used.
24. As a Prompt engineer, I want Eval Dataset and EvalCase management, so that common regressions can be encoded as reusable test cases.
25. As a Prompt engineer, I want deterministic assertions like exact match, contains, regex, and JSON Schema, so that structured outputs can be checked cheaply.
26. As a Prompt engineer, I want LLM judge and manual review options, so that open-ended outputs can still be evaluated.
27. As a maintainer, I want `/healthz`, `/readyz`, and `/metrics`, so that deployment, readiness, and runtime issues can be diagnosed separately.
28. As a maintainer, I want trace queue depth and write failure metrics, so that observability backpressure is visible before it impacts memory.
29. As a maintainer, I want Docker Compose and Nginx deployment, so that the project can be shown as a real hosted portfolio project.
30. As an interviewer, I want the project to have clear scope boundaries, so that the candidate can explain what was intentionally built and what was intentionally deferred.

## Implementation Decisions

- Build a Rust data plane using axum, tokio, reqwest, and sqlx for the gateway hot path.
- Build a Next.js control plane using React, TypeScript, Prisma, PostgreSQL, and Tailwind for console workflows.
- Use PostgreSQL as the source of truth; Prisma owns schema migration and Rust uses sqlx for checked reads/writes.
- Use Redis / in-memory TTL cache for API Key validation, rate limiting counters, concurrent request counters, and hot-path config cache.
- Support only text `/v1/chat/completions` in MVP, with `messages`, `model`, `stream`, `temperature`, `max_tokens`, `top_p`, `stop`, and plain text output.
- Support only OpenAI-compatible providers in MVP; Gemini and Claude native adapters are future work.
- Preserve SSE by forwarding upstream chunks as they arrive instead of buffering the whole response.
- Permit streaming fallback only before the first chunk is sent to the client.
- Cancel upstream requests when the client disconnects and mark the TraceSpan as `cancelled`.
- Record first token latency, chunk count, total duration, final output preview, and stream error events for SSE calls.
- Prefer provider final usage for token counts; use estimated token counts only when the provider does not return usage and mark `usage_source=estimated`.
- Persist observability through a bounded channel and async worker so trace writes do not block the model response path.
- Send failed trace writes to retry / dead-letter handling and expose write failures through metrics.
- Model Agent observability with TraceRun, TraceSpan, and TraceEvent.
- Use Trace API / Node SDK for manual Span reporting when gateway traffic cannot infer business steps.
- Keep Node SDK as a thin wrapper over HTTP Trace API.
- Encrypt Provider API Keys with AES-256-GCM before storage and load the master encryption key only from environment variables.
- Never return Provider API Keys in plaintext after creation; show only a masked suffix.
- Default to redacted and truncated request / response previews.
- Keep TraceRun / TraceSpan previews and TraceEvent for 30 days; keep optional raw payloads for 7 days; keep UsageDaily aggregates long term.
- Implement RPM limiting with Redis fixed-window counters.
- Implement concurrency limiting with Redis counters held for the full request lifetime, including SSE streams.
- Return OpenAI-compatible error shapes to clients and store internal `error_code` in Trace.
- Use NextAuth Credentials for single-admin Console authentication.
- Keep Console authentication separate from Gateway API Key authentication.
- Expose `/healthz` for process liveness, `/readyz` for dependency readiness, and `/metrics` for Prometheus-style runtime metrics.
- Implement PromptVersion, EvalDataset, EvalCase, EvalRun, and EvalResult as second-stage features after the gateway / trace / dashboard loop works.

## Testing Decisions

- Test external behavior at the highest useful seam: HTTP gateway behavior, Console route protection, Trace API contracts, and persisted database state.
- Gateway compatibility tests should call `/v1/chat/completions` with non-streaming and streaming requests and assert that response shape and SSE behavior remain OpenAI-compatible.
- SSE tests should verify that chunks are forwarded incrementally and that first token latency / chunk count / stream end are recorded.
- Fallback tests should cover upstream failure before the first chunk and stream failure after the first chunk.
- Client disconnect tests should assert upstream cancellation and TraceSpan `cancelled` status.
- API Key tests should cover valid key, invalid key, revoked key, TTL cache miss, and TTL cache refresh behavior.
- Rate limit tests should cover fixed-window RPM limits and OpenAI-compatible `rate_limit_error` responses.
- Concurrency tests should verify that SSE requests hold concurrency until stream end, stream error, or client cancellation.
- Trace write tests should verify that DB slowness or write failure does not break the model response path.
- Security tests should verify Provider API Key encryption, masked display, log redaction, and trace redaction.
- Console auth tests should verify that unauthenticated users cannot access Console pages or control-plane APIs.
- Gateway auth tests should verify that `/v1/chat/completions` does not rely on NextAuth session state.
- Trace API tests should verify start, create span, update span, and end flows, including parent-child Span relationships.
- Dashboard tests should compare UsageDaily aggregation against known request fixtures.
- Eval tests should verify exact_match, contains, regex, json_schema, llm_judge, and manual_review outcomes using deterministic fixtures where possible.
- Deployment checks should verify `/healthz`, `/readyz`, and `/metrics`, plus Docker healthcheck behavior.

## Out of Scope

- Full OpenAI API parity.
- `/v1/responses` in MVP.
- `tools` / `tool_calls` in MVP.
- JSON mode / `response_format` in MVP.
- Multimodal image / audio input.
- Embeddings and batch API.
- Gemini native API adapter.
- Claude native Messages API adapter.
- Provider-specific private parameter compatibility.
- Full OpenTelemetry compatibility layer.
- Automatic reconstruction of Agent business steps without SDK / Trace API instrumentation.
- Multi-user teams, RBAC permission matrix, SSO, GitHub OAuth, and public registration.
- Full alerting system.
- Multi-tenant billing.
- MCP marketplace.
- Embedding similarity and multi-turn Eval in MVP.
- Automatic Provider API Key rotation.
- PostgreSQL partitioning in MVP.

## Further Notes

- The project should be presented as a production-grade personal implementation inspired by Langfuse, Helicone, LangSmith, and Phoenix, not as a novel category invention.
- The strongest interview story is the combination of Rust hot path, SSE correctness, bounded async trace writes, Span tree modeling, cost attribution, and Eval regression.
- The built-in demo writing Agent is important because it proves TraceForge can observe a real multi-step AI workflow rather than only synthetic model calls.
- The first shippable milestone is Gateway + Trace + Console + Dashboard. Prompt and Eval should deepen the project after the core observability loop is demonstrably working.

## 工程架构补充

TraceForge 采用数据面 / 控制面分离架构：

```txt
业务应用 / 示例 Agent
  |
  | 仅改 baseURL 或接入 Trace SDK
  v
Rust Gateway Data Plane
  - OpenAI Compatible API
  - SSE 流式透传
  - API Key 鉴权与限流
  - LLM Span 自动采集
  - 有界 channel + async worker 写入观测事件
  |
  v
PostgreSQL / Redis
  |
  v
Next.js Console Control Plane
  - Trace 列表与详情
  - Span 瀑布图 / 火焰图
  - Dashboard
  - Prompt 版本管理
  - Eval 回归评测
```

架构取舍：

- Rust 数据面负责高并发网关热路径，包括 SSE 代理、鉴权、限流、Trace 事件采集。
- Next.js 控制面负责管理后台、可视化、Prompt/Eval、项目/API Key 管理。
- PostgreSQL 是单一事实源；Prisma 负责 migration，Rust 通过 sqlx 按表读写并使用 offline prepare / 编译期校验降低 schema drift 风险。
- Redis / 内存 TTL 缓存用于 API Key、限流计数和热路径配置缓存，避免每次请求都读 PostgreSQL。

控制台认证边界：

- Console 登录使用 NextAuth Credentials。
- MVP 使用单管理员模式，管理员凭证通过 `ADMIN_EMAIL`、`ADMIN_PASSWORD_HASH` 配置。
- Console 页面和控制面管理 API 都必须校验登录态。
- Gateway `/v1/chat/completions` 不走 NextAuth，只认项目 API Key。
- Trace 上报 API `/api/traces/*` 同样只认 project API Key（数据面鉴权），不走 NextAuth。
- 暂不做多用户团队、RBAC 权限矩阵、SSO / GitHub OAuth、公开注册。
- 后续如公网展示，可增加 read-only demo mode，避免暴露真实管理权限。

## 核心功能

### 1. 统一 AI 网关

MVP 通过统一接口调用不同模型服务：

```txt
POST /v1/chat/completions
```

`POST /v1/responses` 作为后续扩展，不进入 MVP 兼容范围。

核心能力：

- OpenAI / 第三方 OpenAI-compatible Provider 接入
- 模型配置管理
- 项目级 API Key
- 请求鉴权
- token 统计
- 成本计算
- fallback 策略
- 错误标准化

工程约束：

- API Key 校验优先走 Redis / 内存 TTL 缓存，缓存 miss 再读取 PostgreSQL。
- RPM 限流使用 Redis fixed window：`rate:{api_key_id}:{yyyyMMddHHmm}`，每次请求 `INCR`，首次创建设置 60 秒 TTL，超过 `rpm_limit` 返回 `rate_limited`。
- 并发限流使用 Redis counter：`concurrent:{api_key_id}`，请求开始时 `INCR`，请求结束 / 失败 / 客户端断开时 `DECR`；流式请求占用并发直到 `stream_end` / `stream_error` / `cancelled`；并给 `concurrent:{api_key_id}` 设较短 TTL（如 60 秒）且在活跃期心跳续期，进程崩溃后计数在约一个 TTL 内自愈，防止漏 `DECR` 导致并发计数泄漏、永久占满额度。
- 超限返回 OpenAI-compatible error：`type = rate_limit_error`，`code = rate_limited`；Stage 1 不做 sliding window。
- SSE 必须边接收上游 chunk 边透传给客户端，不能等完整响应结束后再返回。
- token 统计优先使用 provider final usage（流式对上游注入 `stream_options.include_usage=true` 以拿到真实 usage）；上游不返回 usage 时使用 tokenizer / 本地估算，并记录 `usage_source = provider | estimated`。
- fallback 只允许发生在首个 SSE chunk 返回客户端之前；首 chunk 后失败不再切换 provider，只记录 `stream_error` / `stream_timeout`。
- 客户端主动断开时取消上游请求，并将 TraceSpan 标记为 `cancelled`。

Gateway 运行健康策略：

- `GET /healthz`：只表示进程存活，不检查 PostgreSQL / Redis。
- `GET /readyz`：检查 PostgreSQL 连接、Redis 连接和关键配置是否存在。
- `GET /metrics`：返回 Prometheus 文本格式运行指标。
- 核心指标包括：`request_total`、`request_duration_ms`、`first_token_latency_ms`、`inflight_requests`、`rate_limited_total`、`upstream_error_total`、`stream_error_total`、`trace_queue_depth`、`trace_write_failed_total`。
- Docker healthcheck 使用 `/readyz`。
- MVP 不做完整告警系统，只把指标作为部署、容量观察和排障依据。

错误分类策略：

- 对客户端返回 OpenAI-compatible error，对 Trace 内部记录标准化 `error_code` 和脱敏后的错误摘要。
- 鉴权：`invalid_api_key`、`revoked_api_key`。（`quota_exceeded` 依赖未纳入 MVP 的 quota 模型，后置）
- 限流 / 并发：`rate_limited`、`concurrency_limited`，对外返回 `rate_limit_error`。
- 上游模型：`upstream_timeout`、`upstream_error`、`provider_rate_limited`、`provider_auth_failed`。
- 流式请求：`stream_interrupted`、`stream_timeout`、`client_cancelled`。
- fallback：`fallback_triggered` 作为 TraceEvent，全部 fallback 失败时最终错误为 `fallback_failed`。
- 观测写入：`trace_write_failed` 只进内部日志 / dead-letter，不影响客户端调用。
- 客户端不暴露上游 provider 原始报错细节，Trace 详情页保留定位所需的 root cause。

MVP 兼容边界：

- 支持文本版 `/v1/chat/completions` 子集：`messages`、`model`、`stream`、`temperature`、`max_tokens`、`top_p`、`stop` 和普通文本输出。
- 请求体原样透传上游（零侵入）：上述“子集 / 暂不支持”只界定 TraceForge 特别解析与测试范围，不做转发字段过滤；其余字段（含 provider 私有参数）照常转发。
- 暂不支持 `tools/tool_calls`、`response_format/JSON mode`、multimodal image/audio input、`/v1/responses`、embeddings 和 batch。
- Provider 边界：MVP 只支持 OpenAI-compatible Provider；Gemini 只有在走 OpenAI-compatible endpoint 时进入 MVP；暂不做 Gemini native API adapter、Claude native Messages API adapter 和各 provider 私有参数适配。

### 2. Trace 调用链追踪

每次 AI 请求生成一个 TraceRun，内部包含多个 TraceSpan。

接入边界：

- **网关自动 Trace**：仅改 `baseURL` 的接入方式，默认只能自动记录 `TraceRun -> LLM Span`。
- **SDK / Trace API 手动上报**：Agent 内部的工具调用、工作流节点、数据库写入、人工审核等业务步骤，由业务系统主动上报 Span。

Trace API / SDK 协议：

- MVP 提供 HTTP Trace API，Node SDK 只做薄封装。
- `POST /api/traces/start`：创建一次 TraceRun。
- `POST /api/traces/{run_id}/spans`：创建 Span，支持 `parent_id` 形成嵌套链路。
- `PATCH /api/traces/{run_id}/spans/{span_id}`：更新 Span 状态、输出、耗时与错误。
- `POST /api/traces/{run_id}/end`：结束 TraceRun，汇总状态、耗时、token 与成本。
- 鉴权与托管：`/api/traces/*` 由 Rust 数据面托管，只认 project API Key（不走 NextAuth）；网关自动 Span 与 SDK 手动 Span 复用同一条有界 channel + async worker 写入管线及同一套脱敏 / 截断 / 成本逻辑，Next.js 控制面只读，避免观测写入在 Rust 与 TS 双实现。
- SDK / Trace API 上报失败不能影响业务主流程，只记录本地错误或降级日志。
- MVP 不做 OpenTelemetry 全量兼容，仅保留 Trace / Span 字段未来映射空间。

示例：

```txt
TraceRun: AI 写作任务
  - Span: 生成选题
  - Span: 抓取资料
  - Span: 生成正文
  - Span: AI 审稿
  - Span: 保存草稿
```

每个 Span 记录：

- parent_id
- 类型：llm / tool / workflow / db / review
- 名称
- 输入与输出
- 模型名称
- token 消耗
- 耗时
- 状态
- error_code
- 错误信息
- started_at / ended_at

观测数据安全策略：

- 默认对 `authorization`、`api_key`、`password`、`token`、`cookie` 等敏感字段脱敏。
- `input_preview` / `output_preview` 设置最大长度，超长内容截断并标记 `truncated = true`。
- raw payload 默认不直接入库；如需调试，通过项目级开关写入单独的 raw 表（MVP 优先，不引入对象存储），并设置过期时间。
- 观测写入通过有界 channel + async worker，写入失败进入 retry / dead-letter，观测失败不影响主调用。

Provider API Key 安全策略：

- Provider API Key 入库前必须使用 AES-256-GCM 加密。
- master encryption key 只从环境变量读取，不入库，不进日志。
- 控制台只允许创建 / 替换 Provider API Key，不允许明文回显。
- 保存后只显示尾号，例如 `sk-****abcd`。
- 网关运行时解密后只放在内存中用于转发，不写入日志、Trace 或错误信息。
- 日志和 Trace 脱敏规则必须覆盖 Provider API Key。
- key rotation 第一版只支持手动替换，不做自动轮换。

Trace 数据保留策略：

- `TraceRun` / `TraceSpan` preview 数据默认保留 30 天。
- `TraceEvent` 默认保留 30 天。
- raw payload 默认关闭；项目级开启后只保留 7 天。
- `UsageDaily` 聚合数据长期保留，用于成本趋势和容量分析。
- `EvalDataset`、`EvalCase`、`PromptVersion` 长期保留。
- MVP 使用每日定时任务清理过期 trace，不引入 PostgreSQL 分区表。

### 3. Trace 详情页

展示一次 Agent 运行的完整链路：

- 基础信息：项目、模型、状态、耗时、token、成本
- Span 树状结构
- 每一步输入 / 输出
- 错误栈
- 流式输出统计
- fallback 记录

### 4. 成本与稳定性 Dashboard

首页展示：

- 今日请求数
- 今日 token 消耗
- 今日成本
- 平均延迟
- 失败率
- 模型调用排行
- 项目成本排行
- fallback 次数

### 5. Prompt 版本管理

第二阶段功能：

- Prompt 新建 / 编辑 / 发布
- PromptVersion 历史记录
- diff 对比
- 回滚
- 线上版本标记
- Playground 调试

### 6. Eval 回归评测

第二阶段功能：

- 创建 Eval Dataset
- 添加 input / expected_output / assertion_type / assertion_config / tags
- 批量运行 prompt + model
- 支持 exact_match / contains / regex / json_schema / llm_judge / manual_review 六类断言
- LLM-as-judge 自动评分并保存 judge_reason
- 人工复核
- 输出通过率、平均分、成本、失败样本

断言类型：

| assertion_type | 适用场景 | 判断方式 |
|----------------|----------|----------|
| `exact_match` | 固定输出、分类标签 | 输出与期望值完全一致 |
| `contains` | 关键词、必备要点 | 输出包含指定文本或要点 |
| `regex` | 结构化文本、格式要求 | 输出匹配正则表达式 |
| `json_schema` | JSON 输出、结构化抽取 | 输出可解析且符合 JSON Schema |
| `llm_judge` | 开放式回答质量 | 由 judge prompt 评分并保存 `judge_reason` |
| `manual_review` | 自动评测无法覆盖的样本 | 人工标记 pass / fail / score |

MVP 暂不做 embedding similarity / 多轮对话评测，避免引入向量模型、上下文回放和不稳定评测变量。

## 页面规划

```txt
/dashboard              总览看板
/projects               项目管理
/api-keys               API Key 管理
/models                 模型配置
/traces                 Trace 列表
/traces/[id]            Trace 详情
/prompts                Prompt 管理
/prompts/[id]           Prompt 版本详情
/evals                  评测集管理
/evals/runs/[id]        评测结果
/costs                  成本分析
/settings               系统设置
```

## 核心数据表

### Project

项目维度的资源隔离单位，用于归属 API Key、Trace、成本和 Prompt。

关键字段：

- id
- name
- description
- created_at
- updated_at

### ApiKey

项目级调用凭证。

关键字段：

- id
- project_id
- scope
- key_hash
- name
- status
- expires_at
- rpm_limit
- concurrency_limit
- revoked_at
- created_at

说明：

- 热路径通过 Redis / 内存 TTL 缓存校验。
- `scope` ∈ {`gateway` 调模型 / `trace_ingest` 上报 trace}，可组合，区分一把 Key 的能力。
- `rpm_limit` 对应每分钟请求数，网关通过 Redis fixed-window counter 执行。
- `concurrency_limit` 对应同时进行中的请求数，SSE 流式请求持续占用并发直到结束、失败或取消。
- 支持撤销后快速失效。

### ModelProvider

模型服务提供商配置。

关键字段：

- id
- name
- base_url
- api_key_encrypted
- type
- status

说明：

- `api_key_encrypted` 使用 AES-256-GCM 加密。
- master encryption key 只从环境变量读取。
- 控制台不回显明文 Provider API Key，只显示尾号。
- 第一版仅支持手动替换 Provider API Key。

### ModelConfig

具体模型配置。

关键字段：

- id
- provider_id
- model_name
- display_name
- max_tokens
- fallback_model_id
- status

说明：

- 成本定价不在此表冗余；统一查 `ModelPricing`（按 `provider` + `model` + `effective_from` 选生效价）做成本计算，避免价格双写漂移。
- `fallback_model_id` 指向同表另一行，作为该 model 的备用；网关在首 chunk 前按链切换，首 chunk 后不切。

### ModelPricing

模型成本定价表。

关键字段：

- id
- provider
- model
- input_price
- output_price
- effective_from
- created_at

说明：

- 支持不同 provider / model 的 input token 与 output token 单价配置。
- 支持价格随时间变化后的版本化核算。

### TraceRun

一次完整 AI 请求或 Agent 任务。

关键字段：

- id
- project_id
- name
- prompt_version_id
- status
- error_code
- input_preview
- output_preview
- total_tokens
- cost
- latency_ms
- usage_source
- started_at
- ended_at

### TraceSpan

TraceRun 下的单个执行步骤。

关键字段：

- id
- run_id
- parent_id
- type
- name
- model
- provider
- input_preview
- output_preview
- raw_payload_ref
- prompt_tokens
- completion_tokens
- usage_source
- cost
- latency_ms
- status
- error_code
- error
- started_at
- ended_at

说明：

- `parent_id` 用于还原 Agent 多步链路。
- LLM 调用可由网关自动采集。
- tool / workflow / db / review 等业务步骤通过 SDK / Trace API 上报。

### TraceEvent

TraceSpan 下的细粒度事件。

关键字段：

- id
- span_id
- type
- payload
- created_at

常见事件：

- stream_start
- first_token
- chunk_count
- stream_end
- stream_error
- stream_cancelled
- fallback_triggered
- fallback_failed

### Prompt

Prompt 的逻辑实体。

关键字段：

- id
- project_id
- name
- description
- active_version_id
- created_at

### PromptVersion

Prompt 的版本记录。

关键字段：

- id
- prompt_id
- version
- content
- variables_schema
- status
- created_at

### EvalDataset

评测集。

关键字段：

- id
- project_id
- name
- description
- created_at

### EvalCase

评测样本。

关键字段：

- id
- dataset_id
- input
- expected_output
- assertion_type
- assertion_config
- tags
- metadata

### EvalRun

一次评测运行。

关键字段：

- id
- dataset_id
- prompt_version_id
- model_config_id
- status
- average_score
- total_cost
- duration_ms
- created_at

### EvalResult

单条样本的评测结果。

关键字段：

- id
- eval_run_id
- eval_case_id
- output
- assertion_type
- pass
- score
- judge_reason
- cost
- duration_ms
- status

### UsageDaily

每日用量聚合。

关键字段：

- id
- project_id
- model_config_id
- date
- request_count
- success_count
- failure_count
- prompt_tokens
- completion_tokens
- total_cost
- average_latency_ms

说明：

- 聚合数据长期保留。
- 用于成本趋势、容量分析和历史对比。
- 与 TraceRun / TraceSpan 的短期保留策略解耦。

## 技术栈建议

```txt
Rust
axum
tokio
reqwest
sqlx
Next.js 16
React 19
TypeScript
Prisma 7
PostgreSQL
Redis
OpenAI Compatible API
SSE
Docker Compose
Nginx
GitHub Actions
OpenAPI
```

## MVP 范围

第一版只做：

- 单管理员 Console 登录
- 项目管理
- API Key 管理
- Rust 统一模型网关
- TraceRun / TraceSpan 记录
- Trace 列表和详情页
- token / 成本统计
- Dashboard
- Gateway 健康检查与运行指标
- Docker 部署

暂不做：

- 完整 Eval 系统
- MCP 工具市场
- 复杂权限系统
- SSO / GitHub OAuth / 公开注册
- 多租户计费
- 高级告警
- 完整 OpenTelemetry 兼容层

## 里程碑

> **阶段编号以[工程 PRD（精修层）](TraceForge-工程PRD.md) 的 Stage 0–6 为准**。下列 Stage 1–8 是更细的展开视图，大致映射：精修层 Stage 1≈本文 Stage 1，Stage 2≈Stage 2，Stage 2.5≈Stage 3，Stage 3≈Stage 4，Stage 4≈Stage 5，Stage 5≈Stage 6，Stage 6≈Stage 7，部署 / 外部接入贯穿 Stage 8。文末「旧版阶段划分归档」(Phase 1–4) 仅作历史参考，已废弃。

### Stage 1: Rust OpenAI Compatible Gateway + SSE 流式透传

内容：

- 优先实现 Rust OpenAI Compatible Gateway。
- 第一版支持 `/v1/chat/completions`，后续扩展 `/v1/responses`。
- 支持代理上游 OpenAI / 第三方 OpenAI-compatible Provider；Gemini 仅在提供 OpenAI-compatible endpoint 时纳入 MVP。
- 支持 SSE 流式透传，保证改 baseURL 后即可接管调用且流式体验不被破坏。
- 支持项目与 API Key 鉴权，热路径优先使用 Redis / 内存 TTL 缓存，缓存 miss 再读 PostgreSQL。
- 按 Key 执行 Redis fixed-window RPM 限流与 Redis counter 并发限流，超限返回 OpenAI-compatible `rate_limit_error`。
- 兼容范围限定为文本版 `/v1/chat/completions` 子集，暂不支持 tools、multimodal、responses API、embeddings 和 batch（仅指不特别解析 / 测试，请求体仍原样透传）。
- 流式 fallback 只允许发生在首 chunk 前；首 chunk 后失败只记录 stream error / timeout，不切换 provider。
- 暴露 `/healthz`、`/readyz`、`/metrics`，用于部署健康检查和运行指标观测。

验证：

- 外部应用只改 `baseURL` 和 API Key 即可通过 TraceForge 调用模型。
- 普通响应和 SSE 流式响应均可正常透传。
- 网关不破坏 OpenAI Compatible 调用体验。
- API Key 撤销后能在 TTL 内快速失效。
- 超过 `rpm_limit` / `concurrency_limit` 的请求被拒，返回 OpenAI-compatible `rate_limit_error`。
- 首 chunk 前上游失败可 fallback；首 chunk 后失败不 fallback，并能在 TraceEvent 中看到 `stream_error` / `stream_timeout`。
- Docker healthcheck 可通过 `/readyz` 判断服务是否可接流量，`/metrics` 能看到请求、延迟、限流、上游错误、流式错误和 trace 队列指标。

### Stage 2: Trace 自动采集与建模

内容：

- 设计 TraceRun / TraceSpan 数据模型。
- 网关自动为每次模型调用生成 TraceRun。
- 每次上游 LLM 调用自动生成 LLM Span。
- 记录 input_preview、output_preview、model、provider、status、duration、usage、usage_source、cost、error_code、error。
- 对流式调用记录 stream_start、first_token_at、chunk_count、stream_end、stream_error 等关键事件。
- 通过有界 channel + async worker 异步写入 Trace；DB 慢或失败时进入 retry / dead-letter，观测失败不影响主调用。
- 默认对敏感字段脱敏，对超长 input / output 截断并标记 truncated。

验证：

- 一次普通模型调用可以自动落库为 `TraceRun -> LLM Span`。
- 一次流式模型调用可以精确记录首 token 延迟、总耗时、chunk 数和最终输出。
- token 优先使用 provider final usage；上游不返回 usage 时使用估算值，并标记 `usage_source=estimated`。
- 成功与失败请求都能生成可追踪记录。

### Stage 3: Trace SDK / 手动 Span 上报

内容：

- 提供 Trace API / Node SDK，支持外部应用手动创建 TraceRun 和 TraceSpan。
- Trace API 包含 start / create span / update span / end 四类接口，SDK 作为薄封装提供更顺手的调用方式。
- 支持业务系统上报 tool span、workflow span、db span、review span。
- 支持 parentSpanId，实现嵌套 Span 树。
- SDK / Trace API 上报失败不能影响业务主流程，只记录本地错误或降级日志。
- MVP 不做 OpenTelemetry 全量兼容，仅保留 Trace / Span 字段未来映射空间。
- 用内置示例写作 Agent 作为真实接入场景，记录“选题 -> 抓取资料 -> 成文 -> 审稿 -> 保存草稿”的完整链路。

验证：

- 示例写作 Agent 接入 TraceForge 后，一次 AI 写作任务能落库为多步 Trace。
- TraceRun 下能看到多个不同类型 Span。
- Span 父子关系正确，能支撑后续瀑布图 / 火焰图展示。
- 故意关闭 Trace API 时，示例写作 Agent 主业务流程仍能完成。

### Stage 4: Trace 可视化

内容：

- 实现 Trace 列表页。
- 实现 Trace 详情页。
- 展示 Span 树、瀑布图 / 火焰图、耗时、输入输出、标准化 error_code、错误摘要、token 与成本。
- 支持按项目、模型、状态、时间筛选。

验证：

- 点开一条 trace 能看到完整链路耗时。
- 能定位哪一步失败、哪一步最慢、哪一步成本最高。
- 多步 Agent trace 的父子结构可视化正确。

### Stage 5: 成本治理与 Dashboard

内容：

- 按项目、模型、日期聚合 token 与成本。
- 展示请求数、失败率、平均延迟、首 token 延迟、成本趋势。
- 支持模型 / 项目 / 用户维度排行。
- 把 Stage 1 已实现的限流 / 并发拒绝与 fallback 事件落到 Trace 与 Dashboard，便于按项目 / Key 复盘超限原因。
- 设计 ModelPricing 表，支持不同 provider / model 的 input token 与 output token 单价配置，并按 effective_from 做价格版本化。

验证：

- 项目维度成本统计准确。
- 多模型成本核算可解释。
- Dashboard 能展示成本、延迟、失败率趋势。
- 限流和 fallback 事件能被 Trace 记录。

### Stage 6: Prompt 版本管理

内容：

- 支持 Prompt 新建 / 编辑 / 发布。
- 支持 PromptVersion 历史记录。
- 支持 diff 对比、回滚、线上版本标记。
- 支持 Playground 调试不同 prompt / model 组合。
- 调用关联版本：网关调用通过 `X-TraceForge-Prompt-Version` header 声明、SDK 通过字段传入，写入 `TraceRun.prompt_version_id`。

验证：

- Prompt 改动可追溯、可对比、可回滚。
- 线上版本和草稿版本能明确区分。
- 同一输入可在不同 prompt / model 下对比输出。

### Stage 7: Eval 回归评测

内容：

- 支持 Eval Dataset / EvalCase。
- EvalCase 字段包括 input、expected_output、assertion_type、assertion_config、tags。
- 支持 exact_match / contains / regex / json_schema / llm_judge / manual_review 六类断言。
- 支持批量运行 prompt + model。
- 支持 LLM-as-judge 自动评分。
- 支持人工复核。
- 输出通过率、平均分、失败样本、judge_reason、成本和耗时。

验证：

- Prompt 改动后能跑评测集，看到通过率、平均分和失败样本回归。
- 能对比不同 prompt / model 组合的质量、成本和延迟。
- 失败样本可复盘。

### Stage 8: Docker 部署与外部接入

内容：

- 使用 Docker Compose + Nginx 部署。
- 提供 OpenAPI 文档。
- 提供 Node SDK 使用示例。
- 接入内置示例写作 Agent 作为真实被观测 AI 应用。
- 补充部署文档、环境变量模板和演示数据。

验证：

- 项目可部署到公网服务器。
- 示例写作 Agent 能通过 TraceForge 网关调用模型并上报多步 trace。
- 外部应用能通过 OpenAPI / SDK 快速接入追踪与成本统计。

## 旧版阶段划分归档

以下为早期阶段划分，保留作历史参考；实际开发以 Stage 1 到 Stage 8 为准。

### Phase 1: AI 网关与 Trace 闭环

- 完成项目、API Key、模型配置。
- 实现 `/v1/chat/completions` 兼容接口。
- 模型调用前后自动写入 TraceRun / TraceSpan。
- Trace 列表和 Trace 详情可查看。

### Phase 2: 成本治理与 Dashboard

- 按项目、模型、日期聚合 token 与成本。
- 展示请求数、失败率、平均延迟、成本趋势。
- 增加基础限流和 fallback 记录。

### Phase 3: Prompt 与 Eval

- 支持 Prompt 版本管理。
- 支持 Eval Dataset / EvalCase。
- 支持批量回归评测。
- 输出通过率、平均分、失败样本和成本。

### Phase 4: SDK 与外部接入

- 提供 OpenAPI 文档。
- 提供 Node SDK。
- 支持外部 AI 应用接入 TraceForge。
- 完善 Docker 部署文档。

## 工程风险与取舍

- **零侵入边界**：仅改 `baseURL` 只能自动观测普通 LLM 调用；Agent 多步链路必须通过 Trace SDK / Trace API 手动上报，不能承诺网关自动还原所有业务步骤。
- **Trace SDK 边界**：Node SDK 只是 HTTP Trace API 的薄封装，MVP 不做 OpenTelemetry 全量兼容，也不让观测上报失败影响业务主流程。
- **错误分类边界**：对外错误保持 OpenAI-compatible，避免泄露 provider 原始细节；对内必须用 `error_code` 分类，否则 Trace 详情页无法稳定聚合和排障。
- **Eval 范围边界**：MVP 只做 deterministic assertion、JSON Schema、LLM judge 和人工复核；embedding similarity / 多轮对话评测后置，避免 Eval 先变成另一个大项目。
- **SSE token 统计口径**：流式代理可以精确记录首 token 延迟、chunk 数和总耗时；token 优先使用 provider final usage，上游不返回 usage 时只能估算，并必须标记来源。
- **异步写入可靠性**：Trace 写库不能阻塞主请求，必须使用有界 channel、async worker、retry 和 dead-letter，避免 DB 慢时网关内存无限增长。
- **观测数据安全**：默认脱敏和截断 request / response，raw payload 通过项目级开关控制，并设置过期策略。
- **Provider API Key 安全**：上游 provider key 必须加密存储、永不明文回显、运行时只在内存解密；第一版只做手动替换，不做自动轮换。
- **混合架构协调成本**：Prisma schema 与 Rust sqlx 要同步；Prisma 负责 migration，Rust 使用 sqlx offline prepare / 编译期校验，CI 同时校验前后端数据契约。
- **范围控制**：MVP 先完成 Rust Gateway + Trace + Dashboard 闭环，Prompt/Eval 作为第二阶段增强，避免把项目做成 Langfuse 全量复刻。
- **OpenAI Compatible 边界**：MVP 不追求完整 OpenAI API parity，只做文本版 `/v1/chat/completions` 子集，避免 tools、multimodal、responses API 把 Stage 1 拖成兼容性黑洞。
- **Provider 支持边界**：MVP 只支持 OpenAI-compatible Provider；Gemini / Claude native adapter 后置，避免 Stage 1 被各家私有协议和特殊参数拖散。
- **Console 认证边界**：Console 登录只保护控制面；Gateway `/v1/chat/completions` 只认项目 API Key，避免把管理后台登录态和模型调用鉴权混在一起。
- **Gateway 健康信号边界**：`/healthz` 只代表进程存活，不能当成依赖就绪；Docker healthcheck 使用 `/readyz`，运行指标通过 `/metrics` 暴露。
- **SSE fallback 边界**：fallback 不能牺牲流式响应语义完整性；首 chunk 后不切 provider，只记录 stream error / timeout / cancelled。
- **Trace 数据膨胀**：MVP 通过 30 天 trace preview / event 保留、7 天 raw payload 保留、UsageDaily 长期聚合和每日清理任务控制数据库增长。
- **限流算法取舍**：MVP 使用 Redis fixed window 做 RPM，边界分钟可能存在短时突刺；并发限制用 Redis counter 覆盖 SSE 长连接，sliding window / token bucket 放到后续优化。

## 成功指标

- 能通过 Rust OpenAI Compatible Gateway 完成真实模型调用。
- 未登录无法访问 Console 页面和控制面管理 API。
- `/healthz`、`/readyz`、`/metrics` 能区分进程存活、依赖就绪和运行指标。
- SSE 流式透传不破坏上层调用体验。
- 每次普通 LLM 调用都能生成 `TraceRun -> LLM Span`。
- 示例写作 Agent 通过 Trace SDK / Trace API 能上报多步 Agent Span。
- Trace 详情能定位每一步耗时、输入、输出、错误。
- Trace payload 默认支持脱敏、截断和 raw 存储开关。
- Provider API Key 加密存储且控制台不明文回显。
- TraceRun / TraceSpan / TraceEvent 默认执行 30 天保留策略，raw payload 开启后只保留 7 天。
- Dashboard 能按项目 / 模型统计 token 和成本。
- token 统计能区分 `provider` 与 `estimated` 两种来源。
- 项目可通过 Docker 部署到公网。
- 简历中能支撑“AI 网关、Agent 可观测、成本治理、Prompt/Eval 工程化”叙事。

## 简历表达草稿

```md
### TraceForge · 企业级 AI 网关与 Agent 可观测平台

`Rust` `axum` `tokio` `Next.js` `TypeScript` `Prisma` `PostgreSQL` `Redis` `SSE` `OpenAI Compatible API` `Docker` `OpenAPI`

独立开发的 AI Gateway + AgentOps 平台，采用 Rust 数据面 + Next.js 控制面的分离架构，提供统一模型网关、调用链追踪、token 成本统计、Prompt 版本管理与 Eval 回归评测能力，用于解决 AI 应用上线后的可观测性、稳定性和成本治理问题。

- 使用 Rust + axum + tokio 实现 OpenAI-compatible provider 网关，支持 SSE 流式透传、API Key 鉴权、限流、fallback 和多 provider 代理
- 设计 TraceRun / TraceSpan 调用链模型，普通 LLM 调用仅改 baseURL 即可自动采集，Agent 多步链路通过 Trace SDK / API 上报
- 对流式请求记录首 token 延迟、chunk 数、总耗时和错误事件，token 优先取 provider usage，缺失时估算并标记来源
- 建设项目维度成本 / 延迟 / 失败率 Dashboard，并通过 Prompt 版本管理与 Eval 回归评测支持 prompt 变更质量复盘
- 使用 Docker Compose + Nginx 完成自建服务器部署，并接入内置示例写作 Agent 作为真实被观测 AI 应用
```
