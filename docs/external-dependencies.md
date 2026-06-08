# External Dependencies

## Vercel

Purpose:

- Host the Next.js public catalog and admin portal.
- Provide preview and production deployments.
- Provide built-in logs, Observability, Web Analytics, and Speed Insights.

Notes:

- Vercel is not the WeChat crawler runtime.
- Vercel is not the production LLM analysis runtime for the reset.
- Do not add third-party APM unless a later issue explicitly expands scope.

## Supabase

Purpose:

- Postgres database.
- Storage for article bundles, event evidence assets, and eval artifacts.
- Edge Functions for production article analysis and evaluation runs.

Notes:

- Use Supabase CLI for migrations and function deployment.
- Use Supabase Edge Function secrets for analysis provider credentials.
- Keep raw capture bundles separate from event evidence assets.

## Wechat2RSS

Purpose:

- Provide subscribed WeChat official-account article lists and article content.
- Run outside Vercel so the operator can manage WeChat login and risk prompts.

Notes:

- Wechat2RSS is source material only, not the product source of truth.
- A capture worker polls Wechat2RSS, creates bundles, and triggers Supabase
  analysis.
- Do not bypass login, captcha, fetch, or platform-risk protections.

## LLM Provider

Purpose:

- Classify public eligibility.
- Extract event drafts from text and image evidence.
- Identify poster and registration QR evidence.
- Support dedupe/update/cancellation decisions.

Initial provider:

- Alibaba Cloud Model Studio through an OpenAI-compatible API.

Notes:

- Provider output is untrusted until validated by the analysis pipeline.
- Prompts, schema versions, model identifiers, usage, and costs must be recorded.

## Map / Geocoding Provider

Purpose:

- Convert venue names and addresses into coordinates.
- Build map links for event detail pages.

Initial candidate:

- AMAP for China address accuracy.
