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

Do not run browser automation or long collector jobs on Vercel.

## Database

Use Supabase Postgres as the primary database.

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

## Collector Runtime

Use a separate local Node.js runtime for source collection.

Initial implementation target:

- Playwright-based adapter.
- Persistent browser profile.
- Four-hour schedule.
- Upload-only integration with Vercel ingest APIs.

The collector must implement normalized output contracts so future implementations can use browser extensions, Computer Use, AgentBrowser, or an agent editor.

## API Validation

Use schema validation for all collector-facing endpoints. Zod is the default candidate because it works well with TypeScript and Next.js.

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

Required environment variables will include:

- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `COLLECTOR_API_KEY`
- `LLM_API_KEY`
- map provider credentials when enabled
