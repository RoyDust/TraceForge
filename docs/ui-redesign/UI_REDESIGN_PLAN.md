# TraceForge UI Redesign Plan

## Goal

Rebuild the current TraceForge console into a high-fidelity product UI matching the Round 2 prototypes:

- V1 becomes the overall console shell and Incident Command direction.
- V2 contributes dense tables and live governance panels.
- V3 becomes the independent Prompt/Eval Regression Studio module.

The redesign should be usable against current database data. Data that does not exist yet should come from explicit mock view-model adapters so the UI can reach the prototype fidelity without forcing premature schema changes.

## Prototype Targets

| Target | Prototype | Main Route |
| --- | --- | --- |
| Incident Command | `traceforge-ui-r2-01-incident-command.png` | `/traces`, `/traces/[id]` |
| Live Governance Dashboard | `traceforge-ui-r2-02-live-governance-dashboard.png` | `/dashboard` |
| Regression Studio | `traceforge-ui-r2-03-regression-studio.png` | `/prompts/[id]`, `/evals`, `/evals/runs/[id]` |

## Design Principles

- Keep a single TraceForge shell: deep forest sidebar, compact top command bar, off-white workspace, graphite type, red/amber/green operational states, restrained blue links.
- Use dense but readable operational layouts: compact tables, rails, chips, status badges, segmented controls, and small charts with actual meaning.
- Keep cards shallow: panels are allowed, nested cards are not.
- Use 6px or smaller radii for console surfaces.
- Use the Incident Command page to sell the core story: filter failed TraceRuns, inspect Waterfall/Span Tree, identify Responsibility.
- Use Regression Studio for Prompt/Eval instead of blending Prompt quality into Trace responsibility.
- Avoid unsupported product promises in the UI: no Alerts, ticketing, saved views, stakeholder approval, or guardrail center until data and workflows exist.

## Current Data Coverage

### Directly Supported

- `TraceRun`: status, error code, input/output previews, tokens, cost, latency, usage source, timestamps.
- `TraceSpan`: parent tree, type, model, provider, tokens, cost, latency, status, error code, error summary.
- `TraceEvent`: stream events, fallback events, chunk counts, event payloads.
- `Prompt` / `PromptVersion`: active version, version history, content, diff, publish/rollback pointer.
- `EvalDataset` / `EvalCase` / `EvalRun` / `EvalResult`: datasets, cases, runs, pass/fail, score, duration, cost, manual review status.
- `UsageDaily`: request, success/failure, token, cost, average latency trends.
- `ModelProvider` / `ModelConfig` / `ApiKey`: provider/model metadata and configured rate limits.

### Derived From Current Data

- Provider health: aggregate spans by provider/model over the selected time window.
- Failure rate, P95 latency, cost and token KPIs: aggregate TraceRun and TraceSpan rows.
- Fallback chain summary: aggregate `fallback_triggered` and `fallback_failed` events.
- Stream interruption reasons: group TraceRun/TraceSpan error codes.
- Slowest/costliest span: compute from spans in the selected run.
- Eval pass rate and regression counts: compare EvalRun result sets.

### Mock Until Productized

Create a mock view-model layer for:

- Live ingest rate and "updated seconds ago" freshness.
- Rate-limit utilization buckets when only configured limits exist.
- Release checklist items not directly stored yet.
- Linked Trace evidence counts when a direct relation is missing.
- Small trend sparklines when the selected time window has too little real data.

Mock objects must include a `source: "mock" | "derived" | "live"` marker internally. The UI can hide that marker in normal mode, but developers should be able to audit it.

## Implementation Architecture

### 1. Design Foundation

Create reusable console primitives before page rewrites:

- `ConsoleShell`: sidebar, route state, account footer, responsive collapse behavior.
- `TopCommandBar`: project selector, global search, time range, live indicator, environment selector.
- `MetricStrip`: compact KPI cells with delta and micro trend.
- `StatusBadge`, `DomainBadge`, `SourceBadge`.
- `FilterBar`: chips, selects, date ranges, reset actions.
- `DataTable`: dense table styling, selected row, inline drawer pattern.
- `GovernanceRail`: right-side factual panels.
- `MiniTrend`, `InlineBars`, `Heatmap`.
- `WaterfallTimeline` and `SpanTreeTable`.
- `PromptDiffEditor` and `EvalEvidenceRail`.

Do this without adding dependencies unless explicitly approved. Use CSS, native elements, and existing React/Next primitives first.

### 2. View-Model Adapters

Keep Prisma queries close to each route, but normalize display data before rendering.

Recommended files:

- `lib/ui-mocks.ts`: deterministic mock generators for unsupported data.
- `lib/ui-metrics.ts`: shared p95, average, grouping, delta, trend helpers.
- `lib/ui-view-models.ts`: conversion helpers for Trace, Dashboard, Prompt, and Eval screens.

Rules:

