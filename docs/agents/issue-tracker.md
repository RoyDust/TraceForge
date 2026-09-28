# Issue Tracker: GitHub

Issues, specifications, and implementation tickets for this repository live in GitHub Issues. Use the `gh` CLI from this clone so the repository is inferred from `origin`.

## Conventions

- Create an issue with `gh issue create --title "..." --body-file <file>`.
- Read an issue with `gh issue view <number> --comments`.
- List issues with `gh issue list --state open --json number,title,body,labels,comments` and appropriate filters.
- Comment with `gh issue comment <number> --body "..."`.
- Apply or remove labels with `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- Close an issue with `gh issue close <number> --comment "..."`.

## Pull Requests as a Triage Surface

PRs as a request surface: no. Pull requests are implementation artifacts, not incoming feature requests for the triage queue.

GitHub shares one number space across issues and pull requests. Resolve an ambiguous reference with `gh pr view <number>` and fall back to `gh issue view <number>`.

## Skill Operations

- When a skill says to publish to the issue tracker, create a GitHub issue.
- When a skill says to fetch a ticket, use `gh issue view <number> --comments`.
- Specifications and agent-ready tickets receive the `ready-for-agent` label.
- Blocking relationships use GitHub native issue dependencies when available. If unavailable, add `Blocked by: #<number>` to the ticket body.
- A ticket is ready to claim only when all blocking issues are closed.
