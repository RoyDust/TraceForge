# PRD: TraceForge UI 高保真控制台改造

## Problem Statement

TraceForge 已经具备 AI 网关、TraceRun/TraceSpan/TraceEvent 可观测、成本 Dashboard、Prompt 版本管理和 Eval 回归评测能力，但当前 Console UI 仍偏基础后台形态：页面之间割裂、信息密度不足、Trace 诊断路径不够像一个真正的事故指挥工作台，Prompt/Eval 的发布证据也没有形成独立的工作区体验。

用户希望将当前项目 UI 完全重构为高保真产品界面：整体控制台采用 Incident Command 方向，Dashboard 吸收密集运维表格和实时治理面板，Prompt/Eval 模块采用 Regression Studio 工作区风格。现有数据库支持不了的展示数据可以先用明确的 mock 数据补足，但 mock 必须集中、可审计、不可污染生产数据模型。

## Solution

把 TraceForge Console 改造成三个一致但各有重心的高保真工作区：

1. Incident Command：以失败 TraceRun 定位为主线，在同一屏完成“筛失败 → 看 Waterfall/Span Tree → 定 Responsibility”的三步诊断。
2. Live Governance Dashboard：以网关运行治理为主线，在同一屏查看请求量、失败率、P95 延迟、成本、Token、fallback、stream interruption、Provider/Model 健康度、限流事实和 UsageDaily 趋势。
3. Regression Studio：以 PromptVersion 和 EvalRun 上线证据为主线，在同一屏完成 baseline/candidate diff、Eval 结果比较、失败样本复核、Trace evidence 查看和发布/回滚判断。

重构应优先复用当前数据模型和页面能力。缺失字段通过确定性的 mock/view-model 层补足，真实数据优先，mock 只作为 UI 原型完整度和演示状态补位。

## User Stories

