# TraceForge 任务进度

## 未完成项收尾（2026-09-29，#75–#80）

- [x] #76：Agent 采集接口、双 scope、同项目父子树、四方法 Node SDK 与真实写作 Agent 示例已经实现。
- [x] #77：LLM Judge 改为真实 Gateway 调用，严格评分 JSON、预算与两次调用费用；正常/无效 JSON/超时浏览器用例通过。
- [x] #79：Prisma 传递依赖修复、ESLint 10 兼容升级；npm audit 0 告警，lint/typecheck/8 项单测通过。
- [x] #78：SQLx 离线 metadata、预编译非 root 镜像、HTTPS 和生产初始化完成，40 项完整容器验收通过。
- [x] 真实中转 Agent/Judge 验收与双轴审查；审查发现 3 项均修复并复核关闭。
- [ ] 本轮 PR 的 CI 与主线交付。
- [ ] #80：已联网查到官方参考价，但中转没有公开可确认费率，详见 docs/verification/relay-pricing.md。实际价格仍待中转账单/后台提供，成本保持未知。

本轮 9 项 Node 单测、40 项 Node 与 40 项 Docker 浏览器回归、lint/typecheck/build、SQLx 在线/离线检查、HTTPS 自签名本地验收全部通过。用户确认当前没有服务器和域名，因此公网部署不在本轮执行范围；Redis/持久队列等后置项不扩展。以下旧阶段勾选保留为历史记录，当前状态以本节及 GitHub 验收为准。

## 真实模型接入（2026-09-29）

- [x] 复用 seed-deepseek.ts，通过环境配置兼容中转地址与 deepseek-v4.1-flash，Provider / Model 在同一事务内更新，密钥 AES-256-GCM 加密入库。
- [x] Chat 通过 TRACEFORGE_CHAT_MODEL 默认选择真实模型；Compose 同步传递配置，配置不可用时要求重新选择。
- [x] 本地非流式与浏览器流式调用均成功，Trace 和 Dashboard 可见；上游分别报告 70 / 124 Token，并保留流式事件。未提供中转价格，成本保持未知。
- [x] lint、typecheck、8 项单测、生产构建及 32 项隔离 Node 浏览器回归通过；既有回归增加运行时默认模型优先于 mock 的断言，Node / Docker 共用。

实际接入地址仅保存于本地环境与数据库，明文上游密钥未写入 .env 或版本控制文件。自动化仍使用隔离数据库和 mock 上游；真实调用使用当前本地项目，Demo 标识与历史数据保持原有配置。

## Console 整改（2026-09-29）

已恢复完整 UI / Gateway 基线，本轮通过 PR #73 交付恢复基线和 #60 整改。用户此前只能看到最小控制台，是远端 master 未包含完整开发成果。

- [x] #61：Next 16.3.6、lint、typegen、真实进程浏览器基线。
- [x] #62–#63：显式 Demo、禁止默认生产凭据、持久标识、server-only DAL、读写独立授权、共享 Console 外壳。
- [x] #64–#66：输入与归属校验、事务和幂等、上海时间、loading/可恢复错误/not-found。
- [x] #67–#68：持久化 demo、完整数据库聚合、UsageDaily 对账、有限明细、真实治理证据。
- [x] #69–#70：after 托管 Chat、有截止 pending、同步 Eval 预算与幂等、失败汇总及人工复核。
- [x] #71：standalone 非 root 镜像、实际环境校验、Node/Docker 共用浏览器验收、启动/迁移/TLS 文档。
- [x] #72：干净检出 474684384199aa04e4d7aaab0ab0459439f40e85，8 项单测、32 项 Node 与 32 项 Docker 回归全部通过；同版本 CI / Deploy Readiness 全绿，以 PR #73 交付主线。

验收提交已推送，独立 worktree 的受版本控制文件无修改；详细命令、GitHub 运行编号和验收边界见 docs/testing.md。其后交付提交仅补充验收记录，最终 PR head 仍须通过同套 GitHub 检查后合并。

Standards / Spec 双轴审查的发现均已逐项修复；对应回归及 36 条用户故事映射见 docs/testing.md。历史记录保留如下，其中“master 缺失代码”“#61 无法开工”等均为 2026-09-28 的审查快照，不代表本轮最终状态。

### 明确后置 / 外部前提

- Redis、分布式限流、持久化队列、独立 Worker、多用户权限、Chat 会话持久化不在 #60 范围。
- 公网服务器、域名、TLS 证书、真实 Provider 密钥需部署方提供；当前验收只使用 mock 上游。
- 此处 4 high 是 #60 验收时的历史状态；#79 后续已修复，见本文首节与依赖审计记录。
- 启动时编译是 #60 验收时的历史状态；本轮 #78 已实现离线编译与精简 runtime，并完成容器验收。

## Chat 与侧边栏交互修复（2026-07-14）

- [x] Chat 页固定在控制台内容区高度内，仅消息区与左侧信息区内部滚动。
- [x] 左侧导航保留短屏滚动能力，但隐藏滚动条并禁用长按选择造成的视觉滚动。
- [x] 将“收起”替换为真实可切换、可持久化的侧边栏折叠按钮。
- [x] 验证桌面端折叠/展开、Chat 滚动边界和移动端自然滚动。
- [x] 运行构建与类型检查。

### Review

- `1440 × 900` 下 Chat document 高度固定为 `900px`，消息线程和左侧实时信息面板均可独立滚动。
- 左侧导航滚动条计算值为 `none`，长按后侧栏与导航 `scrollTop` 保持 `0`，没有产生文本选择。
- 侧栏可在 `148px` 与 `56px` 间切换，折叠状态写入本地存储，刷新后仍保持；移动端隐藏折叠按钮。
- `npm run build`、`npx tsc --noEmit` 和相关 diff 检查通过，Chrome + Playwright 完成滚动、折叠、持久化和截图验证。

