# TraceForge 部署契约

本仓库交付可验证的 Node / Docker 部署包。公网发布仍需真实服务器、域名、TLS 和运维密钥，本地验收不代表已经完成公网发布。

## 环境变量

| 变量 | 条件与默认值 |
| --- | --- |
| DATABASE_URL | 必填 PostgreSQL URL；Console 的非 public schema 用 ?schema=名称，Gateway 用 options/search_path |
| DEMO_MODE | 只允许 true / false，默认 false，与 NODE_ENV 无关 |
| ADMIN_EMAIL、ADMIN_PASSWORD_HASH | Demo 关闭时必填；支持 plain:、sha256: 或 64 位 SHA256。Demo 开启且未配置时默认 demo@traceforge.local / traceforge-demo |
| MASTER_ENCRYPTION_KEY | seed 和 Gateway 必填，32 字节 base64 AES-256-GCM Key；换 Key 前必须迁移已有加密 Provider 凭据 |
| TRACEFORGE_CHAT_GATEWAY_URL | 默认 http://localhost:8787；仅无内嵌凭据、query、fragment 的 HTTP(S) URL |
| TRACEFORGE_CHAT_API_KEY | Chat 必填，无源码默认值；必须已在数据库 ApiKey 中注册 |
| TRACEFORGE_CHAT_TIMEOUT_MS | 默认 30000，范围 1–120000 |
| TRACEFORGE_EVAL_GATEWAY_URL、TRACEFORGE_EVAL_API_KEY | Eval URL 同上；API Key 必填，无源码默认值 |
| TRACEFORGE_EVAL_TIMEOUT_MS | 默认 30000，范围 1–120000 |
| TRACEFORGE_EVAL_MAX_CASES | 默认 20，范围 1–100 |
| TRACEFORGE_EVAL_TOTAL_TIMEOUT_MS | 默认 120000，范围 1–300000；总预算优先于单次预算 |
| TRACEFORGE_DEMO_UPSTREAM_URL | 仅 seed 使用，默认 http://localhost:8799/v1；Compose 内填 http://mock-upstream:8799/v1 |
| GATEWAY_ADDR、MOCK_ADDR | Gateway / mock 上游监听地址；Compose 使用 0.0.0.0:8787 / :8799 |

生产模式 Session cookie 标记 Secure，非 loopback 访问必须使用 HTTPS。Demo 关闭时演示/占位密码及其哈希均拒绝，缺少 Chat/Eval Key 会在创建任务前明确报错。通过部署秘密存储注入自有长密码与 Key，不把真实秘密写进 Dockerfile、镜像或 Git。认证模型保持单管理员；SHA256 格式是现有兼容格式，不宣称具备多用户密码系统能力。

~~~bash
npm ci
npm run db:generate
npm run deploy:check
~~~

校验命令读取 .env 或已注入的环境，检查实际类型、格式、默认凭据冲突和超时范围，且不输出秘密。它不连接网关，实际连通性由 smoke test 和 /readyz 验证。

## 数据库初始化与旧库升级

新库：

~~~bash
npm run db:deploy
~~~

旧版使用 db push 建表、尚无 Prisma migration 历史的库不能直接重放首次完整迁移。先备份并在副本验证：

~~~bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > upgrade.sql
# 人工核对 upgrade.sql，只执行确认需要的增量变更；禁止未经核对的 DROP / 数据丢弃
npx prisma db execute --file upgrade.sql
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
# 差异为空后，将已存在的结构标记为基线，不重新执行完整建表 SQL
npx prisma migrate resolve --applied 20260929000000_console_baseline
npm run db:deploy
~~~

此次 EvalRun 新增 deadline_at；完整迁移仍保留其它现有实体。已有 migration 历史或结构不同的库应先审查历史和差异，不能盲目 resolve。后续结构变更生成新 migration，不改写已应用的 SQL。

演示数据与 UsageDaily 聚合从工具机运行（standalone 运行镜像不包含 Prisma CLI）：

