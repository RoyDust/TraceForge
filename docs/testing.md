# Console 验证与规格验收（#60–#72）

## 运行命令

需要 Node.js 22+、Rust stable、Docker 或 TEST_DATABASE_URL 指定的 PostgreSQL。先执行 npm ci、npm run db:generate、npx playwright install chromium。

| 命令 | 验证边界 |
| --- | --- |
| npm run lint | ESLint，警告也失败 |
| npm run typecheck | Next 路由 typegen 与 TypeScript，独立于 build |
| npm run test:unit | 8 个纯时间、校验、配置、百分位与六类 Eval 断言场景 |
| npx prisma validate | Prisma 数据契约 |
| npm run db:deploy | 在空库应用已提交迁移 |
| npm run build | 生产 standalone 构建 |
| npm run test:e2e | 真实 Node standalone + PostgreSQL + Rust Gateway + mock 上游，32 个 Chromium 场景 |
| npm run test:docker | 同一套 32 个场景，三个 Console 改为非 root Docker 容器 |
| npm run deploy:check | 当前运行环境的实际格式、必填项、禁用默认凭据、预算与 URL 校验 |
| npm audit --json | 独立记录依赖风险；不会强制回退框架 |

单场景运行：npm run test:e2e -- --grep "expired partial Eval"。报告：npx playwright show-report。失败保存截图与 Playwright trace；CI 上传浏览器报告、性能证据和审计 JSON。

## 隔离资源与实际调用链

scripts/run-e2e.mjs 创建随机 traceforge_e2e_<id> schema，依次部署 migration、运行共享 seed、重建 UsageDaily、编译真实 Rust Gateway。未配置 TEST_DATABASE_URL 时还拥有一个临时 PostgreSQL 容器；不会把开发 DATABASE_URL 当作测试目标，也不会重置用户数据库。

Playwright 启动真实 Gateway、Rust mock_upstream，以及普通管理员、Demo 默认账号、缺少 API Key 三种 Console。只有外部模型响应被 mock，鉴权、网络转发、Trace 写入、页面查询、Server Actions 和费用计算均走真实实现。测试固定账号仅注入隔离测试进程。

Docker 模式实际运行相同 Node standalone 镜像，检查 UID 1001，验证静态资源 HTTP 200。Linux host 网络上的 Console 仍只监听回环地址；macOS / OrbStack 通过 host.docker.internal 访问 Gateway 和 PostgreSQL。Demo 实例特意注入未注册的 Chat Key，测试网关未受理场景；Node 测试新客户端重连，Docker 测试真实重启 Console 后仍能根据签名凭据显示截止状态。

任何测试结果下都尝试删除本次 schema 和本次容器。非“资源不存在”的清理失败导致非零退出码。数据库故障、SQL 触发器回滚、锁等待和中断 Eval fixture 只允许注入本轮拥有的 schema，业务断言通过浏览器/HTTP 完成。

## #60 用户故事覆盖矩阵

| 故事 | 自动验证或审查证据 |
| --- | --- |
| 1–4：Demo 默认凭据、独立开关、标识、关闭不预填 | remediation 中 Demo 模式与生产登录；contracts 单元测试拒绝明文/哈希演示与占位密码；Node 与 Docker 均执行 |
| 5–6：持久化 demo、数据库故障不造数 | 共享 seed + 聚合；空区间保持零/未知；rename table 故障呈现真实错误并重试恢复 |
| 7–10：读/写授权和共享外壳 | 匿名/过期 Session、POST/GET 401、已渲染表单提交前注销；侧栏导航/折叠；双轴审查检查 server-only DAL 与每个入口 |
| 11–13：loading、错误、404 | 持有 PostgreSQL 表锁时显示 loading；恢复数据库后重试成功；四类详情 not-found + 缺失路径 404；global-error 独立 HTML/body 经构建与代码审查，未对根布局注入运行时故障 |
| 14–17：完整聚合与有限明细 | 全面板/空数据；上海边界固定金额与多 Span；2000 Run + 4000 Span fixture；最近 9 Run 上限；无 Span 网关限流；真实 fallback、stream_interrupted |
| 18–20：Chat 托管派发与失败可见 | 预声明 Run ID 一致；重复 Run 409；正常及中断 SSE；连续两轮浏览器对话；未注册 Key 的 pending 到期 410；已接受超时停止等待；Docker 进程重启；无 Redis/独立 Worker |
| 21–23：Eval 预算、幂等、失败关闭 | 样本超限、单次与总预算、重复请求 ID、缺少 Chat/Eval Key；过期任务回收；费用/耗时保留、部分失败仍可人工复核 |
| 24–26：业务错误、归属、事务 | 非法 JSON/字段/UUID；Prompt 与 Eval 父关联；复核真实其它 Run 结果被拒绝；创建 Prompt 时注入激活失败证明回滚；双标签页同一版本提交 |
| 27–28：时间语义 | 跨上海年/月/日、闰日、非法/倒序日期；固定边界 Run/Span 聚合；Chat API ISO UTC |
| 29：noindex | 登录与受保护页面 metadata 检查 |
| 30–31：部署契约与镜像 | deploy:check 实际校验；Docker UID 1001、standalone 静态资源、三种运行配置全套浏览器回归 |
| 32–34：独立质量闸门与纯函数 | CI：lint、typegen/TypeScript、build、Prisma、SQLx 编译、unit 与 E2E；Deploy Readiness：Docker 全套 |
| 35–36：兼容补丁与审计 | Next 16.3.6 与锁文件；审计记录独立评估；未执行 audit fix --force，未迁移 React/Prisma 主版本 |

