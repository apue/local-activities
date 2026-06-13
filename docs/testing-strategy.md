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

The trusted committed product corpus lives in `tests/regression-corpus`. It uses
public-safe source-like bundles for deterministic replay, plus selected
provider-readable public image references for live vision smoke. It includes
public events, registration-required cases, multi-event and long-running cases,
recurring occurrences, and negative news/non-public/not-Beijing cases.

The committed corpus does not include full third-party article mirrors or copied
article images. Expected outcomes must stay in `expected.json` and must not leak
into captured bundle text, HTML, links, or image metadata. Production acceptance
still uses real Wechat2RSS capture bundles uploaded through the capture worker;
the committed corpus is for regression and smoke, not a substitute for the
production ingestion path.

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

Phase 2 implements this as `pipeline:v5:eval`. The default path must use mocked
variants, memory/local artifacts, and no hosted writes. Any live provider
comparison must remain explicit, budgeted, data-class scoped, and must not write
production drafts or canonical events.

Live model smoke uses the `live-configured` evaluation variant and is opt-in
only. The command must include `--allow-live`, `--max-cost-cny`, and provider
config loaded with `--env-file`. Tests cover this fail-closed behavior with fake
providers; CI should keep using mocked variants.

Private raw corpora are allowed for local evaluation when the committed
public-safe corpus cannot exercise poster, QR, or long-image behavior. They must
follow the same corpus contract as `tests/regression-corpus`, stay outside the
repository, and write only evaluation artifacts.

## Agent-Operable Phase 1 Regression Gate

Agent-operable work must keep the V5 baseline stable while adding audit,
feedback, private-corpus, config, and public-acceptance surfaces. The default
gate is:

```bash
pnpm agent:regression-gate
```

This command runs, in order:

- `pnpm test`
- `pnpm typecheck`
- `pnpm pipeline:v5:replay -- --corpus-dir tests/regression-corpus --all --store memory`
- `pnpm pipeline:v5:eval -- --corpus-dir tests/regression-corpus --all --store memory`

Use `pnpm agent:regression-gate -- --dry-run` to inspect the gate plan without
running it. The gate must remain deterministic and must not require live WeChat,
live LLM, or production writes.

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
