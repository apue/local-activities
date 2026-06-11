# MVP Tech Stack And Feature Notes

## Product Slice

The app is a mobile-first guide to official or operator-curated cultural
activities in Beijing, with embassy, cultural-center, and international
organization events as the first wedge.

## Frontend

- Next.js App Router
- React
- TypeScript
- Vercel deployment

Public pages show canonical published events. Admin pages show drafts, ledger,
usage, and evaluation reports.

## Data And Backend

- Supabase Postgres
- Supabase Storage
- Supabase Edge Functions
- Supabase CLI migrations

Storage buckets:

- `article-bundles`
- `event-evidence-assets`
- `eval-artifacts`

## Capture

Wechat2RSS runs outside Vercel. A capture worker polls it, creates article
bundles, uploads bundles to Supabase Storage, and triggers Edge Function
analysis.

The capture worker does not call LLM providers and does not write product event
tables directly.

## Analysis

Supabase Edge Functions own LLM analysis. The initial provider target is Alibaba
Cloud Model Studio through an OpenAI-compatible API.

Configuration uses:

- `ANALYSIS_LLM_PROVIDER`
- `ANALYSIS_LLM_API_KEY`
- `ANALYSIS_LLM_BASE_URL`
- `ANALYSIS_LLM_MODEL`
- `ANALYSIS_LLM_API_STYLE`
- `ANALYSIS_LLM_MAX_OUTPUT_TOKENS`
- `ANALYSIS_LLM_TIMEOUT_SECONDS`

## Evaluation

V5 model evaluation runs on V5 replay artifacts and compares extractor/editor
variants through the same contracts used by the pipeline:

```text
provider + model + promptVersion + schemaVersion + parameters
```

The default command is `pipeline:v5:eval` with mocked variants and memory/local
artifacts. Live provider comparisons must be explicit, budgeted, data-class
scoped, and must not write production drafts or canonical events. The committed
corpus is public-safe and text-derived; poster/QR quality checks require a
private local corpus directory with consumable image assets.

Local live evaluation uses the `live-configured` variant. It accepts
`V5_LIVE_BASE_URL`, `V5_LIVE_API_KEY`, `V5_LIVE_MODEL`, and optional
`V5_LIVE_PROVIDER`; if those are not set, it falls back to the
`ANALYSIS_LLM_*` Edge Function provider variables. It also accepts
`V5_LIVE_MAX_TOKENS` and `V5_LIVE_ENABLE_THINKING` for OpenAI-compatible
provider body options, which are useful for SiliconFlow/Qwen models.

## Map And Geocoding

AMAP remains the initial map/geocoding candidate for China address accuracy.

Configuration:

- `NEXT_PUBLIC_MAP_PROVIDER=amap`
- `NEXT_PUBLIC_MAP_COORDINATE_SYSTEM=GCJ02`
- `NEXT_PUBLIC_AMAP_JS_API_KEY`
- `AMAP_WEB_SERVICE_API_KEY`
- `AMAP_SECURITY_JS_CODE` when required

## Observability

Use Vercel built-in deployment logs, Observability, Web Analytics, and Speed
Insights. Do not add Sentry, Datadog, New Relic, or other third-party APM for
the MVP reset.

## Active References

- [Event Pipeline Architecture](event-pipeline-architecture.md)
- [Event Pipeline V5 Phase 2 Goal](event-pipeline-v5-phase2-goal.md)
- [Technical Baseline](technical-baseline.md)
- [Testing Strategy](testing-strategy.md)
