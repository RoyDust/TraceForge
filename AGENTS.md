# Repository Agent Instructions

## Agent skills

### Issue tracker

Issues, specifications, and implementation tickets live in GitHub Issues and are managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the canonical five-role triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository. Read the root `CONTEXT.md` and relevant files under `docs/adr/` before making domain or architectural changes. See `docs/agents/domain.md`.

## Default engineering flow

Large or multi-session work defaults to the Matt Pocock skills flow: `ask-matt` routes the work, `grill-with-docs` resolves decisions, `to-spec` publishes the accepted specification, `to-tickets` creates dependency-aware implementation tickets, and `implement` completes tickets with tests and code review. Do not skip directly to implementation when the work is still broad or contains unresolved decisions.
