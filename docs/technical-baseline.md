# Technical Baseline

## Language

Use TypeScript for application code, shared contracts, API validation, and collector-side normalized data structures.

## Web Framework

Use Next.js App Router as a full-stack framework for the MVP.

Rationale:

- One deployment unit for public pages, admin pages, and API routes.
- Good Vercel support.
- Avoids premature frontend/backend separation.
- Still allows clean internal module boundaries.

## Hosting

Use Vercel for the web app and ingest API.

Vercel Cron may trigger lightweight scheduled checks or orchestration callbacks. Vercel Workflow is the likely durable serverless execution option for bounded multi-step backend jobs such as extraction orchestration, source-run follow-up, review-state transitions, or retryable provider calls. Vercel Sandbox and Vercel Queue remain planning-level candidates for exceptional extraction or queueing cases; adopt them only when an implementation task needs them.

Do not run ordinary long-lived browser automation or unbounded collector jobs inside request/response Vercel functions.

## Database

Use Supabase Postgres as the primary database.

Use Supabase's current publishable/secret API key model for new hosted Auth and API clients, while retaining legacy anon/service-role and `SUPA_*` names for Supabase CLI/local compatibility.

Expected core tables:

- `sources`
- `source_runs`
- `source_posts`
- `article_snapshots`
- `event_drafts`
- `canonical_events`
- `event_mentions`
- `event_revisions`
- `collector_failures`

The first concrete migration for these tables is `supabase/migrations/20260528090000_mvp_core_schema.sql`.

## Collector Runtime

Use a separate local Node.js runtime for source collection.

Initial implementation target:

- Playwright-based adapter.
- Persistent browser profile.
- Four-hour schedule.
- Upload-only integration with Vercel ingest APIs.

The collector must implement normalized output contracts so future implementations can use browser extensions, Computer Use, AgentBrowser, or an agent editor.

See [Collector Agent Ingestion Spec](collector-agent-ingestion.md) for the collector/agent upload contract, observed page capture modes, and implementation slices.

See [Local Collector Console And Job Queue Spec](local-collector-console.md) for the home-machine console, Vercel job polling, lease, and heartbeat design.

See [Deployment Bootstrap Spec](deployment-bootstrap.md) for the end-to-end Vercel, Supabase, and home-machine collector setup target.

## API Validation

Use schema validation for all collector-facing endpoints. Zod is the default candidate because it works well with TypeScript and Next.js.

Shared runtime contracts live under `src/contracts/` and must be used by API routes, local collector code, and tests before accepting collector or admin-facing payloads.

Collector APIs must support:

- bearer-token authentication
- idempotent upload by URL and content hash
- structured failure reasons
- run-level diagnostics

## Event Extraction

Use a structured extraction pipeline:

```text
article snapshot
→ classification
→ event draft extraction
→ schema validation
→ confidence and evidence assignment
→ matching
→ review or publish
```

The LLM provider should not write final database state directly.

Extraction must support both DOM text and retained article images. WeChat source pages often place time, venue, or registration QR codes in lazy-loaded poster images. The collector should preserve these images, and the extraction layer should attach field-level provenance and confidence to event drafts.

Known extraction modes:

- text-dominant article extraction
- image-dominant OCR or vision extraction
- QR-registration extraction
- multi-mention article splitting
- expired source-post classification

Public pages consume reviewed event fields and registration assets. They should not render raw extraction diagnostics or admin-only confidence explanations.

## Asset Storage

Use Vercel static hosting only for assets committed with the repository, such as prototype fixtures.

Runtime collector assets must use a storage abstraction because Vercel deployment files are immutable. The first implementation may choose Vercel Blob for speed, but the adapter boundary should allow later migration to S3 or Cloudflare R2/CDN.

Expected asset records should support:

- stable storage key
- provider name
- public URL or access mode
- content hash for deduplication
- MIME type and size
- source post relation
- event draft or canonical event relation when applicable
- usage classification such as poster, registration QR, cover image, or article image

## Event Matching

Use rule-based weighted matching for MVP:

- block by date window, city, source relation, and title hints
- score by registration URL, title similarity, time, location, organizer, and evidence overlap
- route to automatic merge, review, or new event

Embeddings may be added after enough examples exist.

## Location

Implement a `LocationService` that depends on provider interfaces:

- `GeocodingProvider`
- `MapLinkProvider`

The MVP can use a single provider, but the application must store provider metadata and coordinate system.

## Auth

MVP auth requirements:

- collector API key for ingest endpoints
- admin access protection

User accounts are not required for the first public MVP.

## Testing Baseline

When application code is scaffolded:

- unit-test event matching and status transitions
- unit-test API schema validation
- integration-test collector ingest idempotency
- fixture-test article extraction with saved sample text

## Deployment Baseline

Expected environments:

- local development
- Vercel preview
- Vercel production
- local collector machine

The repository keeps a full safe variable template in [`.env.example`](../.env.example). Required groups include:

- app/admin secrets
- Supabase/Postgres credentials, including publishable/secret keys and CLI-compatible local aliases
- collector authentication
- AMAP map/geocoding credentials when enabled
- OpenAI-compatible text inference credentials
- optional TTS provider credentials
- optional Exa/Serper/Firecrawl search and crawling provider credentials
- optional Vercel Cron/Workflow/Sandbox/Queue configuration

See [MVP Tech Stack And End-To-End Feature Notes](tech-stack.md) for feature-by-feature stack notes.

See [Deployment Bootstrap Spec](deployment-bootstrap.md) for production/preview Vercel env setup, collector-machine env setup, and the end-to-end smoke test expected after implementation lands.
