# Regression Corpus

This document defines the current regression corpus policy. The committed corpus
under `tests/regression-corpus` is public-safe regression data. It is the
default product regression set for V5 offline pipeline replay.

## Current State

The trusted corpus currently contains 18 cases. Most are source-like local
fixtures derived from earlier local Wechat2RSS captures; one QR/poster case
keeps provider-readable public image URLs for V5 live vision smoke. It includes
public events, registration-required cases, the
Beiping beer festival mini-program case, multi-event and long-running exhibition
cases, recurring occurrences, and negative news/non-public/not-Beijing cases.

Because the repository is public, committed cases intentionally do not mirror
full third-party article HTML or copied image files. Their bundles contain
concise source-like text, source metadata, and selected public image references
where needed. Expected outcomes live only in `expected.json` and must never be
embedded in model input fields such as `captured-bundle.json` text, HTML, links,
or image metadata.

V5 replay must point at an explicit corpus directory:

```bash
pnpm pipeline:v5:replay -- --corpus-dir tests/regression-corpus --all --store memory
```

Unit tests for the replay loader may generate temporary contract-valid corpora
at runtime. Those temporary corpora test the harness itself; they are not
model-quality benchmarks and must not be treated as product acceptance data.

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
may be public-safe source-like fixtures rather than complete article mirrors.
If a committed or private local case requires poster or QR understanding, it
must include consumable image references through fields such as `sourceUrl`,
`publicUrl`, `dataUrl`, or storage-backed assets resolved to provider-readable
URLs. `localhost`/`127.0.0.1` image proxy URLs are not valid corpus assets.

Do not create corpus cases with fake image URLs, nonexistent assets, or hidden
answer labels. If a case has useful text-only expectations but lacks real
poster/QR assets, its expected result should reflect the missing evidence, for
example by routing to review instead of expecting automatic publication.
Optionally mark it as not eligible for live vision evaluation in `case.json`:

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

- duplicate/update: needs a stateful dedupe candidate-set harness
- QR present but not registration: no reliable real footer/share QR sample was
  exposed by the current local cache
- capture failure: Wechat2RSS was healthy during the rebuild

## Replay Boundary

Replay is offline and deterministic. It validates corpus structure, validates
captured bundles, and runs the V5 Phase 1 node chain against expectations from
`expected.json`.

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
pnpm pipeline:v5:replay -- --corpus-dir tests/regression-corpus --all --store memory
```
