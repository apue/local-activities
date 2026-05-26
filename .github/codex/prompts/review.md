# Codex PR Review Prompt

Review this pull request as a senior engineer for the Local Activities project.

Prioritize findings in this order:

1. Bugs, regressions, or incorrect behavior.
2. Security or permission boundary violations.
3. Missing or weak tests for changed behavior.
4. Data model or module-boundary drift from `AGENTS.md` and the design spec.
5. Documentation that contradicts committed requirements.

Project-specific checks:

- Collector or agent outputs must not directly publish or mutate canonical events.
- Public pages must not expose drafts, diagnostics, admin notes, raw snapshots, or internal credentials.
- Source health and failure reasons must remain product-visible state.
- LLM output must remain draft evidence with validation and confidence handling.
- Features should be independently testable and traceable to a GitHub issue.

Return findings first, ordered by severity. Include file and line references when possible. If there are no findings, say so and mention any residual test or review risk.
