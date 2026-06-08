# Regression Corpus

This document defines the Event Pipeline V4 regression corpus strategy. The goal
is to preserve product failures as deterministic replay cases without depending
on live WeChat, live LLM calls, or hosted production data during CI.

## Current State

The project currently has useful cases in three different layers:

| Layer | Location | Strength | Weakness |
| --- | --- | --- | --- |
| Deterministic fixtures | `fixtures/event-pipeline-v2/*` | committed, replayable, CI-safe | V2-shaped, some synthetic URLs/assets, legacy triage stages |
| Vision eval labels | `tests/eval/vision-cases.json` | broadest real-world coverage | many cases depend on Supabase snapshot ids, not self-contained bundles |
| Production seed manifest | `tests/seed-corpus/production-seed-manifest.json` | product acceptance intent | mostly manifest references, not a full replay corpus |

This means the project has many good examples, but not yet one clean regression
suite. V4 work should promote selected cases into self-contained bundles.

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

Important live URLs may be listed as capture inputs, but they should not be the
only regression source because WeChat URLs can change, 404, require login, or
trigger platform checks.

## Coverage Inventory

| Product behavior | Existing coverage | Current layer | V4 status |
| --- | --- | --- | --- |
| Ordinary public event | `thai-festival-beijing-2026`, `korean-red-flavor`, `goethe-open-day-german-summer` | eval, seed, V2 fixture | covered; promote one self-contained bundle |
| Registration required | `kr-red-taste-cooking-workshop`, `us-center-qr-lecture-2026-06` | eval, seed | covered; preserve registration fields |
| QR registration | `us-center-qr-lecture-2026-06`, `goethe-plant-persona-workshop`, `kr-opera-journey-registration`, `qr-registration-poster` | eval, seed, V2 fixture | covered; evidence classifier must be hardened |
| Poster or image-dominant event | `iic-save-the-date-image-sparse-multi-event`, `goethe-open-day-german-summer`, `qr-registration-poster` | eval, seed, V2 fixture | covered; needs self-contained images where required |
| Mini-program or action registration | Beiping beer festival live URL `https://mp.weixin.qq.com/s/0Chl_ewq9yiDbjcBZmuwtQ` exposed WeChat mini-program cards | live investigation | missing self-contained V4 case |
| Multi-event article | `goethe-weekend-roundup`, `italian-monthly-roundup`, `korean-june-film-lineup-multi-event` | eval, seed, V2 fixture | covered; expected event ranges need stable replay |
| Long-running exhibition | `goethe-sonic-exhibition`, `goethe-weekend-roundup` | V2 fixture, eval | covered; schedule expectations need clearer contract |
| Recurring or multiple occurrences | `goethe-weekly-library`, `korean-no-other-choice-two-screenings`, `goethe-weekend-roundup` | V2 fixture, eval | covered; occurrences should be explicit in expected output |
| Duplicate/update pair | `beiping-beer-festival`, `beiping-friendship-beer-festival-guide`, production seed duplicate placeholder | V2 fixture, eval, seed | weak; needs real paired bundle for Beiping update/dedupe |
| Official visit or non-public news | `official-visit-news`, `german-minister-visit-recap` | V2 fixture, eval, seed | covered; promote to self-contained negative case |
| Not an event / cultural article | `japan-tofu-culture-article`, `japan-kaomoji-culture-article`, `japan-tsuda-umeko-biography` | eval, seed | covered; promote at least one self-contained case |
| Non-general-public or private/internal | `mexico-embassy-world-cup-private-invitation` | eval | covered in labels only; needs committed bundle |
| Recruitment/course/contest ambiguity | `goethe-youth-theater-recruitment`, `beiping-beer-festival-volunteer-recruitment`, `goethe-summer-language-course-signup`, `daad-photo-contest` | eval, seed | covered; split reject vs review expectations |
| Not Beijing event | `goethe-ai-animation-nanjing`, `open-m-hangzhou-art-festival`, `goethe-venice-biennale-german-pavilion` | eval | covered; needs self-contained negative case |
| QR present but not registration | `brazil-mouth-disease-recognition-news`, `japan-tsuda-umeko-biography`, `goethe-summer-language-course-signup` | eval | covered in labels; needs evidence-level fixture |
| Capture blocked/login/captcha | typed failures discussed in architecture | none | missing; add fake capture fixtures first |

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
