# AGENTS.md

## Project Context

This project builds a mobile-first web app for aggregating official cultural activities in Beijing. The first product slice is not a generic city-events platform. It focuses on embassy, cultural-center, and official international-organization events that users may miss if they do not follow the right WeChat official accounts.

## Working Rules

- Keep product scope narrow unless the user explicitly expands it.
- Prefer documentation and design clarity before scaffolding or implementation.
- Do not add unrelated frameworks, services, or abstractions.
- Keep frontend, backend, collector, and data-model responsibilities explicit.
- Treat collector and agent outputs as untrusted inputs. The backend must validate, deduplicate, and decide publish state.
- Preserve source health and failure reasons as product-visible state, not hidden logs.
- Prefer mobile-first UI assumptions because early users will likely open the product on phones or inside WeChat.

## GitHub Workflow

All normal development after repository initialization must use the GitHub workflow:

```text
Issue -> branch -> implementation -> tests -> PR -> code review -> fix review comments -> checks pass -> merge
```

Rules:

- Start work from a GitHub issue. If no issue exists, create one before coding.
- Keep each issue independently testable. If a task cannot be verified on its own, split it.
- Create one branch per issue, named `codex/<issue-number>-short-name` when possible.
- Do not commit directly to `main` unless the user explicitly requests a repository-maintenance exception.
- Open a PR for every normal code or documentation change.
- Link the PR to its issue with `Closes #<issue-number>` when the PR completes the issue.
- Fix code-review comments in the same PR, or explain why a requested change should not be made.
- Merge only after tests and required checks pass.

## Issue Management

GitHub issues are the source of truth for requirements and task state.

Before implementation, a coding agent must ensure the issue contains:

- goal
- scope
- non-goals
- acceptance criteria
- testing expectations
- implementation notes when needed

For larger requests, split the work into multiple issues before coding. Prefer issues that deliver one observable behavior, one backend capability, one UI slice, or one infrastructure step.

## Progress Handoff

At the end of each work session or completed task, update the relevant issue with a handoff comment:

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

The handoff must be enough for a new Codex session to continue without reading chat history.

## Documentation Layers

- `docs/requirements.md`: user needs, committed MVP requirements, non-goals, success criteria.
- `docs/superpowers/specs/2026-05-26-local-activities-design.md`: implementation-facing system design for the approved current slice.
- `docs/external-dependencies.md`: third-party services and why they are used.
- `docs/technical-baseline.md`: language, framework, database, deployment, and architectural baseline.
- `docs/testing-strategy.md`: how each type of feature should be validated.
- `docs/security-and-permissions.md`: security, secret, and permission boundaries.
- `CONTRIBUTING.md`: human-readable development workflow and review policy.
- `.github/codex/prompts/review.md`: Codex PR review guidance.

Keep future ideas out of the design spec unless they affect the current implementation boundary.

## Technical Direction

- Use TypeScript for the web app and collector-facing shared contracts.
- Use Next.js as a full-stack app first; do not split frontend and backend in the MVP.
- Deploy the web app and API on Vercel.
- Use Supabase Postgres as the primary relational database.
- Run crawler or browser automation outside Vercel.
- Design collector ingestion around abstract result types, not around a specific Playwright or agent implementation.

## Collector Principles

- The collector checks tracked sources on a low-frequency schedule, initially every 4 hours.
- The collector may use Playwright, browser automation, or an agent editor, but all implementations should emit the same normalized objects.
- Do not bypass captchas or aggressive platform protections. Report `captcha_required`, `login_required`, `fetch_blocked`, or related failure reasons.
- Upload structured article snapshots, event drafts, evidence, and source run reports to the backend.
- Avoid storing full article mirrors as a long-term product feature.

## Git Hygiene

- Keep commits focused.
- Do not rewrite history or reset user changes without explicit instruction.
- Before publishing, inspect `git status` and stage only intended files.
- Stage only files that belong to the current issue or repository-maintenance task.
- Record validation commands in the PR and in the issue handoff.
