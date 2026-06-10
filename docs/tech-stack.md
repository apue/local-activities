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

Evaluation runs from the Node.js runner and compares extractor variants:

```text
provider + model + promptVersion + schemaVersion + parameters
```

The default CI-safe command uses memory storage, mocked variants, and an
explicit corpus:

```bash
pnpm eval:run -- --corpus-dir tests/regression-corpus --store memory --variant mock-expected-v1 --variant mock-overfilter-v1
```

Local artifact runs write to `tmp/evaluation-runs` by default. Supabase writes
require `--store supabase` and are limited to `evaluation_runs`,
`evaluation_case_results`, `llm_usage_ledger`, and `eval-artifacts`. Live
provider runs are opt-in:

```bash
pnpm eval:run -- --corpus-dir tests/regression-corpus --variant live-configured --allow-live --max-cost-cny <n>
```

The committed corpus is public-safe and text-derived. Use it for live provider
wiring smoke checks, not poster/QR vision quality. Vision evaluation requires a
private local corpus directory with consumable image assets.

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

- [Event Pipeline Reset Goal](event-pipeline-reset-goal.md)
- [Event Pipeline Architecture](event-pipeline-architecture.md)
- [Technical Baseline](technical-baseline.md)
- [Testing Strategy](testing-strategy.md)
