# Vision Eval And Bad-Case Workflow

This workflow explains how to preserve useful failures, add labeled vision eval
cases, and audit dirty hosted data before cleanup.

## Files And Commands

- Case file: `tests/eval/vision-cases.json`
- Vision model runner: `scripts/siliconflow-vision-eval.mjs`
- Data audit and hygiene runner: `scripts/data-hygiene.mjs`

Useful commands:

```bash
pnpm eval:vision -- --case-file tests/eval/vision-cases.json --help
pnpm eval:vision -- --env-file .env.local --case-file tests/eval/vision-cases.json --models Qwen/Qwen3-VL-8B-Instruct --max-images 3 --detail low --live
pnpm data:audit -- --env-file .env.local --limit 1000
pnpm data:hygiene -- --env-file .env.local --limit 1000 --dry-run
```

`pnpm eval:vision` spends provider credit only with `--live`. `pnpm
data:audit` and `pnpm data:hygiene -- --dry-run` are read-only or non-mutating.
Do not run cleanup or publish commands against hosted data without explicit
operator approval in the current conversation.

## When To Add A Case

Add a case when a source reveals a behavior the product must remember:

- a public event is missed or classified as news
- a news, recap, official visit, or internal event is falsely accepted
- a QR code, registration requirement, poster, or reservation detail is missed
- a page contains multiple events
- a schedule is long-running, recurring, or otherwise easy to flatten
- duplicate or updated event evidence is confusing

Bad cases are more valuable before cleanup. If a hosted row is dirty but
captures a useful failure, add or update an eval case before deleting,
quarantining, or recapturing it.

## Source Types

Use `supabase_snapshot` when the article has already been captured in hosted
Supabase and the snapshot contains enough text and evidence to replay the case.
This avoids committing full article mirrors and is usually the preferred source
for known failures.

Use `live_url` when the article has not been captured yet, or when the live page
itself is the behavior under test. Live URLs can 404, change, or become blocked,
so convert important live cases to captured snapshots when possible.

## Label Checklist

Each case should include:

- stable `id`
- human-readable `title`
- `source.type` with either `url` or `snapshotId` plus `articleUrl`
- `tags` such as `positive`, `negative`, `multi_event`, `qr_registration`, or
  `official_visit`
- `label.expectedAction` as `extract` or `exclude`
- `label.triageDecision`
- `label.publicEligibility`
- exact `expectedEventCount`, or `expectedEventCountMin` and
  `expectedEventCountMax`
- `requiresReservation`
- `expectsQrEvidence`
- short `rationale` explaining the human judgment

Labels should test product behavior, not provider phrasing. Prefer stable facts
such as public eligibility, event count, reservation requirement, and QR evidence
over exact generated summaries.

## PR Workflow

1. Run `pnpm data:audit -- --env-file .env.local --limit 1000` if the case comes
   from dirty hosted data.
2. Add or update the case in `tests/eval/vision-cases.json`.
3. Run `pnpm eval:vision -- --case-file tests/eval/vision-cases.json --help` for
   a no-credit syntax check.
4. If credentials and budget are available, run a focused live eval with
   `--live` and record model, cost, false positives, false negatives, QR recall,
   and action accuracy in the PR.
5. Keep the change in a normal issue and PR. The PR should explain why the human
   label is correct enough for regression testing.

For CI and routine local validation, do not require live WeChat crawling or live
LLM calls. Use recorded fixtures and mocked provider responses for system
behavior tests, and use the labeled eval set for operator-run model comparison.
