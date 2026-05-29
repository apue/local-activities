# MVP Tech Stack And End-To-End Feature Notes

This document records the intended MVP stack for future implementation PRs. It is planning-level: it names services, integration boundaries, and environment variables, but it does not require all features to ship in the first app scaffold.

## Product Slice

The app remains a mobile-first guide to admin-curated activities in Beijing. The end-to-end user experience should stay simple:

1. An admin submits a public activity URL or shared text.
2. The backend validates and normalizes candidate events.
3. Parsed drafts auto-publish when the minimum public fields are present; review remains for failures, duplicates, and future updates.
4. Public users browse actionable upcoming events, usually for weekend planning.
5. Event detail pages expose source links, map actions, and calendar actions.

## User-Facing Experience

### Discovery Views

MVP public views:

- Cultural calendar homepage grouped by time
- Today and near-term available activities
- This weekend
- Next week and later upcoming groups
- Event detail

The primary screen should not be a map-first browsing experience. Map support is useful on event detail pages and as a future secondary discovery surface.

The homepage should feel like a curated cultural calendar rather than a social feed. Event cards should stay compact and action-oriented, with a thumbnail used as a supporting cue rather than the dominant content.

On wider screens, the preferred browsing model is an event agenda with an adjacent detail preview. On mobile, tapping an event card should open a detail page or detail sheet.

### Event Detail Actions

An event detail page should prioritize:

- Time and date
- Venue name and address
- Reservation status and deadline
- Source link
- Reservation/action link
- Registration QR code section when QR is the action mechanism
- Map open button
- Add-to-calendar button

Event details should not expose internal review language such as extraction confidence, normalized-from-image notes, or "official evidence" labels. Those details belong in admin or collector diagnostics, not the public page.

## Map And Geocoding

### Current Assumption

Use AMAP for the China MVP because it has strong local coverage and uses the coordinate systems expected by many Chinese map experiences.

### Environment

- `NEXT_PUBLIC_MAP_PROVIDER=amap`
- `NEXT_PUBLIC_MAP_COORDINATE_SYSTEM=GCJ02`
- `NEXT_PUBLIC_AMAP_JS_API_KEY`
- `AMAP_WEB_SERVICE_API_KEY`
- `AMAP_SECURITY_JS_CODE` when AMAP JS security configuration requires it

### Implementation Boundary

Keep a provider abstraction even if AMAP is the only provider at first:

- `GeocodingProvider`: venue/address to coordinates
- `MapLinkProvider`: event location to app/web deeplinks
- `MapEmbedProvider`: optional public detail page map component

Store coordinate-system metadata with coordinates. For AMAP, expect `GCJ02`; do not silently mix it with `WGS84` or `BD09`.

## Event Schema

The current planned event model is intentionally simple. It is enough for MVP if it supports:

- title
- summary
- start/end time
- registration deadline
- venue name/address
- city/district
- coordinates plus coordinate system
- organizer/source
- reservation requirement and URL
- source URL
- status
- confidence and evidence

The schema can evolve later. The important rule is that crawler and agent outputs remain untrusted drafts. Backend validation, deduplication, and publish-state decisions stay authoritative.

## Calendar View And Personal Calendar Sync

### Common Practice

For this kind of public-events MVP, start with standards-based calendar export before account-level calendar write access.

Recommended order:

1. Generate per-event `.ics` downloads.
2. Generate `webcal://` or HTTPS `.ics` subscription feeds for saved filters such as upcoming events.
3. Add convenience links for Google Calendar prefill URLs.
4. Only later add authenticated Google Calendar API write access if users clearly need two-way or one-click sync.

### Apple Calendar

Apple Calendar commonly works well with:

- a downloadable `.ics` file for one event
- a subscribable calendar feed URL for many events

No Apple OAuth integration is needed for MVP.

### Google Calendar

For MVP, use one of these:

- Google Calendar template URL for a single event add flow
- `.ics` file import
- subscribed calendar feed

Only use the Google Calendar API if the product adds user accounts, OAuth consent, and explicit permission to write into a user's calendar.

### Environment

- `CALENDAR_PUBLIC_BASE_URL`
- `CALENDAR_PRODUCT_ID`
- `CALENDAR_DEFAULT_TIMEZONE=Asia/Shanghai`
- optional future OAuth: `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI`

## Text-To-Speech

