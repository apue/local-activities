# Event Pipeline Reset Decision Log

## Decision

The active production architecture is:

```text
external capture worker
-> Supabase Storage
-> Supabase Edge Functions
-> Supabase DB
-> Vercel UI
```

The previous local collector path that directly called LLM providers and
uploaded event artifacts to Vercel collector APIs is removed from active
production scope.

## Rationale

Wechat2RSS and WeChat login state must run outside Vercel, but event analysis,
dedupe, publication routing, ledger recording, usage tracking, and evaluation
should be centralized near Supabase DB and Storage. This keeps the capture
runtime small, avoids local LLM provider secrets, allows stored bundles to be
replayed for evaluation, and makes false positives/false negatives auditable.

## Not Chosen

- Vercel as the crawler runtime.
- Vercel as the primary LLM analysis runtime for this reset.
- Local collector as a production LLM extractor.
- Vercel Blob as the production evidence asset store.
- A legacy compatibility layer that leaves old collector/extractor paths active.

## Consequences

- Supabase migrations and Edge Functions become first-class project artifacts.
- Capture worker code must upload raw article bundles instead of extraction
  results.
- Vercel remains important for public/admin UI, but does not own production
  capture or analysis.
- Evaluation and production analysis share the same bundle and extractor
  variant contracts while keeping production writes isolated from eval writes.
