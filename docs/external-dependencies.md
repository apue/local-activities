# External Dependencies

See also [MVP Tech Stack And End-To-End Feature Notes](tech-stack.md) for planned environment variables and feature-level integration notes.

## Vercel

Purpose:

- Host the Next.js web app.
- Serve public event pages and admin pages.
- Expose collector ingest API routes.

Notes:

- Vercel is appropriate for the MVP web surface and lightweight API handling.
- Vercel Cron can trigger lightweight scheduled callbacks.
- Vercel Workflow is the likely durable serverless execution option for bounded orchestration work.
- Vercel Sandbox and Queue are candidate services for exceptional extraction or queueing cases.
- Long-running browser automation should not run inside ordinary Vercel request/response functions.
- Scheduled collection should be handled by the local collector or a worker runtime unless a later PR adopts a bounded Vercel-native orchestration pattern.

## Supabase

Purpose:

- Managed Postgres database.
- Store sources, source runs, article snapshots, event drafts, canonical events, and revisions.
- Support relational queries for admin review and public event views.

Notes:

- Supabase Auth is optional for MVP admin access; a simpler protected admin route can be used first if appropriate.
- Use Postgres constraints and idempotency keys to prevent duplicate article ingestion.

## Playwright

Purpose:

- Initial collector runtime for browser-based source checks.
- Open WeChat official-account pages or official web pages with a persistent browser profile.
- Extract article indexes and article snapshots.

Notes:

- Playwright is an implementation of the collector abstraction, not a backend dependency.
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