TTS is a nice-to-have event-detail enhancement, not a core MVP dependency. It can provide a short audio summary for users browsing on mobile or in WeChat.

Candidate providers:

- Cartesia
- ElevenLabs

Use provider-neutral configuration:

- `TTS_PROVIDER`
- `TTS_API_BASE_URL`
- `TTS_API_KEY`
- `TTS_MODEL`
- `TTS_VOICE_ID`

Implementation notes:

- Cache generated audio by event revision or summary hash.
- Do not regenerate audio on every page view.
- Keep source text short and clearly generated from already-reviewed event fields.

## Search, Crawling, And Extraction

### Providers

Use distinct provider configuration so discovery and crawling can be swapped independently:

- Exa: search and page discovery
  - `EXA_BASE_URL`
  - `EXA_API_KEY`
- Serper: search-engine-style result discovery
  - `SERPER_BASE_URL`
  - `SERPER_API_KEY`
- Firecrawl: page search, crawling, scraping, and content extraction where allowed
  - `FIRECRAWL_BASE_URL`
  - `FIRECRAWL_API_KEY`

### Collector Boundary

Crawlers, Playwright runs, and agent-assisted extraction should all emit normalized objects rather than writing final event rows directly.

Expected normalized outputs:

- source run report
- article index item
- article snapshot
- event draft
- failure report

Do not bypass login walls, captchas, or platform protections. Report structured failures such as `captcha_required`, `login_required`, or `fetch_blocked`.

The detailed collector/agent upload contract and page-capture modes are defined in [Collector Agent Ingestion Spec](collector-agent-ingestion.md).

Observed WeChat article patterns that the normalized output contracts must support:

- `text_dominant`: DOM text contains enough event fields for a high-confidence draft.
- `image_dominant`: poster images contain the action-critical fields and require OCR or vision extraction.
- `qr_registration`: the registration action is a QR code image rather than a URL.
- `multi_mention`: one article contains a primary event plus related or secondary event mentions.
- `expired_source_post`: the source is useful for history or fixtures but should not enter default public discovery.

For WeChat articles, the collector should scroll through the page before final extraction so lazy-loaded poster images and QR codes are discovered. The backend should store the resulting image assets as evidence references attached to article snapshots and event drafts.

### Image And Asset Handling

For short-lived prototypes and fixed assets, images may be committed under `public/` and served by Vercel as static files.

Runtime collector assets are different. Poster images, registration QR codes, and source snapshots discovered after deployment should not be written to the Vercel filesystem. Store those assets through a provider abstraction.

Initial storage path:

- static prototype assets: `public/event-assets/...`
- runtime assets: provider-backed object storage

Provider plan:

1. Use Vercel-hosted static assets only for committed prototype or seed fixtures.
2. Use a storage adapter for runtime collector assets.
3. A temporary adapter may use Vercel Blob if needed.
4. Future adapters may use S3 or Cloudflare R2/CDN without changing public event rendering contracts.

Asset metadata should include:

- provider
- storage key
- public or signed URL
- MIME type
- content hash
- original source URL when available
- usage such as `poster`, `registration_qr`, `cover`, or `article_image`
- owning source post or event draft

## Vercel

Vercel remains the expected app platform.

Planned use:

- Next.js frontend and API routes
- Preview deployments for PR review
- Production deployment for the public app
- Vercel Cron for lightweight scheduled triggers
- Vercel Sandbox as the default hosted Agent runner for bounded collection attempts
- Vercel Workflow as the likely durable serverless execution option for bounded multi-step backend tasks, including Sandbox orchestration
- Vercel Queue is TBD

Important boundary:

- Use Workflow for durable orchestration and resumable backend steps, not as a place to hide unbounded browser sessions.
- Do not make long-running browser automation depend on ordinary Vercel request/response functions.
- Keep the collector runtime replaceable and preserve local/VM execution for fallback, captcha/login/manual recovery, and operator-controlled reruns.

Environment:

- `VERCEL_PROJECT_ID`
- `VERCEL_ORG_ID`
- `VERCEL_TEAM_ID`
- `VERCEL_TOKEN`
- `CRON_SECRET`
- `VERCEL_WORKFLOW_ENABLED`
- `VERCEL_QUEUE_ENABLED`
- `VERCEL_SANDBOX_ENABLED`
- `COLLECTOR_SCOPED_TOKEN_SECRET`
- `AGENT_PROVIDER`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `COLLECTOR_BROWSER_RUNNER` (`playwright` by default; `agent_browser` for comparison runs)

