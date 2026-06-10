# Testing Strategy

## Purpose

Every feature must be independently verifiable. Default validation must not
require live WeChat, live LLM calls, hosted writes, or production public-event
mutation.

## General Rules

- Prefer small, focused tests around module contracts.
- Use explicit fixture or replay corpora for capture, analysis, dedupe,
  publication, and UI.
- Record validation commands in PRs and issue handoffs.
- Keep production-mutating commands explicit and logged.
- Preserve known failures as regression cases.

## Capture Worker

Test focus:

- Wechat2RSS health and article normalization.
- article bundle creation with manifest, HTML, text, links, images, and
  diagnostics.
- image preservation without business classification.
- Storage upload request shape.
- Edge Function trigger request shape.
- idempotency by source URL and content hash.

Expected checks:

- mocked Wechat2RSS tests
- bundle contract tests
- mocked Supabase Storage tests
- mocked Edge Function trigger tests
- optional live Wechat2RSS smoke when credentials and login state are present

## Supabase Edge Analysis

Test focus:

- request authentication and schema validation.
- Storage bundle loading.
- multimodal LLM request assembly.
- model output parsing and validation.
- ledger writes for published, review, excluded, duplicate, and failed outcomes.
- evidence asset selection and Storage path handling.
- `data_class` write isolation across `production`, `eval`, `test`, and
  `smoke`.

Expected checks:

- Edge Function local serve smoke
- mocked provider tests
- fixture bundle analysis tests
- malformed provider response tests
- usage accounting tests
- optional live LLM smoke within approved budget

## Regression Corpus

The trusted committed product corpus lives in `tests/regression-corpus`. It was
rebuilt as public-safe derived bundles from real locally captured Wechat2RSS
article bundles. It includes public events, registration-required cases,
multi-event and long-running cases, recurring occurrences, and negative
news/non-public/not-Beijing cases.

The committed corpus does not include full third-party article mirrors or copied
article images. It is suitable for deterministic replay, mocked evaluation, and
pipeline contract regression. Live vision checks for posters or registration QR
codes require a private local corpus rebuilt from Wechat2RSS and kept outside
the public repository.

Replay remains available, but every run must point to an explicit corpus
directory:

```bash
pnpm regression:replay -- --corpus-dir tests/regression-corpus --all
```

Unit tests for the replay loader and evaluation runner may create temporary
contract-valid corpora at runtime. Those temporary corpora verify the harness
itself; they are not product acceptance data.

Replay must run without network/provider/production writes. New corpus cases are
added by reviewed PRs with public-safe derived captured bundles or explicit
capture-failure results; there is no active promotion CLI. Coverage gaps such as
poster/QR vision assets, stateful duplicate/update cases, and real capture
failures are recorded in
`tests/regression-corpus/manifest.json`.

## Evaluation

Evaluation tests compare extractor variants through the reusable evaluation
runner:

```text
provider + model + promptVersion + schemaVersion + parameters
```

CI-safe validation uses mocked variants, memory storage, and an explicit corpus:

```bash
pnpm eval:run -- --corpus-dir tests/regression-corpus --store memory --variant mock-expected-v1 --variant mock-overfilter-v1
```

Local artifact runs write to `tmp/evaluation-runs` by default. Hosted writes are
explicit with `--store supabase` and are limited to `evaluation_runs`,
`evaluation_case_results`, `llm_usage_ledger`, and the `eval-artifacts` bucket.
Hosted evaluation metadata must use `data_class='eval'`.

Expected checks:

- scorer unit tests
- mocked evaluation run
- artifact write/read tests
- usage/cost aggregation tests
- optional live model comparison with budget guard

The evaluation runner must never write production drafts or canonical events.
Use the Supabase Edge Function with `dataClass=eval`, `test`, or `smoke` only
when intentionally testing product-shaped analysis writes outside production.
The default evaluation path must not call live LLM providers; live variants
require `--variant live-configured --allow-live --max-cost-cny <n>`. Live vision
variants should use a private local corpus directory that includes consumable
image assets, not the public-safe committed corpus.

## Admin/Public UI

Public checks:

- upcoming event filtering
- event cards and detail pages
- poster and registration QR rendering
- no admin diagnostics on public pages
- raw WeChat or localhost image URLs are absent from public pages

Admin checks:

- draft review
- reject with reason
- ledger/article audit filters
- usage summaries
- evaluation report summaries
- auth failure handling

## Documentation-Only Changes

For documentation-only PRs:

- inspect the diff for internal consistency
- verify added links and file paths
- run targeted grep checks when docs remove or rename active paths
