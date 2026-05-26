# Contributing

This project uses a PR-based GitHub workflow for normal development.

## Workflow

```text
Issue -> branch -> implementation -> tests -> PR -> code review -> fix review comments -> checks pass -> merge
```

## Issues

Use GitHub issues to manage requirements and task state.

Each implementation issue should include:

- goal
- scope
- non-goals
- acceptance criteria
- testing expectations
- implementation notes when useful
- progress handoff comments as work proceeds

Keep issues independently testable. If a task cannot be verified on its own, split it into smaller issues.

## Branches

Create one branch per issue.

Preferred branch format:

```text
codex/<issue-number>-short-name
```

Examples:

```text
codex/12-source-health-model
codex/18-collector-ingest-api
```

## Pull Requests

All normal changes should go through PRs.

Each PR should:

- link the issue it completes with `Closes #<issue-number>` when appropriate
- describe what changed
- list validation commands and results
- call out review notes, risks, or follow-up work
- pass tests and required checks before merge

## Code Review

Review comments should be handled before merge.

For each actionable comment:

- make the requested change, or
- explain why the change is not appropriate, with technical reasoning

Keep discussion in the PR. Update the issue only with final progress and handoff state.

## Handoff Notes

At the end of each work session, add a comment to the issue:

```markdown
## Handoff - YYYY-MM-DD

Done:
- ...

Validated:
- `command used`

Open:
- ...

Next:
- ...
```

The handoff should let a new Codex session continue from the issue without relying on chat history.
