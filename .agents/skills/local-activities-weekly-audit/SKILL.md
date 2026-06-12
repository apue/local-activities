---
name: local-activities-weekly-audit
description: Use when the user asks Codex to inspect recent Local Activities system health, weekly performance, too few or too many events, false positives, duplicates, missing posters or QR codes, review backlog, token usage, provider failures, or to autonomously diagnose why the event pipeline feels wrong.
---

# Local Activities Weekly Audit

Use this skill to run a safe, agent-readable audit for the Beijing cultural
activities pipeline. The goal is to gather facts and evidence so Codex can
reason about likely causes and propose fixes. Audit scripts prepare context;
Codex makes the diagnosis.

## Read First

Before acting, read:

- `AGENTS.md`
- `docs/agent-operable-event-pipeline-goal.md`
- `docs/agent-operable-event-pipeline.zh.md`
- `docs/event-pipeline-architecture.md`

Keep issue/branch/PR workflow from `AGENTS.md`. Do not rely on chat history.

## Default Workflow

1. Confirm the working tree and current branch.
2. Run a read-only audit packet:

```bash
pnpm agent:audit -- --env-file .env.local --days 7 --output-dir .agent-runs/<run-id>
```

3. Read these outputs:

- `.agent-runs/<run-id>/audit-facts.json`
- `.agent-runs/<run-id>/candidate-index.json`
- `.agent-runs/<run-id>/public-snapshot.json`
- `.agent-runs/<run-id>/usage-summary.json`
- `.agent-runs/<run-id>/audit-brief.md`

4. Pick the highest-value candidates from `candidate-index.json`. Treat
   `severityHint` as a triage hint, not a root cause.
5. Generate drilldown evidence for selected candidates:

```bash
pnpm agent:inspect-finding -- --finding-id <id> --audit-dir .agent-runs/<run-id> --output-dir .agent-runs/<run-id>/evidence
pnpm agent:inspect-cluster -- --cluster-id <id> --audit-dir .agent-runs/<run-id> --output-dir .agent-runs/<run-id>/evidence
pnpm agent:inspect-event -- --event-id <id> --audit-dir .agent-runs/<run-id> --output-dir .agent-runs/<run-id>/evidence
pnpm agent:inspect-source -- --source-id <id> --audit-dir .agent-runs/<run-id> --output-dir .agent-runs/<run-id>/evidence
```

6. Use evidence packs to decide whether the issue is likely in source/capture,
   extractor, editor, dedupe, publish policy, public UI, or provider/model.
7. If a real case should become regression coverage, export it to a private
   corpus with `pnpm agent:export-case`.
8. If comparing a candidate model or prompt, run non-production eval only. Use
   `pnpm agent:eval` when available; otherwise use the V5 eval command from the
   repo docs with explicit non-production corpus, budget, and `--allow-live`
   only when approved.
9. If a code or config fix is needed, create or update a GitHub issue, branch,
   implement, test, open PR, wait for checks, merge only when allowed, and write
   issue handoff.

## Live Eval Review Loop

Use this checklist when the user wants Codex to evaluate recent model/prompt
behavior and they prefer to inspect product-like preview pages instead of raw
JSON artifacts.

1. Start from a clean branch and confirm whether live LLM spend is approved.
2. Run non-production eval with an explicit corpus, target, and budget:

```bash
pnpm agent:eval -- --env-file .env.local --corpus-dir tests/regression-corpus --all --allow-live --target eval --max-cost-cny <budget>
```

3. If eval rows were written to the hosted eval scope, open the product preview:

```text
/admin/eval-runs/<eval-run-id>/preview
```

4. Record human review feedback through the existing admin feedback API or UI.
   Link feedback with `data_class=eval`, `eval_run_id`, and `case_id` when the
   case is known. Also include `event_id` or `article_bundle_id` when available.
5. Generate an agent report from the audit/eval artifacts:

```bash
pnpm agent:report -- --audit-dir .agent-runs/<audit-run-id> --eval-run-id <eval-run-id> --output-dir .agent-runs/<report-run-id>
```

6. Read the report before proposing fixes. Use preview URL, review metrics,
   feedback counts, evidence packs, and failing cases to decide whether the next
   action is prompt/model tuning, corpus repair, code changes, or data cleanup.
7. Export repeatable bad cases with `pnpm agent:export-case` so future loops
   can run without live WeChat or live LLM calls.

## Permission Boundaries

Allowed by default:

- read-only audit and drilldown
- local evidence report generation
- private corpus export from existing records
- fixture/local/non-production eval without live WeChat or live LLM
- issue, branch, PR, checks, and handoff updates

Requires explicit current approval:

- destructive cleanup
- production publish/reject/bulk moderation
- switching production active prompt/model config
- modifying secrets or environment variables
- live LLM eval beyond an approved budget
- any production-mutating migration or data write

Never do:

- bypass captcha, login risk controls, or platform protections
- let collector output or LLM output write production tables directly
- copy SQL, detailed schema, prompt text, or business rules into this skill
- treat audit candidates as final conclusions without drilldown evidence

## Reporting

When reporting back, include:

- audit run directory
- candidate ids inspected
- evidence pack paths
- likely root cause and confidence
- proposed fix or next issue
- validation commands run
- any action that still needs operator approval
