# 验证基线（#61）

## 前置与命令

Node.js 22+、Rust stable，以及 Docker 或可连接的 PostgreSQL。先运行 npm ci 和 npm run db:generate。Prisma CLI 读取根 .env 中的 DATABASE_URL；CI 显式注入自己的测试配置。

| 命令 | 验证内容 |
| --- | --- |
| npm run lint | Next.js Core Web Vitals 规则；警告也导致失败 |
| npm run typecheck | 先生成 Next 路由类型，再检查应用、配置与测试的 TypeScript |
| npm run build | 常规生产构建 |
| npx prisma validate | Prisma schema 与配置 |
| npm run test:e2e | 独立测试环境中的 Chromium 行为验证 |
| npm audit --json | 输出依赖审计，非零退出码表示存在告警 |

## 浏览器测试环境

首次安装浏览器：

~~~sh
npx playwright install chromium
npm run test:e2e
~~~

未配置 TEST_DATABASE_URL 时，测试脚本通过 Docker 启动临时 PostgreSQL 16 容器，并自动分配本机端口。CI 同时验证这条自动启动路径。

没有 Docker 时，可使用已有 PostgreSQL。账号需要在指定数据库内创建和删除 schema 的权限：

~~~powershell
$env:TEST_DATABASE_URL = "postgresql://user:password@localhost:5432/test_database"
npm run test:e2e
~~~

脚本不自动使用开发 DATABASE_URL。传入 TEST_DATABASE_URL 后也只创建并操作本次生成的 traceforge_e2e_<随机标识> schema；不重置数据库，不清空已有 schema。测试成功或失败后均删除本次 schema；自行启动的容器也会删除。

测试使用固定的演示登录数据：smoke@example.com / e2e-local-password。这些凭据只注入测试进程。测试项目名为 Playwright baseline。

真实 Next.js 生产服务器与现有 Rust mock_upstream HTTP 服务由 Playwright 启动和回收。测试构建写入 .next-e2e，端口自动分配，不复用已运行的 Console。Rust mock 在这个边界上充当 mock Gateway；后续 #69/#72 补齐真实 Gateway 的完整 TraceRun 派发验收。

## 已覆盖的行为

- 匿名访问受保护 TraceRuns 页面时进入登录页。
- 正确登录后能读取 PostgreSQL 中的测试项目，退出后重新访问仍需登录。
- 错误密码无法进入 Console。
- 侧栏折叠状态在刷新后保留。
- mock Gateway 通过真实 HTTP 返回 OpenAI-compatible 响应。

单独执行一个场景：

~~~sh
npm run test:e2e -- --grep "administrator"
~~~

查看报告或只列出场景：

~~~sh
npx playwright show-report
npx playwright test --list
~~~

playwright-report、test-results、.next-e2e 均已忽略。失败时保留截图和 trace；GitHub CI 上传测试报告及依赖审计 JSON，保存 7 天。

## 版本与审计约束

原计划的 Next.js 16.2.10 在实施时仍被审计为 critical。经本轮确认，Next.js 与 eslint-config-next 统一固定为 16.3.6。React、Prisma 不做主版本迁移，不执行 npm audit fix --force。

审计结果及未解决告警的处置见[依赖审计记录](verification/issue-61-dependency-audit.md)。审计单独记录，CI 不把“功能验证通过”视作“依赖没有风险”。
