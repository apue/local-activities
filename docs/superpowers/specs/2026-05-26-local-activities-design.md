# Local Activities Design

## Scope

This design covers the MVP for a mobile-first web app that aggregates upcoming official cultural activities in Beijing. The product starts with official sources such as embassies, cultural centers, and international organizations. It uses seed URLs and a local collector to build and maintain a source registry.

## Architecture

```text
Mobile Web App + Admin UI
        |
        v
Next.js on Vercel
- public event pages
- admin pages
- collector ingest API
- extraction and matching orchestration
        |
        v
Supabase Postgres
- sources
- source runs
- source posts / mentions
- canonical events
- event revisions
        ^
        |
Local Collector
- 4-hour source checks
- browser automation or agent adapter
- normalized uploads
```

The web app and API stay together in one Next.js application for the MVP. Browser automation runs outside Vercel on a controlled local machine or VM.

## System Modules

### Public Web Frontend

Responsibilities:

- Present upcoming, published activities for mobile users.
- Provide shareable event detail pages.
- Surface time, venue, reservation status, official source, and map links before secondary content.

Reads:

- published `CanonicalEvent` records
- selected source metadata for attribution
- location fields needed for map links

Writes:

- none in the MVP

Permissions:

- public read access to published, upcoming event data only
- no access to drafts, source run diagnostics, extraction evidence, or admin notes

Interfaces:

- server-rendered Next.js routes for public pages
- read-only backend queries scoped to published events

### Admin Dashboard

Responsibilities:

- Add seed URLs.
- Review source health and source run history.
- Review event drafts before publication.
- Resolve duplicate, update, and cancellation queues.
- Apply admin decisions and overrides.

Reads:

- `Source`
- `SourceRun`
- `SourcePost`
- `EventDraft`
- `CanonicalEvent`
- `EventRevision`
- collector failures and diagnostics

Writes:

- source status overrides
- review decisions
- event publish state
- event revision decisions
- canonical event corrections

Permissions:

- admin only
- must not be accessible to public users or collectors

Interfaces:

- protected Next.js admin routes
- server actions or admin API routes backed by authorization checks

### Backend API

Responsibilities:

- Accept authenticated collector uploads.
- Validate schemas and idempotency keys.
- Persist normalized collector results.
- Orchestrate extraction, matching, revisions, and publication policy.
- Serve public and admin data through scoped access paths.

Reads:

- all application tables required for orchestration

Writes:

- source run records
- article indexes and snapshots
- event drafts
- match results
- event revisions
- canonical events through backend policy only

Permissions:

- collector endpoints require collector API keys
- admin endpoints require admin authorization
- public endpoints expose published events only

Interfaces:

- collector ingest API routes
- admin routes or server actions
- public read routes
- internal service functions for extraction, matching, and location

### Collector Runtime

Responsibilities:

- Check tracked sources every 4 hours.
- Use browser automation or an agent adapter to observe official pages.
- Upload normalized source run reports, article indexes, article snapshots, event drafts, and failures.
- Report failure reasons instead of hiding operational problems.

Reads:

- source tasks from backend
- browser-visible source pages
- local browser profile or collector runtime state

Writes:

- uploads only through collector API
- no direct database writes

Permissions:

- collector API key
- may create observations, snapshots, drafts, and failure reports
- cannot publish events or mutate canonical events directly

Interfaces:

- `CollectorAdapter`
- collector ingest API
- local browser automation runtime

### Extraction / LLM Module

Responsibilities:

- Classify article snapshots as event, update, cancellation, or non-event.
- Extract one or more event drafts from unstructured text.
- Attach evidence snippets and confidence values.
- Identify uncertain fields that require admin review.

Reads:

- article snapshots
- source metadata
- optional existing canonical event context for update/cancellation interpretation

Writes:

- `EventDraft`
- extraction status
- extraction evidence and uncertainty notes

Permissions:

- internal backend service only
- LLM output is draft evidence, not final application state

Interfaces:

- `ArticleSnapshot -> EventDraft[]`
- schema-validated structured output

### Matching / Revision Module

Responsibilities:

