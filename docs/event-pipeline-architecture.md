# Event Pipeline Architecture

This document defines the Event Pipeline V3 module boundaries. Implementation
work must keep these boundaries clear so each node can be tested independently
and future agents can identify the active production path without chat history.

## Active Runtime Boundary

The current production collector runtime is a Mac-local Wechat2RSS service. It
is operated outside Vercel so the operator can manage WeChat login and account
risk locally. Vercel hosts the web app and backend APIs; it does not run the
production WeChat crawler in this slice.

The collector emits normalized payloads and uploads them through backend APIs.
The backend validates, deduplicates, computes publish blockers, and owns final
publication state.

## Pipeline Node Contract Matrix

Every node below must expose a focused module API. Scripts may call these
modules, but scripts must not become the only place where product logic lives.

| Node | Module Location | Input | Output | Allowed Side Effects | Forbidden Responsibilities | Independent Tests |
| --- | --- | --- | --- | --- | --- | --- |
| Config | `src/config/*` | env vars and CLI flags | typed local app, collector, LLM, storage, and smoke configs | none | network calls, production writes, implicit defaults for destructive commands | env fixture tests for valid, missing, and invalid values |
| Wechat2RSS health | `src/collector/source-providers/wechat2rss/health.ts` | Wechat2RSS login/account API response | source health state and failure reason | none | article fetching, LLM calls, publication decisions | mocked login responses including expired, missing, and healthy accounts |
| Wechat2RSS client | `src/collector/source-providers/wechat2rss/client.ts` | base URL, token, date range | raw Wechat2RSS article records | HTTP read to local Wechat2RSS only | normalization, evidence extraction, backend upload | mocked fetch tests plus `smoke:wechat2rss` live read-only smoke |
| Article normalization | `src/collector/source-providers/wechat2rss/normalize.ts` | raw article record | normalized article candidate | none | activity classification, dedupe, storage | raw article fixtures for URL, title, dates, author, HTML, text, and hashes |
| Snapshot builder | `src/collector/snapshot/*` | normalized article candidate | `ArticleSnapshot` payload | none | LLM calls, storage, publish policy | fixture tests for text, URL, content hash, capture mode, language hints |
| Evidence extraction | `src/collector/evidence/*` | article HTML, text, image metadata | evidence candidates and asset requests | optional HTTP image reads when explicitly enabled | deciding public eligibility, publishing, permanent mirroring | HTML and image fixtures for poster, QR, article image, image-dominant pages |
| Storage adapter | `src/storage/*` | asset bytes or text plus metadata | stored asset id, URL, media metadata | object storage writes | event semantics, source health, publication decisions | fake adapter tests and optional live storage smoke with explicit env |
| LLM extraction | `src/extraction/*` | `ArticleSnapshot` plus `EvidenceAsset[]` | classification, event candidates, field evidence, missing fields, usage | LLM API call only when live mode is explicit | crawling, backend writes, final publish, direct Supabase writes | provider mock tests, recorded response replay, focused live eval/smoke |
| Collector upload | `src/collector/upload-client/*` | source run, snapshots, evidence, extraction result | backend ids and upload summary | HTTP write to collector API | schema reinterpretation, direct database writes, publish transitions | mocked backend tests for auth, retries, idempotency, failure summaries |
| Collector orchestration | `src/collector/orchestrator/*` | collector config and source scope | run summary and report | calls source, extraction, storage, and upload modules | hidden business rules, UI rendering, direct database writes | mocked node tests and live Wechat2RSS run only with explicit env |
| Backend ingest | `src/server/ingest/*` | collector API payloads | persisted untrusted source rows and draft inputs | Supabase/Postgres writes | trusting collector output, final publication without policy | service tests with fake or local stores, schema rejection tests |
| Dedupe and resolution | `src/server/dedupe/*` | draft candidate plus existing candidates | new, same, update, reject, or review decision | DB read and decision persistence when called by backend | crawling, extraction, public rendering | candidate-set fixtures, duplicate pairs, update/cancel cases |
| Publication policy | `src/server/publication/*` | validated draft, blockers, dedupe decision, admin action | published, review, rejected, needs info, duplicate state | DB state transitions | parsing source HTML, calling crawler, hiding blockers | policy table tests for confidence, missing fields, QR, duplicate, non-public |
| Usage ledger | `src/server/usage/*` and collector usage helpers | provider usage payload | persisted usage record and admin summary | usage writes through backend or approved ledger path | changing publish state, conflating eval and production usage | unit tests for environment labels, aggregation, duplicate protection |
| Admin actions | `src/server/admin/*`, `app/admin/*` | authenticated operator action | draft/source/run state update | backend writes, admin cookie/session | re-running extraction logic, bypassing blockers silently | route tests plus browser smoke for publish, needs-info, reject, source URL |
| Public catalog | `src/server/public/*`, `app/page.tsx` | published canonical events | public event list/detail data | read-only DB access | admin diagnostics, draft states, model details | render tests and browser smoke for schedules, posters, QR, duplicates |
| Production seed import | `src/seed-production/*` and `scripts/seed-production-events.*` | curated manifest and explicit approval | production run report and created/updated ids | production backend writes | acting as eval/replay, using mocks, bypassing backend ingest | dry-run tests, manifest validation, operator-run production acceptance |

## Shared Contracts

Use versioned contracts for cross-node payloads:

- `SourceRun`
- `ArticleSnapshot`
- `EvidenceAsset`
- `ExtractionResult`
- `EventDraftInput`
- `DedupeDecision`
- `PublishDecision`
- `UsageRecord`
- `ProductionSeedManifest`
- `ProductionSeedReport`

Contracts may live in `src/contracts/*` or narrower module contracts when they
are not shared across backend and collector code. Cross-boundary contracts must
be schema-validated.

## Boundary Rules

Source providers answer only:

```text
Is this source healthy?
Which articles are available?
What raw material did the source provide?
```

LLM extraction answers only:

```text
Is the article a public activity lead?
Which event candidates are present?
What facts, evidence assets, missing fields, confidence, and usage were found?
```

Backend publication answers only:

```text
Can this event become public?
Should it be reviewed, rejected, merged, or blocked?
What will users actually see?
```

## Testability Requirements

Each implementation issue must state which node contracts it touches and how
those nodes are independently tested. An issue is incomplete if it only proves
behavior through one full E2E run.

Use this minimum mapping:

- pure transformation or policy: unit test
- provider response consumption: fixture/replay test
- external service wiring: smoke test guarded by env and operator approval
- production write behavior: explicit production command plus import report

No default CI or routine local command should require live WeChat crawling, live
LLM calls, hosted Supabase writes, or production public-catalog writes.

## Production Acceptance

The curated production seed import is a product acceptance run, not a unit test
or eval. It must use real official-account source material and write through the
same backend ingest, dedupe, publication, admin, storage, and usage paths that a
normal collector run uses.

The operator validates the result from:

- public catalog pages
- admin draft/review pages
- source run and evidence surfaces
- usage dashboard

Rows created by the production seed run are production data. They must not carry
fixture labels, synthetic summaries, placeholder source URLs, or test-only
titles.