- Real data wins over mock data.
- Mock data should be deterministic from project id, route id, or date range so screenshots are stable.
- Never write mock data to the database.
- Do not expand Prisma schema only to satisfy prototype decoration.

### 3. Global Shell

Update `app/console-shell.tsx` and related CSS:

- Use the Round 2 deep-green sidebar.
- Keep only supported primary nav: Dashboard, Chat, TraceRuns, Prompt, Eval.
- Remove prototype-only Alerts until implemented.
- Add route active state and compact icon+label treatment.
- Add top command bar support per console route.

### 4. Incident Command

Target routes:

- `/traces`: dense split view with TraceRun list and selected run summary.
- `/traces/[id]`: deep-link version of the same incident detail.

Work:

- Replace the current table-only TraceRun list with left list + detail composition.
- Reuse current filters but render them as compact chips and selects.
- Move Waterfall and Span Tree into the center work area.
- Add right rail: Responsibility, fallback events, rate-limit facts, provider health, slowest span, costliest span.
- Use mock or derived data for provider health and rate-limit utilization.

Verification:

- Stage 3 demo data shows success, running, failed, fallback, rate-limited, revoked-key cases.
- A failed run demonstrates the three-step story without opening another page.
- `/traces/[id]` remains linkable and useful.

### 5. Live Governance Dashboard

Target route:

- `/dashboard`

Work:

- Rework KPI cards into the compact top metric strip.
- Replace the current lower sections with:
  - Dense TraceRun table and inline selected row drawer.
  - Right governance rail for provider health, rate-limit failures, fallback chain, stream interruption reasons.
  - Bottom UsageDaily trend and model/provider cost table.
- Keep existing real calculations from Dashboard where possible.
- Add deterministic mock data only for live ingest and utilization visuals.

Verification:

- Stage 4 demo data and `scripts/aggregate-usage-daily.mjs` produce non-empty dashboard states.
- Empty database still renders a useful mock-backed prototype state when enabled.
- `npm run build` passes.

### 6. Regression Studio

Target routes:

- `/prompts/[id]`
- `/evals`
- `/evals/runs/[id]`
- `/evals/compare`

Work:

- Convert Prompt detail into the Regression Studio composition:
  - Header with prompt name, baseline/candidate selectors, dataset selector, Run eval, Promote, Rollback.
  - Center side-by-side Prompt diff.
  - Right Eval evidence rail.
  - Bottom Eval datasets, assertion matrix, compare runs, recent eval runs.
- Keep Prompt quality separate from Trace responsibility attribution.
- Use real EvalRun/EvalResult data for pass rate and failures.
- Mock assertion matrix grouping when current cases lack enough tags.

Verification:

- Stage 5 and Stage 6 demo data produce at least two prompt versions and comparable EvalRuns.
- Manual review states remain actionable.
- Failed Eval results link back to available evidence, using mock links only when no direct TraceRun exists.

### 7. Responsive And Hardening Pass

Desktop is the primary target, but the UI must not break on smaller screens.

Work:

- At tablet/mobile widths, collapse right rails below the main content.
- Keep tables horizontally scrollable instead of crushing text.
- Preserve action access on mobile; do not hide critical filters.
- Check text overflow in badges, buttons, table cells, and editor headers.
- Add empty, loading, error, and mock-backed states for every rewritten route.

Verification:

- Check at 1440px, 1280px, 980px, and 390px widths.
- No overlapping text, clipped controls, or unreadable table drawers.
- Keyboard focus remains visible.

## Suggested Order

1. Prototype docs and plan in `docs/ui-redesign`.
2. Design tokens and shared console components.
3. Mock/view-model layer.
4. Shell/top command bar/navigation.
5. Incident Command Trace screens.
6. Dashboard live governance screen.
7. Regression Studio Prompt/Eval screens.
8. Responsive and visual QA pass.
9. Remove or clearly mark any remaining unsupported mock-only UI.

## Acceptance Criteria

- The app visually matches the Round 2 prototypes at high fidelity on desktop.
- Supported pages can render from current database data.
- Missing data is supplied only through explicit mock adapters.
- Unsupported navigation and product promises are not shown as real features.
- `npm run build` passes.
- `npx prisma validate` passes.
- Core demo scripts still produce useful visible states.
- Manual visual checks confirm the three target routes match the prototype hierarchy:
  - `/traces` or `/traces/[id]`
  - `/dashboard`
  - `/prompts/[id]` or an equivalent Prompt/Eval workspace route

## Risks

- The prototypes are denser than the current CSS architecture; extracting components first will reduce page-level churn.
- Some generated prototype text is illustrative; implementation copy should follow the actual product vocabulary in `CONTEXT.md`.
- Mock data can accidentally look like production truth. Keep mock generation centralized and auditable.
- Without an icon dependency, some icon polish may need CSS or inline symbols. Do not add a new icon package without approval.