- Match event drafts to existing canonical events.
- Produce duplicate decisions or review candidates.
- Detect field conflicts, updates, and cancellation proposals.
- Preserve match explanations and revision evidence.

Reads:

- event drafts
- canonical events
- event mentions
- source relationship and organizer metadata

Writes:

- match results
- `EventMention` links
- `EventRevision` proposals
- canonical event updates only through accepted policy or admin decision

Permissions:

- internal backend service only
- cannot bypass admin review for low-confidence or high-impact changes

Interfaces:

- `EventDraft -> MatchDecision`
- `EventDraft + CanonicalEvent -> RevisionProposal[]`

### Location Module

Responsibilities:

- Normalize venue names and addresses.
- Resolve coordinates through a geocoding provider.
- Build map deeplinks for public event pages.
- Preserve provider metadata and coordinate system.

Reads:

- venue and address fields from event drafts and canonical events

Writes:

- geocoding results
- location confidence
- coordinate system metadata

Permissions:

- internal backend service only
- provider credentials are server-side secrets

Interfaces:

- `GeocodingProvider`
- `MapLinkProvider`

### Database

Responsibilities:

- Store source, collector, extraction, event, and revision state.
- Enforce idempotency and relational integrity.
- Keep canonical event state separate from source article mentions.

Reads and writes:

- all persistent application state through backend-controlled access paths

Permissions:

- service-role access is backend only
- no direct database access from public frontend or collector runtime

## Data Ownership

- Public frontend owns presentation only.
- Admin dashboard owns human review decisions and explicit overrides.
- Collector runtime owns observed page state and run diagnostics.
- Extraction / LLM module owns draft suggestions, evidence, and uncertainty notes.
- Matching / revision module owns match explanations and revision proposals.
- Backend policy owns canonical event creation, publication, updates, and status transitions.
- Database owns durable state but does not encode business decisions without backend policy.

## API Surface

Public API or routes:

- read published, upcoming events
- read public event detail data
- no draft, diagnostic, or admin fields

Admin API or server actions:

- add seed URLs
- review event drafts
- resolve duplicate candidates
- accept or reject revision proposals
- update source status and admin notes
- read source run diagnostics

Collector API:

- `POST /api/collector/source-run`
- `POST /api/collector/article-index`
- `POST /api/collector/article-snapshot`
- `POST /api/collector/event-draft`
- `POST /api/collector/failure`

Internal service functions:

- extraction
- event matching
- revision proposal
- geocoding
- publication policy

## Permission Boundaries

- Public users can read published upcoming events only.
- Admin users can review and mutate source, draft, revision, and canonical event state.
- Collectors can upload observations and failures but cannot publish or update canonical events directly.
- LLM and agent modules can propose drafts and explanations but cannot own final state.
- Service-role database credentials stay server-side.
- External provider secrets stay server-side or in the local collector environment, never in public frontend code.

## Core Domain Model

### Source

A source is an official channel that may publish relevant activities.

Key fields:

- `id`
- `name`
- `type`: `wechat_official_account`, `official_website`, `registration_platform`, `other`
- `profileUrl`
- `seedUrl`
- `status`: `checking`, `healthy`, `attention_needed`, `unsupported`, `paused`
- `lastSuccessfulRunAt`
- `lastFailedRunAt`
- `lastFailureReason`
- `consecutiveFailures`

### SourceRun

A source run records one collector attempt.

Key fields:

- `id`
- `sourceId`
- `collectorId`
- `startedAt`
- `finishedAt`
- `status`: `success`, `partial`, `failed`
- `failureReason`
- `articlesFound`
- `articlesSubmitted`
- `diagnostics`

### SourcePost / EventMention

A source post is a published article or webpage. It is not the canonical event.

Key fields:

- `id`
- `sourceId`
- `url`
- `title`
- `publishedAt`
- `contentHash`
- `snapshotText`
- `snapshotHtmlRef`
- `extractionStatus`
- `matchedEventId`
- `matchConfidence`

### CanonicalEvent

A canonical event is the platform's current representation of a real-world activity.

Key fields:

