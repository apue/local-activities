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
