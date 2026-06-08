# Event Pipeline Architecture

This document defines the active Event Pipeline V4 module contracts. It is the
current source of truth for implementation boundaries; older V2/V3 goal packs
are historical records only.

## Active Runtime Boundary

The production WeChat runtime is Mac-local. The operator runs Wechat2RSS and any
approved agent-browser capture locally so login state, account health, and
platform-risk prompts can be handled on the Mac. Vercel hosts the Next.js app,
backend APIs, public catalog, admin portal, usage views, and read-only smoke
checks. Vercel does not run the WeChat crawler for this MVP slice.

Collectors and browser/capture tools emit untrusted source material. The backend
validates schemas, performs dedupe and publication policy, records decisions,
and owns final public state.

## Pipeline

The V4 pipeline is:

```text
CaptureSource
-> CapturedArticleBundle
-> EvidenceExtractor
-> LLMEventExtractor
-> NormalizeAndValidate
-> DedupeResolver
-> PublishPolicy
-> BackendIngest
-> Admin/Public surfaces
```

Only the live `LLMEventExtractor` provider call is allowed to be
non-deterministic. Every other node must have clear inputs, clear outputs, and a
deterministic fixture or mock test path.

The active extraction policy is a single LLM information-processing call that
extracts event facts and judges public eligibility. Do not add a mandatory
separate triage prefilter unless this document is updated in a reviewed PR.
Legacy `triage_*` database fields and fixture labels may remain as compatibility
state until a later migration removes them.

## Module Contract Matrix

Scripts are command wrappers. Product logic belongs in modules with the
contracts below.

| Node | Preferred Module Location | Input | Output | Allowed Side Effects | Forbidden Responsibilities | Independent Tests |
| --- | --- | --- | --- | --- | --- | --- |
| Config | `src/config/*` | env vars and CLI flags | typed local app, collector, LLM, storage, smoke configs | none | network calls, production writes, implicit destructive defaults | env fixture tests |
| CaptureSource | `src/collector/capture/*` | URL, Wechat2RSS item, or local bundle reference | `CaptureResult` with `CapturedArticleBundle` or typed failure | local Wechat2RSS read, approved browser automation, optional local file reads | LLM calls, event classification, dedupe, publishing, direct database writes | fake URL, fake Wechat2RSS, blocked/login/captcha fixtures |
| Capture runtime cleanup | `src/collector/capture/runtime/*` | runner config and session id | session summary and close result | launches/closes browser resources when needed | leaving browser sessions open by default, killing unrelated user browsers | fake runner tests and process-leak smoke when approved |
| EvidenceExtractor | `src/collector/evidence/*` | `CapturedArticleBundle` | `EvidenceSet` with poster, QR, links, mini-program/action, article-image evidence | optional asset fetch/storage through adapter when explicit | public eligibility, LLM calls, publish decisions | HTML/image fixtures for poster, QR, false QR, mini-program action |
| AssetStorage | `src/storage/*` | asset bytes or references plus metadata | stored asset id, URL, media metadata | object storage writes in explicit write modes | event semantics, source health, publication decisions | fake adapter tests, optional live storage smoke |
| LLMEventExtractor | `src/extraction/*` | bundle plus evidence and prompt config | raw provider response, parsed extraction result, usage | LLM API call only in explicit live mode | crawling, backend upload, direct DB writes, final publish | provider mock tests, recorded response replay, focused live eval |
| NormalizeAndValidate | `src/extraction/*` or `src/server/ingest/*` | raw extraction output | validated event candidates, parse errors, normalized fields | none | crawling, provider calls, publication state transitions | schema and malformed-output tests |
| Collector upload | `src/collector/upload-client/*` | source run, snapshots, evidence, extraction result | backend ids and upload summary | HTTP writes to collector API | schema reinterpretation, direct Supabase writes, publish bypass | mocked backend tests |
| Backend ingest | `src/server/ingest/*` | authenticated collector payload | persisted source rows, drafts, evidence refs | Supabase/Postgres writes through backend services | trusting collector/LLM output, final publication without policy | service tests with fake/local stores |
| DedupeResolver | `src/server/dedupe/*` | candidate plus candidate lookup results | new, same, update, possible_duplicate, reject, review | DB reads and decision persistence when called by backend | crawling, extraction, public rendering | candidate-set fixtures, duplicate/update pairs |
| PublishPolicy | `src/server/publication/*` or `src/server/publish-policy.*` | validated draft, evidence, dedupe decision, admin action | public, needs_review, rejected, needs_info, blocked state plus reasons | DB state transition when called by backend/admin service | parsing source HTML, calling crawler/LLM, hiding blockers | policy table tests |
| PipelineOrchestrator | `src/pipeline/*` or `src/collector/orchestrator/*` | module adapters and run config | stage-by-stage run report | calls configured modules; closes resources in `finally` | hidden business rules, direct DB writes outside adapters | mock E2E with fake modules and failure tests |
| Usage ledger | `src/server/usage/*` and collector usage helpers | provider usage payload | persisted usage record and admin summary | usage writes through approved backend path | changing publish state, conflating eval and production usage | aggregation and dedupe tests |
| Admin actions | `src/server/admin/*`, `app/admin/*` | authenticated operator action | draft/source/run state updates | backend writes and admin cookie/session | re-running extraction logic, bypassing blockers silently | route tests and browser/admin smoke |
| Public catalog | `src/server/public/*`, `app/page.tsx` | published canonical events | public event list/detail data | read-only DB access | admin diagnostics, draft states, model details | render tests and browser smoke |

