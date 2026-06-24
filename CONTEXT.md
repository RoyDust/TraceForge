# TraceForge

AI 网关 + Agent 可观测平台。把 AI 调用做到「可观测、可归因」——核心叙事是「一次失败的调用，3 步定位根因」。

## Language

### Trace 家族

**TraceRun**（简称 Run）：
一次端到端调用——「一次网关请求」或「一个 Agent 任务」。调用树的根，恒有 ≥1 个 Span。
_Avoid_: trace（作实体名）、session、request（作实体名）

**TraceSpan**（简称 Span）：
Run 内的一个**逻辑步骤**（`type` ∈ llm / tool / workflow / db / review），靠 `parent_id` 组成树。是逻辑步骤而非物理 attempt——一次回退到备用模型的调用仍是**一个** Span。
_Avoid_: step、node、attempt

**TraceEvent**：
某个 Span 上的**时间点标记**（stream_start、first_token、fallback_triggered 等），不是步骤，是瞬时事件。
_Avoid_: log、signal

**Trace**：
泛指整棵 Run→Span→Event 树的非正式总称，**不是**落库实体。
_Avoid_: 把 "Trace" 当某张表/实体名使用

### 归因

**责任域**：
一次**失败**调用的根因归属，由 `(span.type × error_code)` 经显式映射表派生出的人类可读标签。失败责任域为 `模型 / 网络 / 限流 / 工具 / 业务`，外加「网关拒绝」（请求未达模型）。**不含 Prompt**——Prompt 质量问题属 Eval 时段，不是失败归因。
_Avoid_: 把 Prompt 质量、Eval 评分算进责任域
