# Domain Docs

TraceForge is a single-context repository.

## Before Exploring

- Read `CONTEXT.md` at the repository root.
- Read the ADRs under `docs/adr/` that touch the area being changed.
- If a referenced document does not exist, proceed without creating one preemptively.

## Vocabulary

Use the canonical terms defined in `CONTEXT.md` in issue titles, specifications, tests, code, and user-facing descriptions. Do not replace a defined term with a synonym listed under `_Avoid_`.

If work introduces a genuinely new domain concept, resolve its meaning through `domain-modeling` before adding it to the glossary.

## Architectural Decisions

Surface any conflict with an existing ADR instead of silently overriding it. Create a new ADR only for decisions that are difficult to reverse, surprising without context, and selected through a real trade-off.