## 控制台固定视口与卡片内滚动（2026-07-14）

- [x] 桌面端控制台壳层限制为 `100dvh`，禁止 body 与总体页面滚动。
- [x] 左侧导航、追踪运行队列、中央工作区和右侧治理面板分别设置高度边界。
- [x] 治理总览与 Prompt/Eval 工作区复用同一套内部滚动规则。
- [x] 在 `980px` 以下恢复自然页面滚动，避免移动端嵌套滚动。
- [x] 运行构建并验证桌面与窄屏布局。

### Review

- `1440 × 900` 下追踪运行、治理总览和 Prompt/Eval 页的 document 高度均等于视口高度，body 为 `overflow: hidden`。
- 追踪运行列表与实时治理卡可独立滚动；治理总览主列与治理卡、Prompt/Eval 证据栏均使用内部滚动。
- `390 × 844` 下恢复 body 自然滚动，工作区不保留桌面端嵌套高度限制。
- `npm run build`、`npx tsc --noEmit` 和本次 CSS diff 检查通过；Chrome + Playwright 完成桌面与移动端截图和滚动量测。

## 根布局 Hydration 警告修复（2026-07-14）

- [x] 根据报错差异确认根 `<html>` 被浏览器扩展注入额外属性。
- [x] 仅在根 `<html>` 节点抑制预期的 hydration 属性差异。
- [x] 运行构建并模拟扩展注入，确认控制台不再报 hydration mismatch。

### Review

- 报错中的 `data-redeviation-bs-uid` 不由应用生成，而是浏览器扩展修改根 HTML 后造成的属性差异。
- 已在根 `<html>` 添加 `suppressHydrationWarning`，抑制范围只覆盖该节点，不会掩盖后代组件的 hydration 问题。
- `npx tsc --noEmit` 与 `npm run build` 均通过。
- Playwright 在页面脚本运行前注入同名属性访问 `/login`，未出现 hydration 控制台错误或页面异常。

## 控件尺寸与首页搜索栏修复（2026-07-13）

- [x] 对照截图定位按钮、下拉框和搜索栏样式来源。
- [x] 确认旧全局表单规则覆盖 UI 组件尺寸的根因。
- [x] 收窄全局表单选择器，恢复组件自身高度规范。
- [x] 构建并浏览器验证 Dashboard 与首页顶栏。

### Review

- 根因是旧全局 `input/select/textarea` 的 `min-height: 38px` 覆盖了带 `data-slot` 的 UI 组件尺寸。
- 已将旧样式限制为非组件化原生表单控件，Dashboard 的项目下拉框与刷新按钮恢复为同高 `28px`。
- 首页搜索输入恢复为 `30px`，完整包含在 `34px` 搜索容器内；桌面与 `640px` 窄屏均无裁切或横向溢出。
- `npm run build` 通过；生产构建页面已用 Chrome + Playwright 验证。

## Oh My Mermaid 架构文档生成（2026-07-13）

- [x] 核对官方 CLI 与 Codex 集成方式。
- [x] 全局安装 `oh-my-mermaid@0.2.0` 并注册 Codex skill。
- [x] 扫描 TraceForge，生成 `.omm/` 递归架构文档。
- [x] 验证全部 Mermaid 图与本地查看命令。

### Review

- 已生成 5 个视角：`overall-architecture`、`request-lifecycle`、`data-flow`、`route-page-map`、`external-integrations`。
- 已为 Console、Gateway、请求阶段、数据流节点、路由页面和外部依赖补齐递归说明。
- `omm validate` 全部通过；`omm tree overall-architecture` 可正确识别两层组件树。
- Windows 兼容性：`omm setup codex` 使用 Unix `which codex` 检测，无法识别 Codex Desktop；已按其源码目标创建 `C:\Users\Administrator\.agents\skills\oh-my-mermaid` junction，效果等同官方 setup。

> 环境约束：当前 Windows 无 Docker。故下一步走**本地原生运行**——gateway 用 `cargo run`、console 用 `npm run dev`，直连已配好的远程 PostgreSQL（`traceforge` schema）。
> Docker / Compose 降级为**部署阶段（PRD Stage 6）或装了 Docker 之后**再做，见末尾「已延后」。
>
> 当前状态：数据契约（Prisma schema）+ seed + 最小 sqlx 示例 + CI 已落地。

---

# UI 高保真改造计划 · Round 2 原型落地

> 原型目录：`docs/ui-redesign/`
> 详细计划：`docs/ui-redesign/UI_REDESIGN_PLAN.md`
> 目标：用 Round 2 三张图作为高保真目标，把当前控制台改成 V1 主壳 + V2 密集治理面板 + V3 Prompt/Eval Regression Studio。缺失数据只走 mock/view-model 层，不提前污染生产 schema。

## 计划（每项 → 验证）

- [x] **1. 设计基础层**
  - 抽出 console shell、top command bar、metric strip、badge、filter bar、dense table、governance rail、waterfall/span tree、prompt diff、heatmap 等组件。
  - → 验证：现有页面仍能 build，组件可在至少一个页面复用。
- [x] **2. mock/view-model 层**
  - 新增确定性的 UI mock 数据与聚合 helper；真实数据优先，缺失字段才 mock。
  - → 验证：空库/少量数据也能渲染高保真 prototype state，mock 不写库。
- [x] **3. 全局壳改造**
  - 统一深绿 sidebar、紧凑顶栏和支持的导航项；先不展示 Alerts。
  - → 验证：Dashboard、Chat、TraceRuns、Prompt、Eval 路由都可达。
