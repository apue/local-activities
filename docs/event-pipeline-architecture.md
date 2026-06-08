# Event Pipeline Architecture

This document defines the active event pipeline architecture. The execution
contract for the reset is [Event Pipeline Reset Goal](event-pipeline-reset-goal.md).

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
| Supabase Edge Functions | bundle analysis, provider calls, schema validation, dedupe, publish routing, ledger/evidence/draft/event/usage writes | WeChat crawling, browser automation, production event table writes from eval runs |
| Evaluation runner | extractor variant orchestration, scoring, local eval artifacts, explicit eval-scoped Supabase writes | production event publication, draft/evidence writes, live provider calls without an allow-live flag and budget |
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

## Pipeline

```text
Wechat2RSS article
-> ArticleBundle
-> Supabase Storage upload
-> analyze-article-bundle Edge Function
-> multimodal LLM request
-> normalized extraction result
-> backend validation
-> dedupe decision
-> publish routing
-> ledger + drafts/events/evidence/usage
-> admin/public surfaces
```

Every article outcome writes ledger state, including `excluded`, `duplicate`,
and `failed`.

## Evaluation Harness

The evaluation harness is separate from the production publication pipeline. Its
CI-safe path uses mocked variants and memory storage:

```bash
pnpm eval:run -- --store memory --variant mock-expected-v1 --variant mock-overfilter-v1
```

Local artifact runs write to `tmp/evaluation-runs` by default. The Supabase
writer is explicit with `--store supabase` and may write only
`evaluation_runs`, `evaluation_case_results`, `llm_usage_ledger`, and
`eval-artifacts`. Live provider evaluation is opt-in:

```bash
pnpm eval:run -- --variant live-configured --allow-live --max-cost-cny <n>
```

## Module Contracts

| Contract | Purpose |
| --- | --- |
| `ArticleBundle` | raw captured HTML/text/images/links/metadata |
| `AnalyzeArticleBundleRequest` | Edge Function trigger payload |
| `ProcessingLedgerEntry` | full processing audit record for every article |
| `EvidenceAsset` | poster, registration QR, article image, screenshot, or link evidence |
| `ExtractionResult` | provider output after schema validation and normalization |
| `DedupeDecision` | new, same, update, possible duplicate, duplicate, or reject |
| `PublishDecision` | published, needs review, needs info, excluded, duplicate, or failed |
| `ExtractorVariant` | provider, model, prompt version, schema version, and parameters |
| `EvaluationRun` | one variant evaluated against one corpus version |

Cross-process contracts must be schema validated.

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
- regression corpus replay
- evaluation run with mocked variants
- admin/public smoke tests

Live WeChat and live LLM smokes are final acceptance checks when credentials and
operator state are available.
