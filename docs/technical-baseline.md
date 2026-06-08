# Technical Baseline

## Language And Framework

Use TypeScript for application code, shared contracts, API validation, Supabase
Edge Function source, and capture-worker normalized data structures.

Use Next.js App Router on Vercel for the public catalog and admin portal.

## Runtime Split

The active production split is:

```text
external capture worker
-> Supabase Storage
-> Supabase Edge Functions
-> Supabase Postgres
-> Vercel UI
```

Vercel is not the capture or production analysis runtime. It remains the web app
runtime.

## Supabase

Use Supabase for:

- Postgres
- Storage
- Edge Functions
- local/remote migrations through Supabase CLI

Required Storage buckets:

- `article-bundles`
- `event-evidence-assets`
- `eval-artifacts`

Core data capabilities:

- source registry
- article bundle metadata
- processing ledger
- event drafts
- canonical events
- evidence assets
- dedupe decisions
- LLM usage
- evaluation runs and case results

## Capture Worker

The capture worker runs outside Vercel, initially near the local Wechat2RSS
Docker service. It polls Wechat2RSS, creates article bundles, uploads them to
Supabase Storage, and triggers Supabase Edge Function analysis.

The capture worker must not call LLM providers or write product event tables
directly.

## Analysis

Supabase Edge Functions own the production analysis pipeline. The analysis
function reads a stored bundle, assembles multimodal LLM input, calls the
configured OpenAI-compatible provider, validates the output, records usage,
dedupes, routes publication state, and writes ledger/evidence/draft/event rows.

Alibaba Cloud Model Studio is the initial provider target. Provider credentials
belong in Supabase Edge Function secrets.

## Vercel

Vercel hosts:

- public catalog
- event detail pages
- admin portal
- read-only operational views

Admin actions may trigger Supabase Edge Functions, but Vercel must not become
the production LLM analysis runtime for this reset.

## Testing

Use Vitest for TypeScript/Node modules and Supabase CLI for migrations and Edge
Function local serving.

Routine tests must be deterministic and must not require live WeChat, live LLM,
or production writes. Live source and live provider smokes are explicit
acceptance checks.

## Active References

- [Event Pipeline Reset Goal](event-pipeline-reset-goal.md)
- [Event Pipeline Architecture](event-pipeline-architecture.md)
- [Regression Corpus](regression-corpus.md)
- [Testing Strategy](testing-strategy.md)
- [Security And Permissions](security-and-permissions.md)
