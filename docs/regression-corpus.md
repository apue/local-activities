# Regression Corpus

This document defines the current regression corpus policy. The old committed
`tests/regression-corpus/*` data has been removed because several cases had
incomplete image assets and were not valid evidence for live vision evaluation.

## Current State

There is no trusted committed product regression corpus in the repository right
now.

The project still keeps the replay loader and deterministic replay harness in
`scripts/regression-corpus-replay.mjs`, but it must be pointed at an explicit
corpus directory:

```bash
pnpm regression:replay -- --corpus-dir <path> --all
```

Unit tests for the replay loader and evaluation runner generate temporary
contract-valid corpora at runtime. Those temporary corpora test the harness
itself; they are not model-quality benchmarks and must not be treated as product
acceptance data.

## Required Case Format

A trusted corpus case lives under an explicit corpus directory:

```text
<corpus-dir>/
manifest.json
[case-id]/
  case.json
  captured-bundle.json
  expected.json
  assets/
```

Capture-failure cases use `capture-result.json` instead of
`captured-bundle.json`.

`captured-bundle.json` must be real output from the capture contract. If a case
requires poster or QR understanding, it must include consumable image assets
through fields such as `publicUrl`, `dataUrl`, or storage-backed assets resolved
to provider-readable URLs. Raw upstream references such as
`images[*].sourceUrl` are metadata only.

Do not create corpus cases with fake image URLs or nonexistent assets. If a
case has useful text-only expectations but lacks real assets, mark it as not
eligible for live vision evaluation in `case.json`:

```json
{
  "evaluation": {
    "liveVisionEligible": false,
    "liveVisionReason": "No real poster or QR asset is available."
  }
}
```

## Coverage Targets

A future trusted corpus should cover:

- ordinary public event
- registration-required event
- QR registration
- poster or image-dominant article
- mini-program or action registration
- multi-event article
- recurring or multiple-occurrence event
- long-running exhibition
- duplicate or update pair
- official visit or non-public news
- non-general-public or private/internal item
- generic not-event/news article
- not-Beijing item
- QR present but not registration
- sparse-information review case
- capture failure such as `login_required`, `captcha_required`, or
  `fetch_blocked`

## Replay Boundary

Replay is offline and deterministic. It validates corpus structure, validates
captured bundles, extracts evidence from the bundle, and compares mocked
analysis/dedupe/publish expectations from `expected.json`.

Replay must not call live WeChat, live LLM providers, hosted Supabase, or
production write paths.

## Adding Cases

There is currently no promotion CLI. Add future cases through a reviewed PR that
includes:

- the captured bundle or capture failure result
- the expected product action and event count
- evidence expectations for posters, QR codes, links, or mini-program actions
- dedupe/update expectation when relevant
- a short rationale explaining the product behavior being protected

After a trusted corpus is created, run:

```bash
pnpm regression:replay -- --corpus-dir <path> --all
```