- [x] **4. Incident Command Trace 屏**
  - `/traces` 与 `/traces/[id]` 改成 TraceRun 列表 + 详情 + Waterfall/Span Tree + Live governance rail。
  - → 验证：Stage 3 demo 可演示“筛失败 → 看链路 → 定责任域”。
- [x] **5. Live Governance Dashboard**
  - `/dashboard` 改成顶部 KPI strip、密集 TraceRun 表、右侧治理 rail、底部 UsageDaily 与模型成本拆分。
  - → 验证：Stage 4 demo + UsageDaily 聚合后数值可对上。
- [x] **6. Regression Studio**
  - Prompt/Eval 页面改成 baseline/candidate diff、Eval evidence rail、assertion matrix、compare runs。
  - → 验证：Stage 5/6 demo 可比较 PromptVersion 与 EvalRun。
- [x] **7. 响应式与验收**
  - 检查 1440、1280、980、390 宽度；修复溢出、重叠、空态、错误态。
  - → 验证：`npm run build`、`npx prisma validate`、手动视觉对照三张 Round 2 原型。

## UI 改造 Review（进行中）

- 已完成 shadcn/ui 初始化并安装全量组件到 `components/ui/`，自定义组合组件放在 `components/traceforge/`。
- 已完成全局控制台壳：深绿 sidebar、紧凑 top command bar、真实路由导航（Dashboard / Chat / TraceRuns / Prompt / Eval），未暴露 Alerts。
- 已完成 `/dashboard` 高保真第一版：V2 KPI strip、密集 TraceRun 表、选中详情、Live governance rail、UsageDaily 和模型成本拆分；真实数据优先，缺失展示字段用确定性 mock。
- 已完成 `/traces` Incident Command 工作台：TraceRun 队列、失败/运行/慢请求分组、同屏选中详情、Waterfall、Span Tree、责任域 rail、fallback/rate-limit/provider health/slowest/costliest 证据。
- 已完成 `/prompts/[id]` Regression Studio 工作区：baseline/candidate 选择、双栏 diff、Run eval、Promote/Rollback、Eval summary rail、failed cases、Trace evidence、assertion matrix、compare runs、recent EvalRun。
- 验证通过：`npm run build`、`npx prisma validate`；浏览器截图见 `docs/ui-redesign/verification/dashboard-r6.png`、`docs/ui-redesign/verification/traces-incident-r3.png`、`docs/ui-redesign/verification/regression-studio-r1.png`。
- 已完成 1440 / 1280 / 980 / 390 宽度浏览器验收：最终截图与报告在 `docs/ui-redesign/verification/responsive/`，三条真实页面的页面级 `overflowX=0`；Dashboard / Trace / Regression Studio 均可通过 `data-source` 审计 mock/derived 数据。

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

## Review（已完成）