1. As an AI 应用开发者, I want to filter failed TraceRuns quickly, so that I can start incident diagnosis from the most urgent failures.
2. As an AI 应用开发者, I want to see failed, running, slow, and all TraceRuns in a compact list, so that I can compare recent calls without jumping between pages.
3. As an AI 应用开发者, I want to select a TraceRun and inspect its summary in the same screen, so that I do not lose context while diagnosing.
4. As an AI 应用开发者, I want to see status, error code, latency, total tokens, cost, usage source, PromptVersion, and Eval evidence for a TraceRun, so that I can decide whether the issue is runtime, cost, Prompt, or Eval related.
5. As an AI 应用开发者, I want to inspect a TraceRun Waterfall, so that I can identify which Span consumed time or failed.
6. As an AI 应用开发者, I want to inspect a Span Tree table, so that I can understand parent-child execution structure and nested Agent steps.
7. As an AI 应用开发者, I want failed, degraded, slowest, and costliest Spans to be visually highlighted, so that I can identify likely investigation targets quickly.
8. As an AI 应用开发者, I want Responsibility to be shown in a right-side rail, so that root-cause attribution stays visible while I inspect the trace.
9. As an AI 应用开发者, I want Responsibility to follow the project glossary and exclude Prompt quality, so that runtime failures and Eval quality are not mixed.
10. As an AI 应用开发者, I want fallback events to be visible near the selected TraceRun, so that I can see when primary model failure moved to a backup model.
11. As an AI 应用开发者, I want stream interruption events to be visible in the TraceRun context, so that I can distinguish upstream interruption from ordinary model failure.
12. As an AI 应用开发者, I want rate-limit facts to appear near failed calls, so that I can tell whether failure came from gateway policy.
13. As an AI 应用开发者, I want provider health summaries derived from recent spans, so that I can compare upstream stability without a separate tool.
14. As an AI 应用开发者, I want slowest and costliest Span summaries, so that I can focus performance and cost optimization.
15. As an AI 应用开发者, I want links from TraceRun to PromptVersion and Eval evidence, so that I can move from runtime evidence to release evidence.
16. As an AI 应用开发者, I want the Dashboard to show compact KPI strips, so that I can scan system health quickly.
17. As an AI 应用开发者, I want request count, failure rate, P95 latency, cost, tokens, fallback count, and stream error count in one row, so that gateway health is visible at a glance.
18. As an AI 应用开发者, I want dense TraceRun tables on Dashboard, so that operational triage can happen without opening the TraceRun list first.
19. As an AI 应用开发者, I want an inline selected-row drawer in dense tables, so that I can inspect a problem without navigating away.
20. As an AI 应用开发者, I want Provider/Model cost breakdown, so that I can identify expensive upstream usage.
21. As an AI 应用开发者, I want UsageDaily trends to stay visible, so that I can compare recent behavior against longer-term usage.
22. As an AI 应用开发者, I want Provider health grouped by Provider/Model, so that model-specific instability is not hidden by aggregate numbers.
23. As an AI 应用开发者, I want rate-limit failures grouped by Provider/Model or configured bucket, so that I can tune API Key limits with evidence.
24. As an AI 应用开发者, I want fallback chains summarized, so that I can verify backup model behavior.
25. As an AI 应用开发者, I want stream interruption reasons grouped, so that repeated upstream streaming problems become visible.
26. As an AI 应用开发者, I want mock-only live ingest and freshness values to be deterministic, so that prototype screenshots and demos are stable.
27. As an AI 应用开发者, I want mock data to be auditable internally, so that nobody confuses mock UI facts with database truth.
28. As an AI 应用开发者, I want unsupported navigation such as Alerts hidden until implemented, so that the product does not promise unavailable workflows.
29. As a Prompt owner, I want a Regression Studio workspace, so that Prompt changes can be evaluated like release candidates.
30. As a Prompt owner, I want baseline and candidate PromptVersion selectors, so that I can compare a production version with a draft.
31. As a Prompt owner, I want a side-by-side diff editor, so that additions and removals are easy to review.
32. As a Prompt owner, I want Run eval to be available from the Regression Studio, so that I can validate a candidate PromptVersion directly.
33. As a Prompt owner, I want Promote and Rollback actions near Eval evidence, so that release decisions are tied to regression results.
34. As a Prompt owner, I want an Eval summary rail, so that pass rate, regressions, improvements, total cases, and manual review state stay visible.
35. As a Prompt owner, I want failed Eval cases listed with reasons, so that I can review what blocks promotion.
36. As a Prompt owner, I want failed Eval cases to link to trace evidence when available, so that I can connect offline regression with runtime behavior.
37. As a Prompt owner, I want an assertion matrix, so that I can see which behavior categories are weakening.
38. As a Prompt owner, I want compare-run charts for pass rate, latency, cost, and failure domains, so that quality and operational impact are reviewed together.
39. As a Prompt owner, I want manual review states to remain actionable, so that human judgement can be part of the release gate.
40. As a Prompt owner, I want Prompt quality to stay in Eval workflows, so that Trace responsibility remains focused on runtime failure attribution.
41. As a Console user, I want the same global shell across Dashboard, TraceRuns, Prompt, Eval, and Chat, so that navigation feels coherent.
42. As a Console user, I want a compact top command bar, so that project, search, time range, live state, and environment controls are always reachable.
43. As a Console user, I want the UI to remain readable on desktop and tablet widths, so that dense operational screens do not collapse.
44. As a Console user, I want tables to scroll horizontally when needed, so that data is not crushed or overlapped.
45. As a Console user, I want clear empty, error, and mock-backed states, so that missing data does not look broken.
46. As a Console user, I want keyboard focus to remain visible, so that dense controls remain accessible.
47. As a project maintainer, I want reusable UI primitives, so that page rewrites do not duplicate styling and behavior.
48. As a project maintainer, I want view-model adapters between Prisma results and UI components, so that UI density does not leak formatting logic into queries.
49. As a project maintainer, I want no new dependency by default, so that the redesign stays small and reversible.
50. As a project maintainer, I want build and schema validation to pass after each vertical slice, so that visual work does not destabilize the app.

