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
article images. It is suitable for V5 deterministic replay and pipeline
contract regression. Live vision checks for posters or registration QR codes
require a private local corpus rebuilt from Wechat2RSS and kept outside the
public repository.

V5 replay is the active corpus replay path. Every run must point to an explicit
corpus directory.

Unit tests for the replay loader may create temporary contract-valid corpora at
runtime. Those temporary corpora verify the harness itself; they are not product
acceptance data.

Replay must run without network/provider/production writes. New corpus cases are
added by reviewed PRs with public-safe derived captured bundles or explicit
capture-failure results; there is no active promotion CLI. Coverage gaps such as
poster/QR vision assets, stateful duplicate/update cases, and real capture
failures are recorded in
`tests/regression-corpus/manifest.json`.

## Event Pipeline V5 Phase 1 Replay

V5 Phase 1 adds a node-by-node offline replay harness for the future LLM/editor
pipeline. Its default path is deterministic and uses the committed regression
corpus, mock providers, memory artifacts, and no hosted writes:

```bash
pnpm pipeline:v5:replay -- --corpus-dir tests/regression-corpus --all --store memory
```

Use local artifact mode when debugging node inputs, outputs, or lineage:

```bash
pnpm pipeline:v5:replay -- --corpus-dir tests/regression-corpus --all --store local
```

Local artifact mode writes under `tmp/v5-replay-runs` unless `--artifact-dir` is
provided. V5 replay refuses production target and live-provider flags in Phase 1.

## V5 Model Evaluation

The reset-era Node evaluation runner has been removed as an active entrypoint.
The next evaluation surface should be built on top of V5 node contracts and
replay artifacts, so model/prompt comparisons inspect the same packet,
extraction, validation, editor, usage, and publish-trace records as the active
pipeline.

Until that V5 evaluation runner exists, model evaluation is not an active
package command. Any future live provider comparison must remain explicit,
budgeted, data-class scoped, and must not write production drafts or canonical
events.

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
