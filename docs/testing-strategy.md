# Testing Strategy

## Purpose

Every feature must be independently verifiable. Default validation must not
require live WeChat, live LLM calls, hosted writes, or production public-event
mutation.

## General Rules

- Prefer small, focused tests around module contracts.
- Use fixtures and replay for capture, analysis, dedupe, publication, and UI.
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
- production/eval write isolation.

Expected checks:

- Edge Function local serve smoke
- mocked provider tests
- fixture bundle analysis tests
- malformed provider response tests
- usage accounting tests
- optional live LLM smoke within approved budget

## Regression Corpus

The 15-case self-contained corpus should include ordinary events,
registration-required events, QR registration, image-dominant articles,
multi-event articles, long-running exhibitions, recurring events,
duplicate/update pairs, non-public official items, non-events/news, not-Beijing
posts, false QR evidence, and sparse-info review cases.

Replay must run without network/provider/production writes.

Promoting future bad cases must use already captured JSON through
`pnpm regression:promote`; promotion must not call live WeChat, live LLM
providers, hosted Supabase, or production write paths.

## Evaluation

Evaluation tests compare extractor variants:

```text
provider + model + promptVersion + schemaVersion + parameters
```

Expected checks:

- scorer unit tests
- mocked evaluation run
- artifact write/read tests
- usage/cost aggregation tests
- optional live model comparison with budget guard

Evaluation must never write production drafts or canonical events.

## Admin/Public UI

Public checks:

- upcoming event filtering
- event cards and detail pages
- poster and registration QR rendering
- no admin diagnostics on public pages
- fixture/test copy is absent from production pages

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
