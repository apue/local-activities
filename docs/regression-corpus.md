# Regression Corpus

This document defines the regression corpus strategy for the reset event
pipeline. The goal is to preserve product failures as deterministic replay cases
without depending on live WeChat, live LLM calls, or hosted production data
during CI.

## Current State

The project currently has useful cases in three layers:

| Layer | Location | Strength | Weakness |
| --- | --- | --- | --- |
| Self-contained regression corpus | `tests/regression-corpus/*` | committed, contract-validated, replayable through mock E2E | second real Beiping duplicate/update source is still operator-sourced |
| Vision eval labels | `tests/eval/vision-cases.json` | broadest real-world coverage | many cases depend on Supabase snapshot ids, not self-contained bundles |
| Production seed manifest | `tests/seed-corpus/production-seed-manifest.json` | product acceptance intent | mostly manifest references, not a full replay corpus |

The 15-case self-contained corpus is the primary CI-safe replay suite. Vision
eval labels and production seed references remain useful source inventory for
adding future cases, but they are not a substitute for committed article
bundles.

## Target Case Format

Self-contained cases live under:

```text
tests/regression-corpus/[case-id]/
case.json
captured-bundle.json
expected.json
assets/
```

`case.json` records labels and why the case matters. `captured-bundle.json`
stores the source material emitted by the capture contract. `expected.json`
stores product-level expectations such as event count, public eligibility,
evidence expectations, duplicate/update result, and publish state. `assets/`
stores small committed image fixtures only when they are necessary for QR,
poster, or image-dominant regression behavior.

Capture-failure cases use `capture-result.json` instead of
`captured-bundle.json`. This mirrors the capture contract: a failed capture has
a typed failure reason and diagnostics but no article bundle to validate or
extract evidence from.

Important live URLs may be listed as capture inputs, but they should not be the
only regression source because WeChat URLs can change, 404, require login, or
trigger platform checks.

## Coverage Inventory

| Product behavior | Existing coverage | Current layer | Status |
| --- | --- | --- | --- |
| Ordinary public event | `korean-red-flavor` | regression corpus | self-contained |
| Registration required | `registration-required-workshop` from `kr-red-taste-cooking-workshop` | regression corpus, eval | self-contained |
| QR registration | `qr-registration-poster` | regression corpus | self-contained |
| Poster or image-dominant event | `qr-registration-poster`, `sparse-poster-review` | regression corpus | self-contained metadata evidence |
| Mini-program or action registration | `beiping-mini-program-action` for URL `https://mp.weixin.qq.com/s/0Chl_ewq9yiDbjcBZmuwtQ` | regression corpus, live investigation | self-contained action metadata |
| Multi-event article | `italian-monthly-roundup` | regression corpus | self-contained |
| Long-running exhibition | `goethe-sonic-exhibition` | regression corpus | self-contained |
| Recurring or multiple occurrences | `goethe-weekly-library` | regression corpus | self-contained with explicit occurrences in `expected.json` |
| Duplicate/update pair | `beiping-beer-festival` | regression corpus | available fixture represented; second real operator-sourced pair still missing |
| Official visit or non-public news | `official-visit-news` | regression corpus | self-contained negative case |
| Not an event / cultural article | `japan-tofu-culture-article` | regression corpus, eval | self-contained negative case |
| Non-general-public or private/internal | `mexico-embassy-private-invitation` | regression corpus | self-contained negative case with `not_general_public` label |
| Recruitment/course/contest ambiguity | `goethe-youth-theater-recruitment`, `beiping-beer-festival-volunteer-recruitment`, `goethe-summer-language-course-signup`, `daad-photo-contest` | eval, seed | covered; split reject vs review expectations |
| Not Beijing event | `goethe-venice-biennale-german-pavilion` | regression corpus, eval | self-contained negative case |
| QR present but not registration | `qr-present-not-registration` | regression corpus | self-contained negative QR evidence case with `qr_present_not_registration` label |
| Sparse poster requires review | `sparse-poster-review` | regression corpus | self-contained review case with `information_sparse_requires_review` and `poster_or_image_dominant` labels |
| Capture blocked/login/captcha | `capture-fetch-blocked` | regression corpus | self-contained typed failure |

## Cases The Operator May Still Need To Source

The existing inventory is enough to start the reset implementation. Additional source
material is useful for:

- a real Beiping duplicate/update pair from two different article URLs
- a WeChat article where registration is primarily a mini-program card
- a page where all crucial event details are inside images with sparse text
- a capture failure example if a source produces login/captcha/fetch-blocked
  behavior during an approved live capture

When the operator finds a new bad case, add it first as a labeled eval case or
capture input, then promote it to a self-contained bundle if it becomes important
for CI regression.

## Expected Test Paths

The reset pipeline should support these paths:

```text
capture fixture -> CapturedArticleBundle contract test
CapturedArticleBundle -> EvidenceSet fixture test
CapturedArticleBundle + EvidenceSet + mocked LLM response -> normalized candidates
candidate set -> dedupe decision fixture test
candidate + evidence + dedupe decision -> publish-policy table test
fake modules -> pipeline orchestrator mock E2E
```

The corpus replay command validates the case contracts and runs a deterministic
mock E2E path through `runArticlePipelineOnce` for all 15 current cases:

```bash
pnpm regression:replay -- --all
```

It loads `captured-bundle.json`, runs `validateCapturedArticleBundle`, extracts
evidence with `extractEvidenceFromArticleBundle`, and injects fake
extract/dedupe/publish adapters from `expected.json`. Capture-failure cases load
`capture-result.json` and exercise the orchestrator capture failure path.

Live evaluation remains separate:

```text
live URL or Supabase snapshot -> live model eval -> usage recorded under eval label
```

Production acceptance remains separate:

```text
curated seed manifest -> production backend import -> operator checks public/admin/usage
```

## Promoting Future Bad Cases

Use the promotion CLI when a bad case has already been captured as JSON and
should become a committed regression case:

```bash
pnpm regression:promote -- --case-id <id> --label <label> --source-url <url> --rationale <text> --bundle-file <captured-bundle.json> --expected-action review --event-count 1
```

For negative bundle cases with no event draft, make the exclusion explicit:

```bash
pnpm regression:promote -- --case-id <id> --label <label> --source-url <url> --rationale <text> --bundle-file <captured-bundle.json> --expected-action exclude
```

For typed capture failures, provide the failure result instead of a bundle:

```bash
pnpm regression:promote -- --case-id <id> --label <label> --source-url <url> --rationale <text> --capture-result-file <capture-result.json>
```

Promotion is an offline file operation. It consumes already captured JSON and
must not call live WeChat, live LLM providers, hosted Supabase, or production
write paths. After promotion, run:

```bash
pnpm regression:replay -- --all
```

## Rules For Adding Cases

Each new case should include:

- stable case id
- source type and source URL or captured snapshot reference
- labels such as `positive`, `negative`, `qr_registration`, `multi_event`,
  `not_beijing_event`, `not_general_public`, or `duplicate_pair`
- expected public eligibility
- expected event count or range
- expected reservation requirement
- expected poster, QR, link, or mini-program evidence
- expected dedupe or update behavior when relevant
- short human rationale

Labels should test product behavior, not exact model wording. Prefer stable facts
over generated summaries.
