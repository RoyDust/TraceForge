# UI Redesign Issue Breakdown Draft

Parent PRD: https://github.com/RoyDust/TraceForge/issues/52

This draft follows tracer-bullet vertical slices. Each slice should be demoable or verifiable on its own. Publish in dependency order after the breakdown is approved.

## Published Issues

| Issue | Title | Blocked by |
| --- | --- | --- |
| https://github.com/RoyDust/TraceForge/issues/53 | High-fidelity console shell tracer | None |
| https://github.com/RoyDust/TraceForge/issues/54 | Incident Command TraceRun selection flow | #53 |
| https://github.com/RoyDust/TraceForge/issues/55 | Incident Command diagnosis rail and Span evidence | #54 |
| https://github.com/RoyDust/TraceForge/issues/56 | Live Governance Dashboard operational overview | #53 |
| https://github.com/RoyDust/TraceForge/issues/57 | Regression Studio prompt diff release workspace | #53 |
| https://github.com/RoyDust/TraceForge/issues/58 | Regression Studio Eval evidence and comparison matrix | #57 |
| https://github.com/RoyDust/TraceForge/issues/59 | High-fidelity responsive and mock-source hardening pass | #55, #56, #58 |

## Proposed Breakdown

1. **Title:** High-fidelity console shell tracer
   - **Type:** AFK
   - **Blocked by:** None - can start immediately
   - **User stories covered:** 41, 42, 45, 46, 47, 48, 49, 50

2. **Title:** Incident Command TraceRun selection flow
   - **Type:** AFK
   - **Blocked by:** 1
   - **User stories covered:** 1, 2, 3, 4, 15, 43, 44, 45, 50

3. **Title:** Incident Command diagnosis rail and Span evidence
   - **Type:** AFK
   - **Blocked by:** 2
   - **User stories covered:** 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 50

4. **Title:** Live Governance Dashboard operational overview
   - **Type:** AFK
   - **Blocked by:** 1
   - **User stories covered:** 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 50

5. **Title:** Regression Studio prompt diff release workspace
   - **Type:** AFK
   - **Blocked by:** 1
   - **User stories covered:** 29, 30, 31, 32, 33, 34, 40, 45, 50

6. **Title:** Regression Studio Eval evidence and comparison matrix
   - **Type:** AFK
   - **Blocked by:** 5
   - **User stories covered:** 35, 36, 37, 38, 39, 40, 50

7. **Title:** High-fidelity responsive and mock-source hardening pass
   - **Type:** AFK
   - **Blocked by:** 3, 4, 6
   - **User stories covered:** 26, 27, 28, 43, 44, 45, 46, 50

## Issue Bodies

### 1. High-fidelity console shell tracer

## Parent

https://github.com/RoyDust/TraceForge/issues/52

## What to build

Build the first end-to-end high-fidelity shell slice for the TraceForge console. The completed slice should show the Round 2 shell direction in a real route: deep forest sidebar, compact top command bar, supported primary navigation, compact controls, real-or-mock project/time/live state, and at least one content area using the new visual system.

This slice should also establish the deterministic mock/view-model rule: real data wins, missing display-only facts are generated through local mock adapters, and mock facts are internally distinguishable from derived or live facts.

## Acceptance criteria

- [ ] The console shell visually matches the Round 2 direction on a real authenticated console route.
- [ ] Navigation shows only supported primary areas: Dashboard, Chat, TraceRuns, Prompt, and Eval.
- [ ] A compact top command bar exists with project, search, time range, live state, and environment affordances.
- [ ] At least one page renders through a view-model shape that can mix live, derived, and mock-backed values.
- [ ] Mock-backed values are deterministic and never written to the database.
- [ ] Unsupported prototype-only navigation such as Alerts is not presented as a real feature.
- [ ] Build and schema validation pass.

## Blocked by

None - can start immediately

### 2. Incident Command TraceRun selection flow

## Parent

https://github.com/RoyDust/TraceForge/issues/52

## What to build

Build the first Incident Command vertical slice: a dense TraceRun selection flow that lets a user filter failed/running runs, select a TraceRun, and inspect the selected run summary without leaving the screen. This should make the first step of the product story demoable: find a failed TraceRun and keep its key runtime facts visible.

## Acceptance criteria

- [ ] TraceRun list supports the existing useful filters in the new compact filter/chip style.
- [ ] Failed, running, slow, and all-run groupings are visible or otherwise quickly accessible.
- [ ] Selecting a TraceRun updates an adjacent summary without requiring navigation.
- [ ] Summary shows status, error code, latency, tokens, cost, usage source, timestamps, and linked Prompt/Eval evidence when available.
- [ ] Sparse or empty data still renders an intentional mock-backed or empty state.
- [ ] The existing deep-link TraceRun detail route remains useful.
- [ ] Build and relevant route checks pass.

## Blocked by

High-fidelity console shell tracer

### 3. Incident Command diagnosis rail and Span evidence

## Parent

https://github.com/RoyDust/TraceForge/issues/52

## What to build

Complete the Incident Command diagnosis path for a selected TraceRun. The user should be able to inspect Waterfall, Span Tree, Responsibility, fallback events, rate-limit facts, provider health, slowest span, and costliest span in one diagnostic workspace.