Stage 1 全部 8 个竖切片(GitHub issue #1–#8)实现 + 实测 + 提交,均已 CLOSED：

| issue | 切片 | commit | 验证 |
|------|------|--------|------|
| #1 | S0 mock 上游 | — | 非流式/流式/fail_before 三场景 |
| #2 | S1 非流式代理→DeepSeek | 3c908cb | 真实 DeepSeek 200;TS加密↔Rust解密打通 |
| #3 | S2 SSE 流式透传 | (后续) | 真实 DeepSeek 逐块 SSE;不缓冲 |
| #4 | S3 客户端断开取消 | — | mock 观测到上游 abort |
| #5 | S4 API Key 校验 | — | 无auth/有效/撤销/无scope 四情形 |
| #6 | S5 内存限流 | — | RPM 5×200+429;并发占满→429→释放后200 |
| #7 | S6 首 chunk 前 fallback | — | mock-fail→fallback成功;mock-mid→不切 |
| #8 | S7 /metrics + /readyz | — | 各计数正确;readyz 200 |

最终全量验证：`cargo clippy` 零问题；全栈实跑(valid key→真实 DeepSeek)200；healthz/readyz 200。

偏差与取舍：
- 限流按决策 9 用内存+trait(非 Redis)。
- 测试 key/上游配置由 scripts/seed-{deepseek,mock,apikey}.ts 灌入。
- DeepSeek key 在 .env(gitignore);**需 rotate**(曾贴入对话)。

下一步：Stage 2(Trace 采集落库)——届时 trace_queue_depth / trace_write_failed_total 等补齐。

---

# Stage 2 拆解 · Trace 采集与建模

> 目标(PRD Stage 2)：每次网关调用**异步**生成 `TraceRun + TraceSpan` 落库，**不阻塞主转发**；
> 记录 model/provider/usage/usage_source/耗时/状态/error_code/错误摘要；流式精确记首 token 延迟/总耗时/chunk 数/最终输出；
> provider usage 优先，缺失则本地估算并标 `usage_source=estimated`；DB 慢/写失败进 retry/dead-letter，观测失败不影响主调用。
>
> **范围**：仅**网关自动采集**，单层 `Run + 1 llm Span`（决策 3）。SDK 手动多层 Span 属 **Stage 2.5**，不在此。
> **决策依据**：§9 决策 3/6/7/8 + §3.1 脱敏截断 + §3.4 error_code + ModelPricing 成本核算。

## 前置(已定，见 PRD §9)

- Rust 单写所有 Trace，一条管线（决策 6）；Next.js 对 Trace 只读。
- 采集尽力而为、绝不阻塞；队列满整条丢+计数；写库失败 retry+dead-letter（决策 7）。
- 流式 `include_usage` 注入+按需剥离+本地估算兜底（决策 8）。

## 执行切片(竖切，详见 GitHub issue)

- **T1** 异步写库管线 + 非流式调用落库（基础 tracer bullet）：有界 channel + async worker；一次非流式调用 → DB 有完整 `TraceRun+llm Span`（含脱敏截断的 input/output preview、status、latency）。
- **T2** 流式落库 + 细粒度事件：`TraceEvent`(stream_start/first_token/chunk_count/stream_end)；记首 token 延迟、总耗时、chunk 数、拼接最终输出。
- **T3** provider usage 注入采集 + 估算兜底（决策 8）：注入 `include_usage`、消费末尾 usage chunk、客户端没要则剥离；拿不到用 tiktoken-rs 估算并标 `usage_source`。
- **T4** 成本核算（ModelPricing）+ usage_source 聚合：按 provider+model+effective_from 选价算 span/run cost；run 级任一 span 为 estimated 即 estimated。
- **T5** 错误/限流/fallback 落库：失败写 `status=failed`+`error_code`+脱敏摘要；鉴权/限流→TraceRun failed(无上游 span)；fallback_triggered/failed 作 TraceEvent（§3.4）。
- **T6** 写入可靠性 + 指标：队列满丢弃计数、写失败 retry+dead-letter；补 `trace_queue_depth`/`trace_write_failed_total` 到 /metrics（S7 预留的两项）。

## 范围边界(Stage 2 不做)

- 不做 SDK 手动 Span / 嵌套多层链路 → Stage 2.5
- 不做 Trace 瀑布图可视化、责任域 UI 归因 → Stage 3（本阶段只把 error_code/分类数据写进库）
- 不做 Trace 保留/清理定时任务 → 后续
- 不接 Prompt 版本关联（X-TraceForge-Prompt-Version）→ Stage 5

## Review（已完成）

Stage 2 全部 6 个竖切片（GitHub issue #9-#14）实现并验证：

| issue | 切片 | 状态 | 验证 |
|------|------|------|------|
| #9 | T1 异步写库管线 + 非流式落库 | ✅ 完成 | mock 非流式 → DB 有 TraceRun + llm Span；preview 脱敏 `sk-*` |
| #10 | T2 流式落库 + 细粒度事件 | ✅ 完成 | stream_start / first_token / chunk_count / stream_end 落库 |
| #11 | T3 provider usage 注入采集 + 估算兜底 | ✅ 完成 | 默认剥离 usage chunk；客户端要求 usage 时保留；mock-mid 无 usage → tiktoken-rs estimated |
| #12 | T4 成本核算 + usage_source 聚合 | ✅ 完成 | mock pricing 固定单价下 cost=0.000009 / estimated cost=0.000008 |
| #13 | T5 错误/限流/fallback 落库 | ✅ 完成 | fallback_triggered、stream_interrupted、rate_limited、revoked_api_key 均落库 |
| #14 | T6 写入可靠性 + 指标 | ✅ 完成 | 有界 try_send、队列满计数、写失败重试 + dead-letter(log)、metrics 暴露 queue/write_failed/dropped |

实测请求覆盖：
- 非流式 `mock-ok`：TraceRun/Span success，provider usage + cost。
- 流式 `mock-ok`（客户端未要 usage）：响应不含 usage 帧，DB 仍记录 provider usage。
- 流式 `mock-ok`（客户端要 usage）：响应保留 usage 帧。
- 流式 `mock-fail`：首 chunk 前 fallback 到 `mock-ok`，TraceEvent 有 `fallback_triggered`。
- 流式 `mock-mid`：首 chunk 后无 `[DONE]`，Span failed + `stream_interrupted`，usage_source=estimated。
- 第 6 次 valid key 请求：429 `rate_limited`，TraceRun failed 且无上游 Span。
- revoked key：401 `revoked_api_key`，TraceRun failed 且无上游 Span。

最终验证：
- `cd gateway && cargo check`
- `cd gateway && cargo clippy -- -D warnings`
- `cd gateway && cargo build --bins --examples`
- `npx prisma validate`
- `npm run build`
- `node scripts/verify-trace.mjs`

---

# 继续开发计划 · 基于 Claude 导出与当前仓库（2026-06-27）

## 来源确认

- Claude 导出文件：`C:\Users\Administrator\Downloads\Compressed\data-29e4eed7-51dc-4a55-9949-b36c9de8a9fa-1782495170-17237cdf-batch-0000.zip`
- 导出内共 5 段对话；没有直接命名为 `TraceForge` 的项目对话。
- 与本项目方向最相关的是「简历分析和改进建议」：
  - Claude 建议未来重点做深 **Agent 工程 / Context Engineering / Advanced RAG / Eval / Observability**。
  - 6 个月路线表里建议做一个贯穿 3-6 月的旗舰 Agent 项目，并从第一天开始埋指标：工具调用成功率、延迟、token 成本、检索质量、对比实验。
  - 这个方向与当前 TraceForge PRD 的「AI Gateway + Agent Observability + Eval」高度一致，可视为本项目的外部动机来源之一。
- 「WebRTC 的定义和作用」对话与 TraceForge 不直接相关，只提供了一个可借鉴思路：项目要有可量化指标、对比实验和可演示闭环。

## 当前状态

- 已有文档已把项目定位收敛为：**AI 网关 + Agent 可观测平台**。
- `tasks/todo.md` 记录 Stage 0 / Stage 1 已完成，下一步进入 Stage 2 Trace 采集。
- 当前 Stage 2 已收口并通过验证：
  - `StreamCtx` / `proxy_response` 流式 tee 已完成。
  - 非流式、流式、usage、成本、失败/限流/fallback、可靠性指标均已落地。
  - `cargo check`、`cargo clippy -- -D warnings`、`cargo build --bins --examples`、`npx prisma validate`、`npm run build` 均通过。

## 总目标

把 TraceForge 做成一个能用于作品集和面试讲述的生产级最小闭环：

1. 客户端只改 `baseURL`，能通过 Rust 网关调用 OpenAI-compatible 模型。
2. 非流式与流式请求都能生成完整 `TraceRun + llm TraceSpan + TraceEvent`。
3. 控制台能筛失败、看链路、定责任域，兑现「一次失败的调用，3 步定位根因」。
4. Dashboard 能展示 token、成本、失败率、P95 延迟。
5. 内置一个示例多步 Agent，用 SDK / Trace API 上报 tool / workflow / review span，证明不只是单次 LLM trace。

## P0 · 先恢复可编译状态

- [x] 收口当前半开的流式 Trace tee 改动：
  - 定义 `StreamCtx`，承载 `TraceWriter`、`project_id`、`model`、`provider`、`input_text`、`started_at`。
  - 修改 `proxy_response` 签名，让它接收 `StreamCtx`。
  - 在不破坏 SSE 透传的前提下，把流式结束后的 TraceJob submit 出去。
- [x] 保持当前语义：流式响应仍边收边转，不整体缓冲后再返回客户端。
- [x] 验证：
  - `cd gateway && cargo check`
  - `cd gateway && cargo clippy`

## Stage 2 · Trace 自动采集落库

- [x] **T1 非流式 Trace 验证**
  - 确认一次非流式调用能写入 `TraceRun + llm TraceSpan`。
  - 字段包含：status、model、provider、input/output preview、latency_ms。
  - 验证：调用 mock/DeepSeek 后运行 `node scripts/verify-trace.mjs`。

- [x] **T2 流式 Trace + 事件**
  - 记录 `stream_start`、`first_token`、`chunk_count`、`stream_end`。
  - 首 token 延迟写入 metrics，chunk 数写入 TraceEvent payload。
  - 上游流中断记录 `stream_error`，客户端断开记录 `stream_cancelled`。
  - 验证：mock 上游覆盖正常流、首 chunk 后断、客户端中断。

- [x] **T3 usage 采集与估算兜底**
  - 非流式解析 `usage.prompt_tokens` / `usage.completion_tokens`。
  - 流式请求注入 `stream_options.include_usage=true`。
  - 客户端原本没请求 usage 时，剥离末尾 usage chunk，保证透传体验接近直连。
  - 拿不到 provider usage 时标记 `usage_source=estimated`，估算先用简单近似即可，后续再引入 tokenizer。
  - 验证：mock usage chunk / 无 usage 两类场景。

- [x] **T4 成本核算**
  - 按 `ModelPricing(provider, model, effective_from)` 选择有效价格。
  - 计算 prompt / completion 成本，写入 span/run cost。
  - run 级 `usage_source`：任一 span 为 estimated 即 estimated。
  - 验证：固定 token + 固定价格得到确定成本。

- [x] **T5 错误、限流、fallback 落库**
  - 鉴权失败 / 限流失败：写 failed TraceRun，不创建上游 span。
  - 上游失败：写 failed llm span + 标准 error_code。
  - fallback：首 chunk 前切换时写 `fallback_triggered`；全部失败写 `fallback_failed`。
  - 验证：invalid key、rate limit、mock fail_before、mock mid-stream failure。

- [x] **T6 写入可靠性与指标**
  - 队列满时丢弃整条 TraceJob，并增加丢弃计数。
  - 写库失败时重试有限次数；MVP 可先日志 dead-letter + metrics，不引入消息队列。
  - `/metrics` 补齐 `trace_queue_depth`、`trace_write_failed_total`、`trace_dropped_total`。
  - 验证：人为断开 DB，确认模型响应不被 Trace 写入拖垮。

## Stage 2.5 · Trace API / Node SDK / 示例 Agent

- [x] Rust 数据面托管 `/api/traces/*`，只认 project API Key，不走 NextAuth。
- [x] 提供最薄 Node SDK：
  - `startRun`
  - `startSpan`
  - `endSpan`
  - `endRun`
- [x] 做一个示例写作 Agent：
  - 选题 → 抓取资料 → 成文 → 审稿 → 保存草稿。
  - LLM 调用走网关自动 llm span。
  - tool / workflow / review 通过 SDK 手动上报。
- [x] 验证：一次 Agent 运行在 DB 中形成父子 Span 树。

## Stage 3 · Console 让 Trace 可读

- [ ] Trace 列表页：
  - 过滤：status、error_code、model、时间范围。
  - 展示：model/provider、latency、tokens、cost、started_at。
- [ ] Trace 详情页：
  - Span 树 / 瀑布图。
  - 扁平高亮：失败、最慢、最贵。
  - 展开 span 可看脱敏 input/output preview、error_code、events。
- [ ] 责任域映射：
  - 根据 `span.type × error_code` 派生：模型 / 网络 / 限流 / 工具 / 业务 / 网关拒绝。
- [ ] 验证：用 3 条固定 fixture trace 演示「筛失败 → 看链路 → 定责任域」。

## Stage 4 · 成本与运行 Dashboard

- [ ] 项目维度指标：
  - request_count、success/failure count、failure rate。
  - token、cost、P95 latency。
  - 按 model/provider 维度拆分。
- [ ] UsageDaily 聚合：
  - 先用脚本或定时任务从 TraceRun / TraceSpan 聚合。
  - 后续再考虑更实时的写入路径。
- [ ] 验证：固定样本聚合结果与数据库明细对得上。

## Stage 5 · Prompt 版本与 Eval（后置，不抢主线）

- [ ] Prompt 版本管理：
  - 创建版本、diff、回滚。
  - 调用通过 `X-TraceForge-Prompt-Version` 或 SDK 字段关联版本。
- [ ] Eval：
  - Dataset / Case / Run / Result。
  - 先做 exact_match、contains、regex、json_schema。
  - LLM judge 和 manual_review 后置。
- [ ] 验证：改 Prompt → 跑 eval → 看到通过率和失败样本。

## 明确暂不做

- 不扩展 Claude / Gemini native adapter；继续只支持 OpenAI-compatible。
- 不做完整 OpenAI API parity；`/v1/responses`、embeddings、batch 后置。
- 不先做 Redis 分布式限流；内存 trait 已足够支撑单实例 demo。
- 不先做复杂 critical path 算法；Stage 3 只做失败 / 最慢 / 最贵扁平高亮。
- 不引入新依赖，除非该阶段明确需要并单独记录取舍。

## 建议节奏

- **第 1 周**：P0 + Stage 2 T1/T2，先让非流式和流式都能稳定落 Trace。
- **第 2 周**：T3/T4/T5/T6，把 usage、成本、错误、fallback、可靠性补齐。
- **第 3 周**：Stage 2.5，做 Trace API / SDK / 示例 Agent，形成多步 Agent 证据。
- **第 4 周**：Stage 3，做 Trace 列表与详情页，兑现「3 步定位根因」。
- **第 5 周**：Stage 4，补 Dashboard 和 UsageDaily 聚合。
- **第 6 周**：Stage 5 的最小 Prompt / Eval，加部署与演示材料。

## Review

- 已从 Claude 导出中确认：没有直接 TraceForge 对话；相关内容来自职业路线对「Agent 工程、可观测、Eval、旗舰项目」的建议。
- 已对照当前仓库：PRD、CONTEXT、README、tasks/todo 已经把该方向落成 TraceForge。
- 已验证当前代码状态：Stage 2 已完成，第一优先级转为 Stage 2.5 Trace API / Node SDK / 示例 Agent。

---

# 整改计划审查（2026-09-28）

> 状态：审查提案，尚未实施，不代表相关 Issue 已验收。只调整本地计划说明，未修改 GitHub Issue 或业务代码。
> 范围：以 GitHub #60「Next.js 16 规范整改与显式演示模式」及 #61–#72 为当前整改目标，同时核对本文件的历史 Stage 2 计划。

## 1. 可执行性结论与事实依据

**方向可行，但不能直接在当前 master 上按 #61 开始整套整改。必须先恢复并验证计划所依赖的完整代码基线。**

- 当前本地和远端 master 均为 d30b0c8；远端最后推送为 2026-06-26 01:34（Asia/Shanghai）。可见代码只有网关 MVP 和最小项目列表页。
- #23 的 Dashboard 完成记录引用 90fee1e，GitHub commit API 查不到该提交；#44 明确引用本地提交 2dc16a2；#37 引用 a5a6d08；#52 记录了后续高保真 UI 验收。这些是代码恢复线索，不是当前 master 的验收证据。
- #60–#72 仍为 Open。#61 的“无阻塞，可立即开始”与当前检出状态不符。
- 本地 Prisma validate、TypeScript 检查、Rust clippy 已通过；cargo test 实际执行 0 个测试。旧 CI 的 prisma db push --skip-generate 已在本地复现为不支持的参数；远端最近 CI 为失败。
- 保留原计划的合理边界：单管理员、显式 Demo Mode、持久化演示数据、保留全部看板功能；本轮不引入 Redis、持久化任务队列、独立 Worker 或新的视觉重做。

## 2. 必须补足的计划缺口

| 优先级 | 对应任务 | 缺口与影响 | 建议调整 |
|---|---|---|---|
| P0 | 全部，尤其 #61 | 当前没有 Dashboard、Chat、Prompt/Eval 等整改对象，无法验证“保持原功能” | 增加 B0：恢复代码、记录完整提交 SHA、确认可拉取分支并从干净检出验证。恢复失败时单独重排缺失功能，不能把重建成本混进整改票。 |
| P1 | #71、#62、#69、#70 | 环境契约留到部署阶段，但 Demo、认证、Chat、Eval 已提前依赖它 | 把 #71 拆为前置环境契约和末尾容器交付两个部分；前置部分明确变量、默认值、必填条件、超时预算与启动方式，优先复用现有配置函数。 |
| P1 | #61、#72 | 验证命令先建、CI 到最后才集成，过程中仍可能只有本机通过 | #61 即接入最小 CI；每票随实现增加对应行为测试，#72 只做同一提交的集成验收。补丁升级要记录具体基线、目标版本和锁文件差异。 |
| P1 | #62、#67 | Demo seed 被两个任务引用，但没有明确数据归属、生命周期和唯一验收入口 | 共用一份幂等 fixture/seed；只在显式演示或测试操作中写入隔离项目/库，不在页面读取失败时补数据。Demo 关闭时默认凭据必须不可登录，不能只清空表单。 |
| P1 | #63 | “集中到 DAL”容易扩大为重写所有数据层 | 只抽取真实重复的 Session/授权函数，敏感读取在调用处先校验；共享 Layout 负责外壳。不得新增 Manager、Repository、Provider 等通用层来包装单个查询。 |
| P1 | #65、#68 | 时间展示统一不等于统计分桶统一；Run/Span 联表也可能重复累计 | 先确定上海自然日、UsageDaily 分桶和指标分母，再写聚合。固定 fixture 覆盖跨日、多 Span、运行中、取消、失败、空值及 fallback。 |
| P1 | #69 | after() 只托管响应后的工作；当前验收缺少执行预算、进程退出和未落库 Run 的终止条件 | 明确尽力派发边界、Gateway 超时、轮询截止、失败/未确认状态和显式重试行为。不得承诺持久任务可靠性，也不得永久 pending。 |
| P1 | #66 | 即时流式 loading 与所有缺失资源都返回 HTTP 404 不能简单同时保证 | 区分未开始流式响应的真实 404 与流式响应后的 not-found UI；必须真实 404 的资源在响应开始前判断。已授权的预声明 Run 使用有截止时间的 pending，任意不存在 ID 不能伪装成 pending。 |
| P1 | #64、#70 | “重复提交不重复运行”缺少唯一键、状态抢占及崩溃后的规则 | 明确请求/Run ID 的幂等范围；复用唯一约束和条件状态更新。Gateway 网络调用放在数据库事务之外，结果用短事务落库；超时/中断后不能无限 running。 |
| P1 | #72 | 只写验证通过、关闭 Issue，仍可能再次出现成果无法拉取 | 每票附可拉取提交、验证命令及结果；最终从干净检出验证同一 SHA。未推送或无法复现时保持未交付状态。 |

## 3. 推荐执行顺序与依赖

保持现有任务编号，不新增一套重复功能清单。B0 是恢复基线的前置工作，不是新功能。

| 顺序 | 工作 | 开始条件 | 完成条件 |
|---|---|---|---|
| 0 | B0：恢复完整开发成果 | 可开始定位原开发机、工作区或提交备份 | 完整 SHA 与可拉取分支已记录；计划涉及的页面、Gateway Trace 写入、schema、脚本和 ADR 齐全；干净检出能运行。 |
| 1 | #71 前半：环境/运行契约；#61：质量基线 | B0 完成 | 锁定依赖版本；修复实际验证命令；最小 CI 与生产模式浏览器 smoke 可重复执行；记录既有失败，不能把失败当成基线通过。 |
| 2 | #62 Demo；#63 认证和共享外壳；#65 时间口径 | #61 与环境契约完成 | Demo 开关、默认凭据边界、每个敏感入口的授权、日期边界均有独立测试。#63 的授权部分不必等 Demo 界面完成，外壳集成验收再合并。 |
| 3 | #64 写入校验；#66 页面状态 | #63 完成；Chat pending 契约已在前置阶段明确 | 非法关联/重复提交/事务失败可验证；loading、错误恢复、缺失资源和 pending 不互相掩盖。 |
| 4 | #67 → #68：真实数据与聚合 | #62、#63、#65、#66 完成 | 演示/空库/故障三态真实；全量区间统计与固定明细一致；只有最近列表和选中详情限量。 |
| 5 | #69 Chat；#70 Eval | Chat 依赖 #62、#63、#66；Eval 依赖 #62–#65；均依赖前置环境契约 | 成功、拒绝、缺配置、超时和重复请求均得到约定结果；退出/重启不会留下无限等待的用户界面。 |
| 6 | #71 后半：standalone/容器；#72 集成验收 | 所有相关行为已逐票验证 | 同一提交完成 Node 与 Docker smoke、核心浏览器回归及文档核对；只有具备外部环境和实际证据时才能声称公网部署完成。 |

依赖修订要点：#61 增加 B0；#71 环境部分前移；#67 增加 #66；#69 增加 #66；#72 保留最终汇总，但 CI 不能等到 #72 才开始运行。以上是建议，尚未改写远端 Issue。

## 4. 开工前写清的验收契约

### 数据、时间与看板

- 上海日期范围采用左闭右开的 UTC 查询区间。例如 2026-09-28 对应 [2026-09-27T16:00:00Z, 2026-09-28T16:00:00Z)。持久化时间戳仍为 UTC，不能靠修改机器时区实现。
- 建议固定 UsageDaily.date 为上海统计日标签。若恢复代码当前使用 UTC 日桶，先核对其它消费者并在隔离环境重建；重建期间使用同口径的明细聚合，不得混用两种桶。发现无法兼容的消费者时先记录迁移决策。
- 开工时为每项 KPI 写清来源、时间字段、分母和空值策略。请求量按 Run 计；token/成本沿用恢复后验证通过的 Span/Run 契约，不能把已有 Run 汇总与 Span 再相加；多 Span 不得重复计请求。
- 平均延迟按有效样本加权；区间 P95 从同一筛选区间的有效样本计算，不能平均各日 P95，也不能用最近 N 条列表代替全区间。成本保持 Decimal 计算，null 不自动伪装为真实零值。
- 固定 fixture 至少包含：一个 Run 多个 Span、网关拒绝、fallback、跨上海零点、运行中/取消、空成本/延迟及真实空库。复用原验收口径；存在分歧时先记录差异再改实现。
- #68 的性能验收记录明确数据量、查询范围和运行环境；只对详情/最近列表设上限，汇总不得截断。记录查询计划与耗时基线后再设回归阈值，不凭空承诺响应时间。

### Demo、权限与页面状态

- 验证 Demo 开/关与开发/生产两组维度；Demo 关闭时默认演示密码不被服务端接受，也不能出现在 HTML 或客户端包中。正式部署可显式开启 Demo，沿用已确认产品决策。
- 页面、Server Action、Route Handler 分别验证匿名和失效 Session；共享 Layout、noindex 和隐藏按钮均不替代授权。Session 去重仅限同一请求，不能跨用户缓存授权结果。
- 分别验收“有演示数据”“无业务数据”“数据库故障”；不得把异常 catch 成空数组、零指标或演示曲线。
- #66 同时用 HTTP 检查和浏览器检查区分真实状态码与 not-found UI，不用一条模糊的“404 通过”覆盖两者。

### Chat 与 Eval

- #69 在返回 Run ID 前完成 Session、输入和必需配置校验。缺少 Key 不应返回一个注定不会启动的 pending 页面。
- Gateway 请求超时、响应后执行预算和页面轮询期限必须有数值并满足同一运行契约，在 Node 与 Docker 生产模式下验证。after() 受运行环境的执行时长约束，不能当作持久队列。
- 保持 Rust 写 Trace 的现有约定。Gateway 接受后展示实际 Run 状态；接受前失败或进程退出、尚无 Run 时，页面在截止后显示“未确认派发”及关联 ID，停止无限轮询，不虚构成功/失败 Trace。若要求每次派发失败都持久保存精确原因，需要另行明确最小控制面状态记录，不能靠内存变量冒充可靠记录。
- 不自动重复发送状态不明的付费请求；明确人工重试的 Run ID 和重复请求处理规则。补测 Gateway 未受理、已受理但响应丢失、进程重启三个边界。
- #70 的最大样本数、单次请求超时、总预算必须在实现前写成配置或常量并覆盖边界测试。明确全部成功、部分失败、总超时、待人工复核和中断后的汇总状态；超预算的迟到结果不能把终态覆盖回成功。
- 复用已存在的 EvalResult(evalRunId, evalCaseId) 唯一约束；整次 Eval 的幂等还需 Run 级 ID/状态约束，不能误认为逐样本唯一就解决了重复启动。必要的最小 schema 变更单独记录，不引入任务调度框架。

## 5. 验证与交付规则

- 测试环境使用真实 Next.js、隔离 PostgreSQL、真实 Rust Gateway 和 mock OpenAI 上游。仅替换外部模型，不用假 Gateway 绕过鉴权、Trace 写入和错误处理。核心回归不依赖真实 Provider Key 或付费调用。
- 建立验证环境时先准备隔离数据库与 schema，再编译使用 sqlx 宏的 Rust 目标；显式生成 Prisma Client。复用锁文件安装依赖；旧 CI 的无效 --skip-generate 参数必须修正。
- #61 先提交可运行的 lint、Next 路由类型生成、TypeScript、生产构建、Prisma 和最小 Playwright 检查；恢复后若已有实现则修补，不重新搭一套测试框架。
- 后续每票增加能捕获该问题的行为断言。cargo test 的“0 tests”不能算网关功能验收；截图只能证明视觉状态，不能替代数据库一致性、权限和后台任务验收。
- 每个交付记录包含：Issue、可拉取完整 SHA、执行命令、通过/失败结果、测试环境、必要截图或报告。关闭 Issue 之前先确保对应提交在可获取分支中。
- #72 从干净检出和隔离数据库验证同一 SHA；更新 README 的实际启动入口、已实现/未实现状态及当前任务索引。若仍没有完整代码，不能宣称整改、发布或部署完成。

## 6. 如果只能从当前 Stage 1 继续

这是代码无法恢复时的替代路线，不能与 #60–#72 的整改工作混在一起，也不据此直接重写已记录完成的功能。

- 先修改历史 T1 的前置：当前 AuthedKey 没有 projectId，而 TraceRun.projectId 必填，需要在可信 Key 查询结果中带出项目归属。
- 修正 T5 的鉴权拒绝范围：能识别所属项目的拒绝可以写项目 Trace；完全未知/缺失 Key 无法归属项目，应计网关指标/脱敏日志，不伪造项目来满足外键。
- 把有界队列、非阻塞入队、队列满丢弃、写入失败的有界重试及失败计数作为 T1 的基础验收；不要把“不阻塞主调用”的全部保障留到 T6。Run/Span 写入需避免半条孤立记录。
- T2/T3 加入 SSE 分片、UTF-8 跨块、缺失 [DONE]、usage 与内容分离、客户端取消验收。明确真实内容事件的首 token 延迟，不能直接等同于首个网络字节块。
- T4 先用固定定价和固定用量验算，再接看板；T6 完善压力、故障与重试耗尽验证。Stage 3/4 仍需单独交付，不能以 schema 或 seed 代替页面。

## 7. 审查来源与限制

- 本地：README.md、tasks/todo.md、prisma/schema.prisma、gateway/src/main.rs、package.json、next.config.ts、.github/workflows/ci.yml。
- 远端：RoyDust/TraceForge 的 #60–#72 完整规格及依赖；#23、#37、#44、#52 的完成记录仅作为恢复线索。
- Next.js 官方 after 文档：https://nextjs.org/docs/app/api-reference/functions/after 。官方说明其执行时长受运行环境预算约束，支持 Node/Docker；这不构成进程重启后任务仍能完成的保证。
- Next.js 官方 notFound 文档：https://nextjs.org/docs/app/api-reference/functions/not-found 。已开始流式响应后不能再改变已发送的 HTTP 状态。
- Next.js 官方认证文档：https://nextjs.org/docs/app/guides/authentication 。核对了敏感数据入口授权与 Layout 的职责边界。
- 官方文档已核对，但最终 API/配置仍须以恢复后锁定的 Next.js 版本再次验证。本审查未对尚未恢复的页面、后台派发或部署包声称测试通过。


## 整改实施进度（2026-09-29）

- 已恢复可拉取基线 ee8ae928dd2a250a62e767f2cc9fb35d8765af08。上方基线缺失结论为历史状态；本地 master 已快进，远端待最终验证后交付。
- #61 已完成，CI 36470710679 通过；#62–#72 在 codex/complete-console-remediation 实施。
- 测试沿用 #60 已确认的浏览器/HTTP、纯时间/校验/聚合边界；不引入 Redis 或 Worker。