## Implementation Decisions

- The redesign will use the Round 2 prototype set as the target visual direction.
- The global shell will be unified before page-specific rewrites.
- The supported primary navigation remains Dashboard, Chat, TraceRuns, Prompt, and Eval.
- Unsupported prototype-only areas such as Alerts, ticketing, saved views, stakeholder approval, and guardrail center are out of the real UI until matching data and workflows exist.
- Reusable console primitives will be introduced for shell, top command bar, metric strips, badges, filter bars, dense tables, governance rails, mini charts, waterfall timeline, span tree table, prompt diff, and Eval evidence.
- Route-level Prisma reads may remain local to each route, but display data will be normalized through view-model helpers before rendering.
- Missing data will be supplied by deterministic mock helpers, never by writing mock rows into the database.
- Mock view models will internally track whether a displayed fact is live, derived, or mock.
- Incident Command will combine TraceRun list, selected run detail, Waterfall, Span Tree, and live governance rail into a single diagnostic workflow.
- Dashboard will combine compact KPIs, dense TraceRun table, live governance rail, UsageDaily trends, and model/provider breakdown.
- Regression Studio will combine PromptVersion diff, Eval summary, failed cases, assertion matrix, compare runs, and Trace evidence.
- Prompt quality will remain in Eval workflows and will not be included in Trace runtime Responsibility.
- The UI will use current data where possible: TraceRun, TraceSpan, TraceEvent, Prompt, PromptVersion, EvalDataset, EvalCase, EvalRun, EvalResult, UsageDaily, ModelProvider, ModelConfig, and ApiKey.
- Provider health, P95, failure rate, cost, fallback summaries, stream interruption groupings, slowest span, costliest span, and Eval regressions will be derived from current data.
- Live ingest, freshness, utilization buckets, incomplete release checklist items, sparse trends, and missing trace-evidence links may use mock data.
- Desktop is the primary fidelity target, with responsive hardening for tablet and mobile.
- No new dependency should be introduced unless a later implementation issue explicitly justifies it.

## Testing Decisions

- Tests should verify externally visible behavior and user workflows, not implementation details or CSS class names.
- The highest useful seams are route-level rendered pages and view-model adapters.
- View-model tests should cover real-data-first behavior, derived metrics, deterministic mock fallback, and source marking.
- Incident Command tests should cover failed TraceRun diagnosis, Responsibility rendering, Waterfall/Span Tree visibility, fallback events, and missing-data states.
- Dashboard tests should cover KPI aggregation, provider/model grouping, governance rail groupings, UsageDaily trends, and mock-backed live indicators.
- Regression Studio tests should cover baseline/candidate selection, diff visibility, Eval summary, failed case grouping, assertion matrix fallback, and release checklist state.
- Build validation remains required after implementation slices.
- Prisma schema validation remains required to ensure the redesign does not accidentally require unsupported schema changes.
- Manual visual QA should compare the implemented routes against the three Round 2 prototypes at desktop width.
- Responsive QA should check that tables scroll rather than overlap and that right rails collapse below main content at narrower widths.

## Out of Scope

- Adding a real Alerts product area.
- Adding ticketing, saved views, stakeholder approval, or guardrail-center workflows.
- Changing the production database schema just to support prototype decoration.
- Implementing a new icon dependency unless separately approved.
- Rewriting gateway runtime behavior.
- Changing Trace responsibility semantics to include Prompt quality.
- Guaranteeing pixel-perfect generated-image text reproduction.

## Further Notes

- The redesign should use the project glossary: TraceRun, TraceSpan, TraceEvent, Responsibility, Chat Playground, PromptVersion, EvalDataset, EvalRun, and EvalResult.
- The first implementation issue should establish the design foundation and mock/view-model rules before high-churn page rewrites.
- The final implementation should clearly avoid making mock-only facts look like persisted production truth.
