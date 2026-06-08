# Regression Corpus

This document defines the Event Pipeline V4 regression corpus strategy. The goal
is to preserve product failures as deterministic replay cases without depending
on live WeChat, live LLM calls, or hosted production data during CI.

## Current State

The project currently has useful cases in four layers:

| Layer | Location | Strength | Weakness |
| --- | --- | --- | --- |
| V4 self-contained regression corpus | `tests/regression-corpus/*` | committed, contract-validated, replayable through mock E2E | second real Beiping duplicate/update source is still operator-sourced |
| Deterministic fixtures | `fixtures/event-pipeline-v2/*` | committed, replayable, CI-safe | V2-shaped, some synthetic URLs/assets, legacy triage stages |
| Vision eval labels | `tests/eval/vision-cases.json` | broadest real-world coverage | many cases depend on Supabase snapshot ids, not self-contained bundles |
| Production seed manifest | `tests/seed-corpus/production-seed-manifest.json` | product acceptance intent | mostly manifest references, not a full replay corpus |

The V4 corpus is now the primary CI-safe replay suite. V2 fixtures, vision eval
labels, and production seed references remain useful source inventory for adding
future cases.

## Target Case Format

Self-contained cases should live under a V4 corpus directory once implemented:

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

| Product behavior | Existing coverage | Current layer | V4 status |
| --- | --- | --- | --- |
| Ordinary public event | `korean-red-flavor` | V4 corpus, V2 fixture | self-contained |
| Registration required | `registration-required-workshop` from `kr-red-taste-cooking-workshop` | V4 corpus, eval | self-contained |
| QR registration | `qr-registration-poster` | V4 corpus, V2 fixture | self-contained |
| Poster or image-dominant event | `qr-registration-poster` | V4 corpus, V2 fixture | self-contained metadata evidence |
| Mini-program or action registration | `beiping-mini-program-action` for URL `https://mp.weixin.qq.com/s/0Chl_ewq9yiDbjcBZmuwtQ` | V4 corpus, live investigation | self-contained action metadata |
| Multi-event article | `italian-monthly-roundup` | V4 corpus, V2 fixture | self-contained |
| Long-running exhibition | `goethe-sonic-exhibition` | V4 corpus, V2 fixture | self-contained |
| Recurring or multiple occurrences | `goethe-weekly-library` | V4 corpus, V2 fixture | self-contained with explicit occurrences in `expected.json` |
| Duplicate/update pair | `beiping-beer-festival` | V4 corpus, V2 fixture | available fixture represented; second real operator-sourced pair still missing |
| Official visit or non-public news | `official-visit-news` | V4 corpus, V2 fixture | self-contained negative case |
| Not an event / cultural article | `japan-tofu-culture-article` | V4 corpus, eval | self-contained negative case |
| Non-general-public or private/internal | `mexico-embassy-world-cup-private-invitation` | eval | covered in labels only; needs committed bundle |
| Recruitment/course/contest ambiguity | `goethe-youth-theater-recruitment`, `beiping-beer-festival-volunteer-recruitment`, `goethe-summer-language-course-signup`, `daad-photo-contest` | eval, seed | covered; split reject vs review expectations |
| Not Beijing event | `goethe-venice-biennale-german-pavilion` | V4 corpus, eval | self-contained negative case |
| QR present but not registration | `brazil-mouth-disease-recognition-news`, `japan-tsuda-umeko-biography`, `goethe-summer-language-course-signup` | eval | covered in labels; needs evidence-level fixture |
| Capture blocked/login/captcha | `capture-fetch-blocked` | V4 corpus | self-contained typed failure |

## Cases The Operator May Still Need To Source

The existing inventory is enough to start V4 implementation. Additional source
material is useful for:

- a real Beiping duplicate/update pair from two different article URLs
- a WeChat article where registration is primarily a mini-program card
- a page where all crucial event details are inside images with sparse text
- a private/internal embassy event that looks event-like but is not for the
  general Beijing public
- a capture failure example if a source produces login/captcha/fetch-blocked
  behavior during an approved live capture

When the operator finds a new bad case, add it first as a labeled eval case or
capture input, then promote it to a self-contained bundle if it becomes important
for CI regression.

## Expected Test Paths

V4 should support these paths:

```text
capture fixture -> CapturedArticleBundle contract test
CapturedArticleBundle -> EvidenceSet fixture test
CapturedArticleBundle + EvidenceSet + mocked LLM response -> normalized candidates
candidate set -> dedupe decision fixture test
candidate + evidence + dedupe decision -> publish-policy table test
fake modules -> pipeline orchestrator mock E2E
```

The V4 corpus replay command validates the case contracts and runs a deterministic
mock E2E path through `runArticlePipelineOnce`:

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