This slice should preserve the product rule that Prompt quality belongs to Eval workflows and is not included in runtime Responsibility.

## Acceptance criteria

- [ ] Waterfall timeline shows spans with duration and failed/degraded/healthy visual states.
- [ ] Span Tree table shows parent-child structure and highlights failed, slowest, and costliest spans.
- [ ] Responsibility rail uses the project responsibility-domain vocabulary and excludes Prompt quality attribution.
- [ ] Fallback and stream interruption events are visible when present.
- [ ] Provider health and rate-limit facts are derived from current data where possible and mock-backed only where needed.
- [ ] Slowest and costliest Span summaries are visible for selected runs.
- [ ] A fixed demo trace can show the full three-step story: filter failed, inspect evidence, identify Responsibility.

## Blocked by

Incident Command TraceRun selection flow

### 4. Live Governance Dashboard operational overview

## Parent

https://github.com/RoyDust/TraceForge/issues/52

## What to build

Rebuild the Dashboard as the live governance overview from the Round 2 prototype. The page should combine compact KPIs, dense TraceRun operations table, selected-row drawer, right governance rail, UsageDaily trend, and model/provider cost breakdown.

The page should use current TraceRun, TraceSpan, TraceEvent, UsageDaily, ModelProvider, ModelConfig, and ApiKey data where available, with deterministic mock values only for display-only live/freshness/utilization gaps.

## Acceptance criteria

- [ ] Top metric strip shows requests, failure rate, P95 latency, cost, tokens, fallbacks, and stream errors.
- [ ] Dense TraceRun table includes status, time, model, provider, route, latency, tokens, cost, error code, duration, and usage source.
- [ ] Selected-row drawer exposes error details, quick actions, and related events.
- [ ] Governance rail groups provider health, rate-limit failures, fallback chains, and stream interruption reasons.
- [ ] UsageDaily trend and model/provider cost breakdown remain visible below the primary table.
- [ ] Existing demo and aggregation scripts produce meaningful visible states.
- [ ] Build and schema validation pass.

## Blocked by

High-fidelity console shell tracer

### 5. Regression Studio prompt diff release workspace

## Parent

https://github.com/RoyDust/TraceForge/issues/52

## What to build

Build the first Regression Studio vertical slice for PromptVersion review. A Prompt owner should be able to open a prompt, choose baseline and candidate versions, inspect a side-by-side diff, run Eval, and see release actions in the same workspace.

This slice establishes the V3-style Prompt/Eval workspace inside the same global console shell.

## Acceptance criteria

- [ ] Prompt workspace uses the shared shell but has a distinct Regression Studio layout.
- [ ] Prompt header shows prompt identity, baseline version, candidate version, dataset selector, and release actions.
- [ ] Side-by-side diff clearly shows additions and removals with line numbers.
- [ ] Run eval, promote, and rollback actions remain connected to existing PromptVersion and Eval flows.
- [ ] Prompt quality is presented as Eval/release evidence, not runtime Responsibility.
- [ ] Empty or single-version prompts have an intentional state.
- [ ] Build and relevant route checks pass.

## Blocked by

High-fidelity console shell tracer

### 6. Regression Studio Eval evidence and comparison matrix

## Parent

https://github.com/RoyDust/TraceForge/issues/52

## What to build

Complete the Regression Studio evidence path by adding Eval summary, failed cases, manual review state, linked Trace evidence, assertion matrix, compare-run charts, and recent EvalRun history. A Prompt owner should be able to decide whether a candidate PromptVersion is safe to promote using the visible evidence.

## Acceptance criteria

- [ ] Eval evidence rail shows pass rate, regressions, improvements, total cases, and manual review state.
- [ ] Failed Eval cases are grouped and link to available trace evidence when possible.
- [ ] Assertion matrix summarizes behavior categories and uses deterministic mock grouping only when current data lacks enough tags.
- [ ] Compare-run section shows pass rate, latency, cost, and failure-domain differences.
- [ ] Recent EvalRun history remains available and actionable.
- [ ] Manual review states can still be updated through existing flows.
- [ ] Build and relevant route checks pass.

## Blocked by

Regression Studio prompt diff release workspace

### 7. High-fidelity responsive and mock-source hardening pass

## Parent

https://github.com/RoyDust/TraceForge/issues/52

## What to build

Perform the final high-fidelity hardening pass across the redesigned Incident Command, Dashboard, and Regression Studio surfaces. This slice should make the redesigned UI robust on desktop, tablet, and narrow mobile widths while making mock-backed display facts auditable to developers.

## Acceptance criteria

- [ ] Desktop views visually match the three Round 2 prototypes in hierarchy, density, and layout intent.
- [ ] Tablet and mobile widths do not show overlapping controls, clipped text, or unusable rails.
- [ ] Tables scroll horizontally when necessary instead of crushing data.
- [ ] Right governance/evidence rails collapse below main content at narrower widths.
- [ ] Empty, error, loading, and mock-backed states are intentional across redesigned pages.
- [ ] Developers can audit which values are mock, derived, or live.
- [ ] Build, schema validation, and manual visual QA pass.

## Blocked by

Incident Command diagnosis rail and Span evidence; Live Governance Dashboard operational overview; Regression Studio Eval evidence and comparison matrix
