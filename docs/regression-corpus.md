# Regression Corpus

This document defines the current regression corpus policy. The committed corpus
under `tests/regression-corpus` is public-safe regression data derived from real
locally captured Wechat2RSS article bundles. It is the default product
regression set for offline pipeline replay and mocked evaluation.

## Current State

The trusted corpus currently contains 17 cases derived from the local Wechat2RSS
cache on 2026-06-10. It includes public events, registration-required cases, the
Beiping beer festival mini-program case, multi-event and long-running exhibition
cases, recurring occurrences, and negative news/non-public/not-Beijing cases.

Because the repository is public, committed cases intentionally do not mirror
full third-party article HTML or image assets. Their bundles contain concise
derived factual text, expected outcomes, and source metadata. Use a private local
corpus rebuilt from Wechat2RSS when validating live vision behavior for posters
or registration QR codes.

Replay must still point at an explicit corpus directory:

```bash
pnpm regression:replay -- --corpus-dir tests/regression-corpus --all
```

Unit tests for the replay loader and evaluation runner generate temporary
contract-valid corpora at runtime. Those temporary corpora test the harness
itself; they are not model-quality benchmarks and must not be treated as product
acceptance data.

CI-safe evaluation can consume the same corpus through mocked variants:

```bash
pnpm eval:run -- --corpus-dir tests/regression-corpus --store memory --variant mock-expected-v1 --variant mock-overfilter-v1
```

## Required Case Format

A trusted corpus case lives under an explicit corpus directory:

```text
<corpus-dir>/
manifest.json
[case-id]/
  case.json
  captured-bundle.json
  expected.json
  assets/                  optional, for private/local vision corpora only
```

Capture-failure cases use `capture-result.json` instead of
`captured-bundle.json`.

Committed `captured-bundle.json` files must conform to the capture contract, but
may be public-safe derived bundles rather than complete article mirrors. If a
private local case requires poster or QR understanding, it must include
consumable image assets through fields such as `publicUrl`, `dataUrl`, or
storage-backed assets resolved to provider-readable URLs. Raw upstream
references such as `images[*].sourceUrl` are metadata only.

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

## Coverage

The manifest declares the current required coverage labels. Labels are based on
real available captured data, not synthetic fillers.

Current covered labels:

- ordinary public event
- registration-required event
- mini-program/action article
- multi-event article
- recurring or multiple-occurrence event
- long-running exhibition
- official visit or non-public news
- non-general-public or private/internal item
- generic not-event/news article
- not-Beijing item
- sparse-information review case

Known gaps are recorded in `manifest.json`:

- QR registration: the public repository does not commit third-party QR images
- poster or image-dominant articles: the public repository does not commit
  third-party poster/image assets
- duplicate/update: needs a stateful dedupe candidate-set harness
- QR present but not registration: no reliable real footer/share QR sample was
  exposed by the current local cache
- capture failure: Wechat2RSS was healthy during the rebuild

## Replay Boundary

Replay is offline and deterministic. It validates corpus structure, validates
captured bundles, extracts evidence from the bundle, and compares mocked
analysis/dedupe/publish expectations from `expected.json`.

Replay must not call live WeChat, live LLM providers, hosted Supabase, or
production write paths.

## Adding Cases

There is currently no promotion CLI. Add future cases through a reviewed PR that
includes:

- the public-safe derived captured bundle or capture failure result
- the expected product action and event count
- evidence expectations for links or mini-program actions
- dedupe/update expectation when relevant
- a short rationale explaining the product behavior being protected

Private local corpora may include full captured bundles and case-local `assets/`
directories for live vision checks. Do not commit full third-party article
mirrors or copied article images to the public repository.

After adding or changing cases, run:

```bash
pnpm regression:replay -- --corpus-dir tests/regression-corpus --all
pnpm eval:run -- --corpus-dir tests/regression-corpus --store memory --variant mock-expected-v1 --variant mock-overfilter-v1
```
