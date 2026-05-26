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
