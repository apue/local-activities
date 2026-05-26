# External Dependencies

## Vercel

Purpose:

- Host the Next.js web app.
- Serve public event pages and admin pages.
- Expose collector ingest API routes.

Notes:

- Vercel is appropriate for the MVP web surface and lightweight API handling.
- Long-running browser automation should not run inside Vercel functions.
- Scheduled collection should be handled by the local collector or a worker runtime.

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

- Amap for China address accuracy.
- Google Maps for validation-stage convenience.
- Mapbox or OpenStreetMap-based services for later alternatives.
- WeChat map capabilities for future mini program integration.

Notes:

- Business logic depends on `GeocodingProvider` and map-link abstractions.
- Store coordinate system metadata such as `WGS84`, `GCJ02`, or `BD09`.

## GitHub

Purpose:

- Host the public source repository.
- Track design and implementation changes.

Notes:

- The initial repository is documentation-first.
- Application scaffolding should happen after the MVP documents are reviewed.