## Supabase

Supabase Postgres is the primary relational store.

Expected responsibilities:

- source registry
- source run history
- source posts and article snapshots
- event drafts
- canonical events
- event mentions
- event revisions
- collector failures

Environment:

- `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- legacy compatibility: `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- local CLI compatibility: `SUPA_API_URL`, `SUPA_DB_URL`, `SUPA_ANON_KEY`, `SUPA_SERVICE_KEY`
- `DATABASE_URL`
- optional `SUPABASE_DB_DIRECT_URL`
- optional local/self-hosted Auth: `JWT_SECRET`

Implementation notes:

- Use the publishable key for browser/mobile clients and RLS-respecting user sessions.
- Use the secret key, or legacy service-role key when required, only in server-side code.
- Do not expose server-only Supabase keys through `NEXT_PUBLIC_` variables.
- Keep `SUPA_*` aliases compatible with `supabase status --output env` for local CLI scripts.
- Use constraints and idempotency keys to prevent duplicate ingestion.
- Keep public reads behind API or row-level policies appropriate for the app scaffold.

## Observation

Use Vercel built-in observation for the MVP instead of adding a third-party APM service.

Planned use:

- Vercel dashboard build logs and runtime logs
- Vercel Observability for functions, edge requests, middleware, external API requests, Workflow runs, and related platform signals
- Vercel Web Analytics for privacy-friendly visitor analytics
- Vercel Speed Insights for real-user web vitals

Environment:

- `OBSERVABILITY_PROVIDER=vercel`
- `VERCEL_WEB_ANALYTICS_ENABLED`
- `VERCEL_SPEED_INSIGHTS_ENABLED`

Do not add Sentry, Datadog, New Relic, or OpenTelemetry drains unless a later implementation issue explicitly adopts them.

## Provider Extraction

Use a collector-side provider boundary for real extraction.

Planned uses:

- classify articles as event/update/cancellation/non-event
- extract event drafts
- summarize event details
- assist duplicate or update review, without directly mutating canonical state
- perform browser/page understanding, OCR, vision, and LLM reasoning outside Vercel

Environment:

- `AGENT_PROVIDER`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_BASE_URL`
- `AGENT_TIMEOUT_SECONDS`
- `AGENT_MAX_ATTEMPTS`

The collector opens seed URLs with the repo-local browser agent, then sends page
observation and run context to the configured provider. It must not send
collector, admin, Supabase, or Vercel secrets to the provider. The provider
response is validated locally before upload, and Vercel validates all uploaded payloads
again before storage or publication routing.

Persist prompt version, model name, and extraction confidence with outputs for reproducibility.

## Local Development Environment

Expected local tools:

- direnv
- pnpm
- Vercel CLI
- Supabase CLI

The repository includes:

- `.env.example`: safe template for all expected variables
- `.envrc`: loads `.env.local` and `.env` if present, and adds `node_modules/.bin` to `PATH`

Recommended setup:

```bash
cp .env.example .env.local
# edit .env.local
direnv allow
```

## MCP

The likely project-level MCP need is Context7 for current framework and provider documentation lookup.

Project configuration:

- `.codex/config.toml` enables the built-in Context7 MCP endpoint.
- `MCP_CONTEXT7_ENABLED=true` records the expected local environment posture.

No other MCP server should be assumed for MVP unless an implementation task requires it.

## Agent Skills For Future Implementation

Project-level agent work should prefer these skill areas when relevant:

- Vercel deployment and Next.js best practices
- Supabase Postgres schema and query best practices
- React/Next.js performance and composition practices
- provider documentation lookup through Context7

These are workflow aids, not production dependencies.

## Implementation Priority

Suggested order for future PRs:

1. App scaffold and environment validation.
2. Supabase schema and typed data contracts.
3. Collector ingest API with schema validation and idempotency.
4. Event list/detail UX.
5. AMAP geocoding and map links.
6. Calendar `.ics` export and Google Calendar prefill links.
7. Search and crawling provider adapters.
8. Text inference extraction pipeline.
9. Optional TTS audio summaries.
10. Vercel Workflow for the first concrete durable orchestration problem; Sandbox/Queue experiments only when a concrete extraction or queueing problem exists.
