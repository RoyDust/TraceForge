# #75–#80 交付验收（2026-09-29）

## 范围
Agent Trace API、最小四方法 Node SDK、写作 Agent、真实 LLM Judge、离线 Gateway 构建、生产部署准备和工具链修复。公网服务器/域名尚无，按用户要求不进行公网发布。

## 自动验证
- npm run test:unit：9 / 9，通过真实 HTTP 断连验证示例不会重发状态不明的结束操作。
- npm run test:e2e：40 / 40，隔离 PostgreSQL schema、真实 Rust 进程与浏览器。
- npm run test:docker：40 / 40，实际运行预编译非 root Gateway/mock 和三种 Console 容器。
- npm run lint / typecheck / build / deploy:check：通过。
- cargo test：编译通过；当前没有独立 Rust 单元用例，行为测试通过 HTTP/E2E 覆盖，不把零用例算成额外测试。
- cargo sqlx prepare --check -- --bins --examples：在线 metadata 对账通过。
- SQLX_OFFLINE=true，DATABASE_URL 指向不可达端口，cargo check --bins --examples：通过；Docker builder 同样离线构建。
- npm audit：0 critical / 0 high / 0 moderate / 0 low；npm ls 检查依赖覆盖无 invalid 节点。
- 生产 Compose config 校验、nginx -t、本地自签名 HTTPS 登录 200、HTTP→HTTPS 308、外部 /gateway/metrics 404：通过。临时 Nginx 与证书已清理，自签名验证不代表公网证书已签发。

## 真实中转
- 模型 deepseek-v4.1-flash。写作 Agent Run fb6b4a4e-23f9-444e-9d57-f7a40efbe594 成功，9 个 Span（3 次自动 LLM + 6 个手工 workflow/tool/review），累计 13,615 Token，真实执行资料抓取和草稿文件写入。
- Judge Eval Run 3caa6579-c709-4e46-93f1-09d82cc7ac66 执行完成。候选模型误答 Gateway 使用 Go；真实评审模型对照 Rust 参考答案给出 0 分及理由。样本 failed 是质量判断结果，不是执行失败。
- 两条链路成本均为未知；未向数据库写入猜测的中转单价。真实密钥未进入源码、文档或日志。

## Standards
初审 1 项：示例的成功结束写入在业务 catch 中，网络响应丢失会重复提交 failed。已将成功结束移出 catch，未知结果时停止上层写入，并添加真实 HTTP 断连回归。5660eaf 复核关闭。

## Spec
初审 2 项：拒绝请求未同步预留 ID 的竞态，以及混合数据集将已知费用小计误报总额。分别通过同步预留+writer 归属/终态约束、未知费用传播修复；跨项目竞态和混合费用浏览器回归通过。5660eaf 复核关闭。

## 尚缺外部输入
仅 #80 的实际中转费率无法从公开来源确认，保留 needs-info。官方缓存/峰谷价只是参考。Redis、分布式限流、持久队列、独立 Worker、多用户与 Chat 历史仍按既有计划后置。

## CI 安装来源修复
首次远端 CI 在 npm ci 阶段退出。锁文件中新升级的 32 个包指向本地公司内网源，公网 runner 无法访问。在 Node 22 / npm 10 的隔离容器中阻断该内网域名，复现同一 Exit handler never called 错误；将这 32 个 tarball 地址改为 registry.npmjs.org 后，同一命令成功安装 1,060 个包。所有版本、integrity 哈希和依赖关系完全不变。项目 .npmrc 固定公网源，避免后续更新再次写入内网地址。

交付 PR：https://github.com/RoyDust/TraceForge/pull/81 。最终提交的 CI 结果与主线合并状态以该 PR 的 GitHub 检查/合并记录为准，不将首次失败或旧提交检查计作最终通过。