## Shared Contracts

Cross-node contracts must be schema-validated when they cross process or API
boundaries.

```text
CaptureResult
CapturedArticleBundle
EvidenceSet
StoredAsset
ExtractionRequest
ExtractionResult
NormalizedEventCandidate
DedupeDecision
PublishDecision
PipelineRunReport
UsageRecord
RegressionCase
ProductionSeedManifest
```

`CapturedArticleBundle` must carry enough material for deterministic replay:

```text
sourceUrl
canonicalUrl
title
authorName
publishedAt
text
html
images[]
links[]
miniPrograms[]
contentHash
captureMode
diagnostics[]
captureWarnings[]
```

Image and action evidence should be represented as metadata plus stored asset
references when storage is enabled. The product should not depend on permanent
full article mirrors.

## Boundary Rules

Source providers answer only:

```text
Is this source healthy?
Which articles are available?
What raw material did the source provide?
Did capture fail for a typed reason?
```

Evidence extraction answers only:

```text
Which source images, links, and actions might matter?
Which assets look like posters, QR codes, registration links, or mini-program actions?
Which evidence is explicitly non-registration or ambiguous?
```

LLM extraction answers only:

```text
Is the article a public activity lead?
Which event candidates and facts are present?
What evidence, missing fields, confidence, public eligibility, and usage were found?
```

Backend publication answers only:

```text
Can this candidate become public?
Should it be reviewed, rejected, merged, updated, or blocked?
What will users actually see?
```

## Error Handling

Every pipeline stage must return typed failures instead of hiding errors in logs:

```text
stage
reason
message
retryable
sourceUrl
diagnostics
```

Common capture reasons include `login_required`, `captcha_required`,
`fetch_blocked`, `not_found`, `browser_error`, and `source_unhealthy`.

The orchestrator must close capture/browser resources in `finally`. Keeping an
agent-browser session open is an explicit operator/debug option, not the default.

## Testability Requirements

Each implementation issue must state which node contracts it touches and how
those nodes are independently tested. An issue is incomplete if it only proves
behavior through one full live E2E run.

Use this minimum mapping:

- pure transformation or policy: unit test
- provider response consumption: fixture/replay test
- LLM provider wiring: mocked provider test plus optional live eval
- browser/source wiring: fake runner test plus optional live smoke
- production write behavior: explicit production command plus import report

Default CI and routine local validation must not require live WeChat crawling,
live LLM calls, hosted Supabase writes, or production public-catalog writes.

## Supervisor Loop

V4 implementation uses a supervisor loop:

```text
docs and issues define contract
-> implementer subagent completes one issue
-> supervisor runs contract review and validation
-> failed checks become concrete fix instructions or follow-up issues
-> loop repeats until deterministic acceptance passes or a real blocker appears
```

Real blockers include expired WeChat login, captcha, unavailable provider keys,
provider outage, missing Supabase/Vercel credentials, or an operator approval
requirement for production-mutating commands.

## Production Acceptance

Production seed import is product acceptance, not a default test. It must use
real official-account source material and write through the same backend ingest,
dedupe, publication, admin, storage, and usage paths as a normal collector run.

The operator validates the result from:

- public catalog pages
- admin draft/review pages
- source run and evidence surfaces
- usage dashboard

Rows created by production acceptance are production data. They must not carry
fixture labels, synthetic summaries, placeholder source URLs, or test-only
titles.
