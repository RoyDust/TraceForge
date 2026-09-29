# #61 依赖审计记录

## 采用的版本与修复

Next.js 与 eslint-config-next 固定为 16.3.6。原定 16.2.10 仍触发 critical 告警，升级范围已获确认。锁文件同步提交，CI 使用 npm ci 复现安装。

执行过 npm audit fix，未使用 --force。兼容的传递依赖修复后，Prisma CLI 更新至 7.10.0；@prisma/client 和 @prisma/adapter-pg 同步至 7.10.0，避免工具与运行时版本错位。React 保持 19.2.7，Prisma 保持 7.x，没有主版本迁移。

## 审计快照（2026-09-28 UTC）

复核命令：npm audit --json、npm ls @prisma/client @prisma/adapter-pg prisma @prisma/config deepmerge-ts mysql2 --all。

| 阶段 | Critical | High | Moderate | 合计 |
| --- | ---: | ---: | ---: | ---: |
| Next.js 16.2.10 验证基线初次安装 | 1 | 12 | 6 | 19 |
| Next.js / eslint-config-next 16.3.6 | 0 | 9 | 6 | 15 |
| 兼容依赖修复后的锁文件 | 0 | 4 | 0 | 4 |

npm 按受影响的包节点计数；剩余 4 项不是 4 个独立漏洞。它们涉及 3 条 advisory，其中 mysql2 的解压缩告警为 moderate，但该包因另一条 high 告警被归入 high。

| 包 | 当前版本 | 依赖路径 | 原因与处理 |
| --- | --- | --- | --- |
| deepmerge-ts | 7.1.5 | prisma → @prisma/config → deepmerge-ts | 递归对象合并可能导致栈耗尽；受影响范围 <8.0.0。暂不覆盖 Prisma 声明的依赖主版本。 |
| @prisma/config | 7.10.0 | prisma → @prisma/config | 继承 deepmerge-ts 告警。 |
| mysql2 | 3.15.3 | prisma → mysql2 | 认证插件降级可能泄露明文凭据；压缩协议解压可能导致资源耗尽。 |
| prisma | 7.10.0 | 直接开发依赖，同时被 @prisma/client 的可选 peer 引用 | 汇总上述传递依赖告警。 |

对应 advisory：

- GHSA-ggr8-5vv4-36mx：DeepmergeTS has stack exhaustion when merging recursive object graphs。
- GHSA-3f6p-5ww8-9rcr：MySQL2 authentication plugin downgrade。
- GHSA-rgwj-5xj2-c3m3：MySQL2 unbounded compressed-protocol inflate。

这些告警来自 Prisma 工具链。当前应用通过 @prisma/adapter-pg 连接 PostgreSQL，未配置 MySQL；这降低了 mysql2 路径在本项目中的暴露范围，但不等于依赖已修复。Prisma 配置来自仓库内的 prisma.config.ts。仍需在 Prisma 发布兼容修复后重新审计和验证，不把安装范围或开发依赖分类作为风险豁免。

npm 建议的自动完整修复会安装 prisma@6.19.3，属于跨主版本回退，不符合本次兼容性约束。没有执行该命令，也没有添加未经验证的 overrides。

ESLint 使用与当前 Next 配置兼容的 9.39.5；安装器提示该分支已停止支持。升级 ESLint 主版本需要另行验证配置和插件兼容性，不在本次强行迁移。

## CI 行为与后续处置

功能闸门独立执行 lint、typecheck、build、Prisma 校验、Rust 编译与 Playwright。依赖审计使用独立步骤输出 dependency-audit.json，即使有告警也保存为 verification-evidence artifact，保留 7 天。审计步骤不是安全无漏洞的通过承诺。

后续处理：关注 Prisma 对 deepmerge-ts / mysql2 的依赖更新，以及 ESLint 受支持版本的兼容性。修改锁文件后重新执行本基线。#61 的验收是提供可评估审计与验证命令，不是消除所有上游告警。


## #72 复核（2026-09-29）

相同锁文件重新执行 npm audit --json，仍为 0 critical、4 high、0 moderate、4 total；建议修复仍指向 Prisma 6.19.3 的跨主版本回退。未执行强制修复。Console 交付采用 standalone；不以运行镜像裁剪替代对上游工具链风险的跟进。

## #79 后续修复（2026-09-29）

本轮显式将 Prisma 7.10.0 工具链的 deepmerge-ts 覆盖为 8.0.2、mysql2 覆盖为 3.24.4，没有回退 Prisma 主版本。Prisma 配置加载、Client 生成和隔离 schema 迁移已经验证。npm audit 当前为 0 vulnerabilities，后续以锁文件和 CI 复核。

ESLint 升为 10.11.0。React / JSX a11y / import 插件仍声明 ESLint 9 peer，通过仅这三项的 peer override 配合官方 @eslint/compat 2.1.1 保留已有规则；Next 内置 Babel scope manager 不支持新接口，统一改用已经声明支持 ESLint 10 的 typescript-eslint 8.71.0 parser。未禁用规则，也未修改 node_modules。全仓 lint 和 typecheck 已通过；后续插件原生支持后可以移除兼容配置。Node 最低版本明确为 22.13。