~~~bash
DEMO_MODE=true npm run db:seed
npm run usage:aggregate
~~~

聚合默认重建最近 14 个上海自然日，可通过脚本的 --from=YYYY-MM-DD --to=YYYY-MM-DD 调整；切换旧 UTC 日桶时重建对应日期段。保留真实 Trace 源数据。

## 普通 Node standalone

~~~bash
npm run build
cp -R .next/static .next/standalone/.next/static
# 在此进程注入与校验时一致的环境变量；Node 本身不会自动加载仓库根 .env
node --env-file=.env .next/standalone/server.js
~~~

设置 HOSTNAME=0.0.0.0、PORT=3000 供反代访问。运行时可以切换 Demo，不需要重新构建；有管理员配置的 Demo 使用配置值，只有未配置时启用默认演示账号。

## Docker / Compose

Console Dockerfile 的 builder 安装构建依赖并生成 Prisma Client；最终镜像只复制 standalone 与静态资源，以 UID 1001 运行。数据库初始化由宿主机或专门的发布步骤完成，不尝试在精简运行镜像中执行 npm / Prisma CLI。

~~~bash
# .env 的 DATABASE_URL 供宿主机 CLI 使用；Compose 会为服务注入 postgres:5432
# 如果 5432 已被占用，先调整 Compose 的宿主机端口和 .env，勿停用无关数据库
# 第一步只启动数据库

docker compose up -d postgres
npm run db:deploy
# 演示环境可选，seed 写入容器内 Gateway 能访问的上游地址
DEMO_MODE=true TRACEFORGE_DEMO_UPSTREAM_URL=http://mock-upstream:8799/v1 npm run db:seed
npm run usage:aggregate
# 第二步启动完整服务

docker compose up --build -d
~~~

Compose 暴露 Console 3000、Gateway 8787、mock 上游 8799。仅演示环境启动 mock；正式 Provider 的 URL 与加密凭据单独配置。当前 Gateway 镜像启动时 cargo run --release，SQLx 编译需要已经准备好的数据库；这会增加冷启动时间。尚未声称交付离线编译的精简 Gateway 镜像。

~~~bash
npm run test:docker
# 可复用已经构建的同版本镜像；否则测试脚本自动构建
TRACEFORGE_E2E_IMAGE=traceforge-console:my-sha npm run test:docker
~~~

Docker smoke 实际运行 normal、Demo、missing-key 三个 Console 容器，验证 UID 1001、登录、静态资源、看板、Chat、Eval 与故障边界；连接隔离 PostgreSQL、真实 Rust Gateway 与 mock 上游。Linux 使用 host 网络；Docker Desktop/OrbStack 使用 host.docker.internal，自动清理本轮容器和 schema。

## TLS、代理和启动验收

deploy/nginx/traceforge.conf 提供反代示例：/ 到 Console，/gateway/ 到 Gateway，SSE 关闭缓冲。替换示例域名，配置真实证书与 HTTPS 跳转，并按实际 Chat/Eval 预算配置代理读取超时。Eval 最大总预算为 300 秒，默认 120 秒；平台请求时限低于预算时需要下调预算。

1. /healthz 返回 ok，/readyz 返回 ready；只检查存活不代表数据库可用。
2. 打开 /login，确认 Demo 开关与账号展示符合预期；匿名 /dashboard 跳回登录。
3. 登录访问 /dashboard、/traces、/prompts、/evals，确认数据、空态和日期范围。
4. Chat 选 mock-ok 发送，进入对应预声明 Run；mock-mid 验证流式失败。
5. Eval 用 demo 数据集运行，查看输出、费用、结果和重复提交行为。

Chat after() 不跨进程重启恢复；未确认派发在调用超时加 10 秒后停止等待，不能自动重发状态不明的付费请求。Eval 不使用后台 Worker；超期 running 在后续页面读取时转为失败并汇总已有结果。所有这些限制都应在应用运行预算内验收。
