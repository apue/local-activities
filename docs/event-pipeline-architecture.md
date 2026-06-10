# Event Pipeline Architecture

This document defines the active event pipeline architecture. Historical reset
goals describe how the project reached this point, but this document and the
current implementation docs are the source of truth for active runtime
boundaries.

## Active Runtime Boundary

The production pipeline is:

```text
external capture worker
-> Supabase Storage article bundle
-> Supabase Edge Function analysis
-> Supabase DB ledger/drafts/events/evidence/usage
-> Vercel public catalog and admin portal
```

Vercel does not run WeChat crawling or the production LLM analysis pipeline.
The capture worker does not call LLM providers and does not write product event
tables directly.

## Runtime Responsibilities

| Runtime | Owns | Must Not Own |
| --- | --- | --- |
| Capture worker | Wechat2RSS health checks, article polling, bundle creation, Supabase Storage upload, Edge Function trigger | LLM calls, event publication decisions, direct event/draft/evidence DB writes |
| Supabase Edge Functions | bundle analysis, provider calls, schema validation, dedupe, publish routing, data-class-scoped ledger/evidence/draft/event/usage writes | WeChat crawling, browser automation, unscoped production writes |
| V5 evaluation surface | future extractor/editor variant orchestration, scoring, local eval artifacts, explicit eval-scoped Supabase writes | production event publication, draft/evidence writes, live provider calls without an allow-live flag and budget |
| Supabase Storage | raw bundles, event evidence assets, eval artifacts | mixed-purpose buckets that combine raw capture and published assets |
| Supabase Postgres | sources, bundles, ledger, drafts, canonical events, evidence, usage, evaluations | unvalidated collector output as public state |
| Vercel | public catalog, admin portal, read-only operational views, admin actions | production capture, production LLM analysis |

## Storage Buckets

```text
article-bundles        private raw capture material, retained by policy
event-evidence-assets  public or signed assets used by drafts/events
eval-artifacts         private evaluation reports and model outputs
```

Raw bundle images are source material. Event evidence assets are product assets.
They must remain distinct even when they reference the same original image.

Storage paths are scoped by `data_class`:

```text
article-bundles/<data_class>/<bundle_id>/...
event-evidence-assets/<data_class>/articles/<bundle_id>/<asset_id>...
eval-artifacts/...
```

Only `event-evidence-assets/production/...` is public product evidence.

## Data Class

Product-shaped data uses one normalized scope field:

```text
data_class = production | eval | test | smoke
```

The same schema and write contracts are used for every data class. Public and
admin production surfaces query `data_class='production'`. Evaluation, test, and
smoke rows stay available for audit and debugging without polluting production
catalog results.

## Pipeline

```text
Wechat2RSS article
-> ArticleBundle
-> ContractCheck<ArticleBundle>
-> Supabase Storage upload
-> analyze-article-bundle Edge Function
-> AnalysisInput
-> ContractCheck<AnalysisInput>
-> multimodal LLM request
-> normalized extraction result
-> ContractCheck<ExtractionResult>
-> backend validation
-> dedupe decision
-> publish routing
-> DbWritePlan
-> ledger + drafts/events/evidence/usage
-> admin/public surfaces
```

Every article outcome writes ledger state, including `excluded`, `duplicate`,
and `failed`.

## V5 Replay And Evaluation

The active offline pipeline harness is V5 replay:

```bash
pnpm pipeline:v5:replay -- --corpus-dir tests/regression-corpus --all --store memory
```

V5 replay is separate from the production publication pipeline. It uses the
committed corpus, mock providers, memory or local artifacts, and no hosted
writes. The reset-era evaluation runner has been removed as an active
entrypoint. The next model-evaluation surface should consume V5 node artifacts
and preserve the same explicit data-class, budget, and no-production-write
boundaries.

The committed corpus is public-safe and text-derived. For poster or
registration QR quality, use a private local corpus rebuilt from Wechat2RSS with
consumable image assets.

## Module Contracts

| Contract | Purpose |
| --- | --- |
| `ArticleBundle` | raw captured HTML/text/images/links/metadata |
| `PipelineContext` | required `dataClass`, run, and source context for node validation and writes |
| `AnalysisInput` | provider-ready article text, image metadata, and consumable image assets |
| `AnalyzeArticleBundleRequest` | Edge Function trigger payload |
| `ProcessingLedgerEntry` | full processing audit record for every article |
| `EvidenceAsset` | poster, registration QR, article image, screenshot, or link evidence |
| `ExtractionResult` | provider output after schema validation and normalization |
| `DedupeDecision` | new, same, update, possible duplicate, duplicate, or reject |
| `PublishDecision` | published, needs review, needs info, excluded, duplicate, or failed |
| `ExtractorVariant` | provider, model, prompt version, schema version, and parameters |
| `EvaluationRun` | one variant evaluated against one corpus version |

Cross-process contracts must be schema validated. Node outputs that cross module
boundaries should also pass a local contract checker. The checker takes
`nodeName`, `payload`, and `PipelineContext`; it starts with one enforced
`AnalysisInput` rule and can grow without changing provider or writer call
sites.

The first enforced `AnalysisInput` rule is:

```text
provider image inputs must come from declared consumable assets
raw capture references such as images[*].sourceUrl are metadata only
```

Every DB write path must carry context rather than using a separate
implementation for production, eval, test, or smoke data.

## Boundary Rules

Capture answers:

```text
What source material did Wechat2RSS provide?
Which article bundles were uploaded?
Which source/login/capture failures occurred?
```

Analysis answers:

```text
Is this a public Beijing activity lead?
What events, times, venues, registration actions, posters, and QR assets exist?
What should be published, reviewed, excluded, or deduped?
```

Vercel UI answers:

```text
What can users see?
What does the operator need to review?
What did the pipeline decide and why?
```

## Testability

Default validation must not require live WeChat, live LLM, or production writes.
Each module should have deterministic tests:

- bundle builder with mocked Wechat2RSS content
- Storage upload with mocked Supabase client
- Edge Function analysis with mocked provider
- ledger/publish/dedupe policy with fixtures
- regression corpus replay with an explicit corpus directory
- evaluation run with mocked variants
- admin/public smoke tests

Live WeChat and live LLM smokes are final acceptance checks when credentials and
operator state are available.
