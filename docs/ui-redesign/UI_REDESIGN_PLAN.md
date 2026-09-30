# Base UI 重构执行计划

更新：2026-09-30。本轮替代旧版模拟数据/深绿三栏设计，不修改 Gateway 与数据库。

- [x] 核对已实现功能，重写当前功能 PRD。
- [x] 确定视觉系统、信息架构与真实数据约束。
- [x] 改造 Base UI 共享交互与导航壳层。
- [x] 重构看板信息层级、趋势和运行表格。
- [x] 统一 Trace、Chat、Prompt、Eval、登录与空态样式。
- [x] 验证键盘、移动端和主流程，完成回归与截图。

完成以实际页面、自动化结果和截图为准，不以仅生成静态图片作为交付。


## 实际交付与验收（2026-09-30）

- 共享 Button、Input、Tooltip 接入 Base UI；导航保持真实链接语义，键盘 Enter 与侧栏折叠持久化通过。原生 select 与现有业务表单继续保留。
- 治理总览改为四个主指标、每日请求/失败趋势、三个辅助指标、最近运行、成本/健康与治理事件。查询与未知成本口径保持不变。
- 顶栏搜索真正跳转到带项目和名称/模型/供应商条件的 Trace 列表，删除未实现的通知、列设置、密度等入口。
- Trace 瀑布图刻度按实际跨度时长计算；移除固定涨跌数字，将最慢跨度正确标识，未伪装成 P95。
- Prompt 详情改为自然页面滚动，差异与评测内容不再挤压；移除无依据的发布检查“通过”状态及误用汇总结果的数据集列。
- Chat 设置提前，Prompt/Eval/登录共用字体、表单、边界与间距。没有更改 Gateway、Prisma schema、认证或付费模型执行逻辑。

| 检查 | 结果 |
| --- | --- |
| TypeScript / ESLint / 生产构建 | 通过 |
| 单元测试 | 9 / 9 通过 |
| 全套 E2E | 44 / 44 通过（原有 43 + 新增键盘搜索） |
| 最终呈现修正后的定向 E2E | 6 / 6 通过 |
| 1440 / 980 / 390px 看板 | 浏览器实测，无页面横向溢出 |
| 390px Trace / Chat / Prompt / Eval | 浏览器实测，无页面横向溢出 |
| 桌面页面与真实搜索 | 浏览器实测；DeepSeek 关键词返回 7 条已有运行 |

截图来自本地真实数据库页面（演示标识保留），未向付费模型提交新请求：

- [桌面看板](screenshots/dashboard-1440.png)
- [平板看板](screenshots/dashboard-980.png)
- [手机看板](screenshots/dashboard-390.png)
- [追踪工作台](screenshots/traces-1440.png)
- [对话调试](screenshots/chat-1440.png)
- [提示词版本详情](screenshots/prompt-detail-1440.png)

本次没有执行公网部署，也没有新增价格或团队权限能力；这些边界见当前功能 PRD。

## 第二轮：管理工作台完善（2026-09-30）

参考已核验的官方源码：sub2api 的分组导航、紧凑统计与范围筛选，以及 CPA Management Center 的运行摘要、流量主视图与操作入口。只借鉴信息组织，不引入账户充值、凭证管理等现有产品没有的能力。

- [x] 导航按监控/开发分组，突出当前位置，统一顶栏、账号区与可折叠侧栏。
- [x] 看板调整为范围工具栏、核心指标、可切换用量图、异常摘要与运行明细；增加今天/7天/30天快捷筛选和按日下钻。
- [x] Prompt/Eval 列表优先展示内容，创建表单按需打开；完善搜索与空态。
- [x] 统一细节页面与 Chat 的操作密度，清理旧样式覆盖。
- [x] 回归测试、桌面/窄屏浏览器验收、截图，提交并同步现有分支。

设计：石墨色侧栏、浅灰画布、白色内容面板、蓝色主操作。以表格和分隔线组织密集数据，减少同权重卡片；正文 14px、标题 28px、关键数字 30px，沿用 Geist 与中文系统字体。图表只使用当前范围的真实每日汇总；缺失价格保留未知，不显示无依据的实时状态或趋势。

参考：
- https://github.com/Wei-Shaw/sub2api/blob/main/frontend/src/components/layout/AppSidebar.vue
- https://github.com/Wei-Shaw/sub2api/blob/main/frontend/src/views/admin/DashboardView.vue
- https://github.com/router-for-me/Cli-Proxy-API-Management-Center/blob/main/src/features/dashboard/DashboardPage.tsx


### 第二轮浏览器验收

- 桌面 1440px：看板、Trace、Prompt、Eval、Chat 均实测；主操作对比度、侧栏折叠、图表键盘切换通过。
- 看板 980px 与全部五页 390px：文档宽度不超过视口；五个导航入口完整，图表/表格在自己的容器内滚动。
- 按日下钻保留当天起止日期；提示词搜索 demo-support 返回现有的一条记录；抽屉 Escape 关闭与焦点返回由 E2E 覆盖。
- 手机创建面板位于视口内；聊天初次进入 scrollY=0，对话显示在运行指标之前。
- 所有图片来自本地真实页面。本轮没有发送新的付费模型请求、发布提示词或执行已有评测。

补充截图：
- [提示词列表](screenshots/prompts-1440.png)
- [评测列表](screenshots/evals-1440.png)
- [手机对话](screenshots/chat-390.png)
- [手机创建面板](screenshots/prompt-create-390.png)


### 第二轮最终自动化结果（2026-09-30）

| 检查 | 结果 |
| --- | --- |
| TypeScript / ESLint | 通过 |
| 生产构建 | 通过，本地 3000 端口已更新到新版 |
| 单元测试 | 9 / 9 通过 |
| 完整 E2E | 46 / 46 通过，含新增图表/抽屉交互 |
| 浏览器尺寸 | 1440 / 980 / 390px 验证通过 |

修复验收中发现的图表方向键激活、主按钮文字对比度、初次进入 Chat 的自动滚动；新增下钻测试等待导航完成后再核对日期，避免读取旧 URL。所有 E2E 使用隔离 schema 与 mock upstream，结束后清理。
