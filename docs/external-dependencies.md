# External Dependencies

See also [MVP Tech Stack And End-To-End Feature Notes](tech-stack.md) for planned environment variables and feature-level integration notes.

## Vercel

Purpose:

- Host the Next.js web app.
- Serve public event pages and admin pages.
- Expose collector ingest API routes.
- Store runtime public event poster images in Vercel Blob for the MVP.

Notes:

- Vercel is appropriate for the MVP web surface and lightweight API handling.
- Vercel Cron can trigger lightweight scheduled callbacks.
- Vercel Workflow is the likely durable serverless execution option for bounded
  backend orchestration work that does not require WeChat browser/login state.
- Vercel Queue remains a candidate service for future queueing needs.
- Vercel Blob is a temporary object storage adapter and can be replaced with S3
  or another object store behind the same application boundary.
- Long-running browser automation should not run inside ordinary Vercel request/response functions.
- Mac-local collection is the current production path for WeChat official
  account collection because the operator can manage WeChat login and account
  risk locally.

## Supabase

Purpose:

- Managed Postgres database.
- Store sources, source runs, article snapshots, event drafts, canonical events, and revisions.
- Support relational queries for admin review and public event views.

Notes:

- Supabase Auth is optional for MVP admin access; a simpler protected admin route can be used first if appropriate.
- Prefer current publishable keys for browser clients and secret keys for server-only Supabase clients.
- Keep legacy anon/service-role names and `SUPA_*` local aliases for Supabase CLI compatibility.
- Use Postgres constraints and idempotency keys to prevent duplicate article ingestion.

## Observation

Purpose:

- Monitor deployments, runtime errors, web vitals, traffic, and platform behavior without adding a separate APM service.

Initial provider:

- Vercel built-in logs, Observability, Web Analytics, and Speed Insights.

Notes:

- Do not add Sentry, Datadog, New Relic, or other third-party observability dependencies for MVP.
- Add third-party drains only if a later issue needs longer retention, external correlation, or compliance controls.

## Wechat2RSS

Purpose:

- Provide the current production source adapter for subscribed WeChat official
  accounts.
- Run on the operator's Mac in Docker so login and risk handling remain local.
- Expose official-account article lists and article content for low-frequency
  collector runs.

Notes:

- Wechat2RSS is a source provider, not the backend source of truth.
- The collector normalizes Wechat2RSS output into article snapshots and evidence
  assets, then uploads through backend APIs.
- The backend validates all collector output and owns dedupe, publication, and
  admin state.
- Do not bypass WeChat platform protections. Report login, captcha, fetch, or
  account-health failures as product-visible source state.

## Playwright

Purpose:

- Initial collector runtime for browser-based source checks.
- Open WeChat official-account pages or official web pages with a persistent browser profile.
- Extract article indexes and article snapshots.

Notes:

- Playwright is an implementation of the collector abstraction, not a backend dependency.
- Playwright is not the current production WeChat official-account collector
  path for Event Pipeline V3.
- The collector should report failures instead of bypassing captchas, login requirements, or platform protections.

## LLM Provider

Purpose:

- Classify article content.
- Extract structured event drafts from unstructured text.
- Assist with uncertain duplicate/update/cancellation cases.

Notes:

- LLM output must be treated as draft data.
- The backend should validate schemas, attach evidence, and route uncertain results to review.
- Prompts and model identifiers should be versioned for reproducibility.

## Map / Geocoding Provider

Purpose:

- Convert venue names and addresses into coordinates.
- Build map deeplinks for event detail pages.

Initial candidates:

- AMAP for China address accuracy and the MVP assumption.
- Google Maps for validation-stage convenience.
- Mapbox or OpenStreetMap-based services for later alternatives.
- WeChat map capabilities for future mini program integration.

Notes:

- Business logic depends on `GeocodingProvider` and map-link abstractions.
- Store coordinate system metadata such as `WGS84`, `GCJ02`, or `BD09`.
- AMAP credentials are split between browser-side JS keys and server-side Web Service keys.

## Search And Crawling Providers

Purpose:

- Discover official pages and extract content where platform policies allow it.
- Provide non-browser alternatives before falling back to local browser automation.

Initial candidates:

- Exa for search and page discovery.
- Serper for search-engine-style result discovery.
- Firecrawl for page search, crawling, scraping, and extraction.

Notes:

- Keep `BASE_URL` and `API_KEY` variables distinct per provider.
- Provider outputs are still untrusted collector inputs; the backend validates and deduplicates.

## Text-To-Speech Provider

Purpose:

- Generate optional short audio summaries for reviewed event details.

Initial candidates:

- Cartesia.
- ElevenLabs.

Notes:

- TTS is not required for core event discovery.
- Cache audio by event revision or summary hash to avoid regenerating on every view.

## Calendar Integration

Purpose:

- Help users save events to personal calendars.

Notes:

- Start with standards-based `.ics` downloads, subscribable feeds, and Google Calendar prefill links.
- Apple Calendar works with `.ics` files and subscribed calendar feeds; no Apple OAuth is needed for MVP.
- Google Calendar API write access should wait until the product has user accounts and a clear need for authenticated calendar sync.

## GitHub

Purpose:

- Host the public source repository.
- Track design and implementation changes.

Notes:

- The initial repository is documentation-first.
- Application scaffolding should happen after the MVP documents are reviewed.