- `id`
- `title`
- `normalizedTitle`
- `summary`
- `startTime`
- `endTime`
- `registrationDeadline`
- `venueName`
- `venueAddress`
- `city`
- `district`
- `lat`
- `lng`
- `coordinateSystem`
- `organizer`
- `reservationRequired`
- `reservationUrl`
- `status`: `scheduled`, `cancelled`, `postponed`, `sold_out`, `registration_closed`, `ended`, `uncertain`
- `confidence`
- `canonicalSourcePostId`

### EventRevision

An event revision records proposed or applied changes from later mentions.

Key fields:

- `id`
- `eventId`
- `sourcePostId`
- `field`
- `oldValue`
- `newValue`
- `reason`
- `confidence`
- `status`: `proposed`, `applied`, `rejected`
- `createdAt`

## Collector Abstraction

The backend depends on normalized collector outputs, not on a concrete collector implementation.

```ts
interface CollectorAdapter {
  runSource(source: Source): Promise<SourceRunResult>
}

type SourceRunResult = {
  sourceId: string
  runId: string
  status: "success" | "partial" | "failed"
  discoveredArticles?: ArticleIndexItem[]
  snapshots?: ArticleSnapshot[]
  eventDrafts?: EventDraft[]
  failures?: CollectorFailure[]
}
```

The initial adapter is expected to be a Playwright-based WeChat collector. Future adapters may use a browser extension, Computer Use, AgentBrowser, or an agent editor.

## Ingest API

The Vercel app exposes authenticated collector endpoints:

- `POST /api/collector/source-run`
- `POST /api/collector/article-index`
- `POST /api/collector/article-snapshot`
- `POST /api/collector/event-draft`
- `POST /api/collector/failure`

All endpoints require a collector API key, validate request schemas, and behave idempotently using URL and content hash keys.

## Extraction Pipeline

```text
ArticleSnapshot
→ clean text and metadata
→ classify as event, update, cancellation, or non-event
→ extract one or more EventDraft objects
→ validate schema and required fields
→ attach evidence snippets
→ route by confidence
```

High-confidence drafts may be eligible for publishing after the system proves stable. In the first MVP review loop, drafts should go through admin review before public display.

## No-ID Event Matching

The system matches event drafts to existing canonical events through candidate blocking and weighted scoring.

Blocking signals:

- city is Beijing
- event dates are near each other
- title tokens or semantic embeddings overlap
- organizer or source relationship overlaps
- venue or address is nearby

Scoring signals:

- registration URL match
- title similarity
- time similarity
- location similarity
- organizer overlap
- evidence keyword overlap

Match outcomes:

- `auto_merge`: high-confidence duplicate
- `needs_review`: possible duplicate
- `separate`: create a new canonical event

The backend must preserve match explanations for admin review.

## Updates And Cancellations

New mentions can propose changes to an existing event. The backend should not silently overwrite high-impact fields such as time, venue, reservation URL, or cancellation status.

Rules:

- Clear updates from the primary organizer receive higher confidence.
- Later posts are stronger than older posts when they explicitly mention adjustment or cancellation.
- Missing content or failed fetches must not be interpreted as event cancellation.
- Cancellation requires explicit source evidence or admin confirmation.

## Location Service

The business layer uses a location abstraction rather than a specific map provider.

```ts
interface GeocodingProvider {
  geocode(input: {
    venueName?: string
    address?: string
    city?: string
  }): Promise<GeocodeResult[]>
}
```

The MVP can use one provider for geocoding and map deeplinks. The data model stores provider metadata and coordinate system so the implementation can later move to WeChat map capabilities.

## User Experience

The public app is mobile-first.

Primary views:

- This weekend
- Today available
- Reservation closing soon
- Upcoming
- Event detail

Event detail pages should show the action-critical fields first: time, venue, reservation status, source, and official link.

## Admin Experience

Admin views:

- Source registry and health summary
- Source run history
- Seed URL ingestion
- Event draft review
- Duplicate review
- Update and cancellation review

Failures must be visible as operational state, not hidden logs.

## Validation Criteria

- A seed URL can create a source candidate and article snapshot.
- A collector run can upload source results through authenticated API endpoints.
- Source health updates after success and failure cases.
- Article snapshots can become event drafts with evidence.
- Event drafts can be matched, reviewed, and published as canonical events.
- Public views only show upcoming, actionable events.