流式 loading 可能先发送 HTTP 200，因此标准 not-found 页面与尚未响应时的 HTTP 404 分别验证，不把两者混为一谈。

## 聚合与性能证据

getDashboardData 使用 PostgreSQL 全量区间聚合，并在 RepeatableRead 快照内读取摘要、日趋势、模型治理、最近明细及 UsageDaily。请求数先按 Run 统计，防止 Span/Event 联表重复；P95 使用同一范围全部非空延迟；成本以 Decimal 汇总；明细为 9 Run / 每 Run 20 Span / 每 Span 10 Event。

2026-09-29 本地 Node standalone / PostgreSQL 16 / Chromium 的一次实际测量：2000 Run、4000 Span、14 个上海日、展示 9 Run，浏览器导航至 KPI 断言完成 236ms。代表性 Run count/cost/P95 查询使用 trace_run_project_id_started_at_idx，EXPLAIN ANALYZE 执行 0.388ms。后者只是代表性摘要 SQL，不是整页所有查询总耗时，也不是生产 SLA。每次规模测试都会输出并附加实际计划与新测量，不设置无依据的硬阈值。

## 审查与故障修复

Standards 审查发现并修复：空项目刷新 UUID 错误、无 Span 限流漏计；Docker follow-up 修复 Linux 监听范围和清理错误退出码。

Spec 审查发现并修复：过期 Eval 丢汇总、部分失败封死人工复核、fallback 缺终点、按初始模型错计 fallback 费用；follow-up 统一过期回收/收尾事务父 Run → 子结果的加锁顺序，并对批次按 ID 排序。没有新增服务层或调度基础设施。

## 依赖审计

2026-09-29 重跑 npm audit --json：0 critical、4 high、0 moderate。仍来自 Prisma 工具链传递依赖；npm 提议的完整自动修复会跨主版本回退到 Prisma 6.19.3，未采用。详见 [依赖审计记录](verification/issue-61-dependency-audit.md)。功能验收通过不代表这些上游风险已经消除。

## 2026-09-29 最终验收记录

验收提交：`474684384199aa04e4d7aaab0ab0459439f40e85`，已推送到 `codex/complete-console-remediation`，通过 [PR #73](https://github.com/RoyDust/TraceForge/pull/73) 交付。独立 worktree 使用 `npm ci --registry=https://registry.npmjs.org --no-audit` 安装依赖，受版本控制文件无修改；复用 Cargo 构建缓存，但每轮仍执行真实 Gateway 编译与隔离 PostgreSQL migration。

| 验证 | 干净检出结果 | GitHub 同版本证据 |
| --- | --- | --- |
| lint、Next typegen / TypeScript、Prisma generate / validate、生产 standalone 构建 | 全部通过 | [CI 36534950758](https://github.com/RoyDust/TraceForge/actions/runs/36534950758) |
| 纯函数与配置单元测试 | 8 / 8 通过 | 同上 |
| Node standalone 浏览器回归 | 32 / 32 通过，1.0 分钟 | 同上，32 / 32，1.1 分钟 |
| 非 root Docker 浏览器回归 | 32 / 32 通过，1.1 分钟 | [Deploy Readiness 36534950608](https://github.com/RoyDust/TraceForge/actions/runs/36534950608)，32 / 32，1.1 分钟 |
| SQLx 编译、数据库迁移、部署环境校验 | 本地及对应 CI 步骤通过 | 上述两个工作流；[push CI 36534945535](https://github.com/RoyDust/TraceForge/actions/runs/36534945535) 也通过 |

Node 与 Docker 均使用真实 PostgreSQL、Rust Gateway 和 mock OpenAI 上游；Docker 场景包含实际重启 Console 后的未确认派发截止恢复。每轮测试 schema 与测试容器均正常清理。修复锁文件中唯一内网 tarball 地址后，公共 npm registry 安装及 GitHub 安装步骤均通过，包版本和 integrity 不变。

本地保留数据完成迁移后，实际登录治理看板并验证 Chat → Gateway → mock 上游 → Trace 成功；1280 / 1440 / 390 视口检查 KPI 数值完整可见。其后交付提交仅补充验收记录，最终 PR head 再执行同套 GitHub 检查，合并以该 head 检查成功为前提。

## 交付边界

最终验收以可拉取提交、干净检出运行及 GitHub CI 的同版本结果为准。未经实际执行，不声称公网部署、真实 Provider 付费调用或跨进程持久任务已经验收。Node/Docker 运行日志、截图、查询计划和依赖 JSON 作为验证证据保留，Issue 关闭附对应提交和运行结果。
