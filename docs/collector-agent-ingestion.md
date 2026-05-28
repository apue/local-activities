# Collector Agent Ingestion Spec

## Purpose

This document defines the MVP contract between an external collector/agent runtime, the Vercel ingest API, and the backend state stored in Supabase Postgres.

The intended reader is a future coding agent implementing collector, API, schema, or extraction work. Treat this as an execution spec: it describes required behavior, output shapes, implementation slices, and validation expectations.

## Core Boundary

The collector/agent runtime runs outside Vercel on an operator-controlled machine or VM. It may use Playwright, a persistent browser profile, OCR, a vision-capable model, and text extraction. It must not write final product state directly.

The Vercel app receives authenticated collector uploads, validates schemas, applies idempotency rules, stores normalized state in Supabase, and decides what is eligible for review or publication.

Supabase stores source, run, snapshot, evidence, draft, failure, matching, and canonical event state. Public pages read only backend-approved canonical event state.

Important rules:

- Collector and agent outputs are untrusted.
- The collector may propose event drafts, evidence, and failure reports.
- The backend owns validation, deduplication, publish eligibility, and final publish state.
- Browser-heavy collection must not depend on ordinary Vercel request/response functions.
- Failures are product-visible admin state, not hidden local logs.

## Observed Page Patterns

The collector must classify each captured article into one primary capture mode. The mode affects extraction strategy, evidence handling, confidence, and review routing.

### `text_complete`

Use when DOM-visible text contains the event fields needed for an event draft.

Example pattern:

- Article body contains title, date/time, venue, address, organizer, entry or registration status, and source metadata.
- Images may exist but are not required to understand the event.

Collector behavior:

- Extract article text from stable DOM selectors.
- Save a bounded article snapshot.
- Save cover or important images as optional evidence.
- Produce event drafts from text.

Default review routing:

- High-confidence drafts may be eligible for normal review.
- Do not auto-publish in the first MVP review loop unless a later issue explicitly adds that policy.

### `text_with_qr_registration`

Use when DOM-visible text contains the event fields, but registration or reservation action requires QR/image evidence.

Example pattern:

- Text says seats must be reserved or QR must be scanned.
- Event fields are mostly textual.
- QR or poster image is needed to preserve the user action.

Collector behavior:

- Extract article text.
- Save QR, poster, or registration image assets.
- Attach evidence asset references to the event draft.
- Mark the draft with `qr_registration` and `registration_evidence_required`.

Default review routing:

- Route to admin review before publication.
- Publishing must be blocked if required public action information is missing and no usable evidence asset is attached.

### `image_dominant`

Use when key event content is in images and DOM text is insufficient.

Example pattern:

- Article body text is sparse or generic.
- Posters contain date/time, venue, entry notes, or organizer details.

Collector behavior:

- Save full-page screenshot.
- Save original image assets when allowed by the page.
- Run OCR or vision extraction on relevant images.
- Preserve OCR/vision text as extraction evidence.
- Produce event drafts with lower default confidence than text-derived drafts.

Default review routing:

- Route to admin review.
- Show image evidence and OCR/vision notes in the review surface.

### `image_with_qr_registration`

Use when key event content and QR/registration action are both inside images.

Example pattern:

- Poster contains activity details.
- QR image or registration action is embedded in the same poster set.

Collector behavior:

- Save full-page screenshot.
- Save poster images and QR/registration image candidates.
- Run OCR or vision extraction on event detail regions.
- Mark evidence assets by role when possible: `poster`, `qr`, `registration`, `screenshot`.
- Produce event drafts with `image_dominant`, `qr_registration`, and `registration_evidence_required` signals.

Default review routing:

- Route to admin review.
- Publishing must require operator confirmation that the registration evidence is usable.

## Collector Run Flow

The collector should process sources on a low-frequency schedule, initially every 4 hours, or through an admin-triggered seed URL run.

Admin-triggered seed URL runs should use the job-claim flow defined in [Local Collector Console And Job Queue Spec](local-collector-console.md).

Required flow:

1. Start a source run with collector identity, source or seed URL, and started time.
2. Open the article or source page using the collector runtime.
3. Respect platform protections. Do not bypass captchas, login walls, or aggressive anti-automation.
4. Capture page metadata, visible text, bounded HTML summary if needed, full-page screenshot, and image asset candidates.
5. Classify capture mode.
6. Extract event draft candidates using the mode-specific path.
7. Attach evidence assets to drafts.
8. Upload normalized objects to Vercel ingest endpoints.
9. Upload a source run completion report with success, partial, or failure state.

The collector should upload partial results when possible. For example, if text extraction succeeds but QR image download fails, upload the article snapshot, event draft, and a failure report for the missing evidence.

## Normalized Objects

These TypeScript-like shapes define the collector-facing contract. Production code should implement equivalent schema validation in shared TypeScript contracts.

### `CollectorEnvelope`

All collector uploads must include:

```ts
type CollectorEnvelope<T> = {
  collectorId: string;
  runId: string;
  observedAt: string;
  payloadVersion: "2026-05-collector-v1";
  payload: T;
};
```

`runId` is generated by the collector and remains stable for all uploads from the same run.

### `SourceRunReport`

```ts
type SourceRunStatus = "success" | "partial" | "failed";

type SourceRunReport = {
  sourceId?: string;
  seedUrl?: string;
  status: SourceRunStatus;
  startedAt: string;
  finishedAt?: string;
  checkedUrlCount: number;
  articleCount: number;
  draftCount: number;
  failureCount: number;
  failureReason?: FailureReason;
  diagnostics?: DiagnosticSummary[];
};
```

### `ArticleSnapshot`

```ts
type CaptureMode =
  | "text_complete"
  | "text_with_qr_registration"
  | "image_dominant"
  | "image_with_qr_registration"
  | "not_activity"
  | "unsupported";

type ArticleSnapshot = {
  sourceId?: string;
  sourceName?: string;
  canonicalUrl: string;
  finalUrl: string;
  title?: string;
  authorName?: string;
  publishedAt?: string;
  capturedAt: string;
  languageHints: string[];
  captureMode: CaptureMode;
  visibleText?: string;
  textHash?: string;
  screenshotAssetId?: string;
  evidenceAssetIds: string[];
  contentHash: string;
};
```

`visibleText` should be bounded. It is used for extraction and review, not as a permanent full article mirror.

### `EvidenceAsset`

```ts
type EvidenceRole =
  | "cover"
  | "poster"
  | "qr"
  | "registration"
  | "screenshot"
  | "article_image"
  | "ocr_text"
  | "vision_summary";

type EvidenceAsset = {
  assetId: string;
  articleUrl: string;
  role: EvidenceRole;
  mediaType: "image" | "text" | "html_summary";
  sourceUrl?: string;
  storagePath?: string;
  width?: number;
  height?: number;
  contentHash: string;
  textContent?: string;
  extractedBy?: "dom" | "ocr" | "vision" | "manual";
  confidence?: number;
};
```

Image bytes should be uploaded through the backend-approved storage path once storage is implemented. Until then, local prototype artifacts may remain outside the repository.

### `EventDraftUpload`

```ts
type DraftSignal =
  | "qr_registration"
  | "registration_evidence_required"
  | "image_dominant"
  | "missing_required_public_field"
  | "secondary_mention"
  | "possible_duplicate"
  | "ready_for_review";

type EventDraftUpload = {
  articleUrl: string;
  sourceId?: string;
  extractionAttemptId: string;
  captureMode: CaptureMode;
  title?: string;
  originalTitle?: string;
  organizer?: string;
  startsAt?: string;
  endsAt?: string;
  timezone: "Asia/Shanghai";
  venueName?: string;
  venueAddress?: string;
  city: "Beijing";
  reservationStatus?: "required" | "not_required" | "unknown";
  registrationAction?: string;
  registrationUrl?: string;
  summary?: string;
  entryNotes?: string;
  signals: DraftSignal[];
  evidenceAssetIds: string[];
  fieldEvidence: Record<string, string[]>;
  confidence: number;
};
```

The collector may leave fields empty when source material is incomplete. Empty fields are valid for draft upload. The backend decides whether the draft is publishable.

### `CollectorFailure`

```ts
type FailureReason =
  | "fetch_blocked"
  | "fetch_timeout"
  | "login_required"
  | "captcha_required"
  | "parser_mismatch"
  | "source_identity_missing"
  | "activity_fields_missing"
  | "image_download_failed"
  | "ocr_failed"
  | "vision_failed"
  | "not_activity"
  | "unsupported";

type CollectorFailure = {
  sourceId?: string;
  articleUrl?: string;
  stage:
    | "source_discovery"
    | "page_fetch"
    | "dom_parse"
    | "image_capture"
    | "ocr"
    | "vision_extraction"
    | "draft_extraction"
    | "upload";
  reason: FailureReason;
  message: string;
  retryable: boolean;
  screenshotAssetId?: string;
  diagnostics?: DiagnosticSummary[];
};

type DiagnosticSummary = {
  key: string;
  value: string;
};
```

Failure messages must be useful to an operator but must not include secrets, cookies, tokens, or long raw page dumps.

## Ingest API Surface

The Vercel app should expose authenticated collector endpoints:

- `POST /api/collector/source-run`
- `POST /api/collector/article-snapshot`
- `POST /api/collector/evidence-asset`
- `POST /api/collector/event-draft`
- `POST /api/collector/failure`

All endpoints must:

- require bearer-token authentication using `COLLECTOR_API_KEY`
- validate request schemas
- reject unknown payload versions
- store enough run context for admin diagnostics
- return stable object identifiers for uploaded objects
- behave idempotently

Recommended idempotency keys:

- source run: `collectorId + runId`
- article snapshot: normalized canonical URL + content hash
- evidence asset: article URL + role + content hash
- event draft: article URL + extraction attempt ID + normalized title/time/venue hash
- failure: run ID + stage + reason + article URL when present

## Backend Validation Responsibilities

The backend must not trust collector classification or extraction. It should:

- normalize URLs
- verify required schema fields
- validate date/time parsing against `Asia/Shanghai`
- reject impossible dates or malformed URLs
- deduplicate snapshots and drafts
- preserve evidence links for admin review
- compute publish eligibility separately from collector confidence
- route low-confidence, image-derived, QR-dependent, secondary-mention, duplicate-risk, and missing-field drafts to admin review

The backend may store raw collector confidence, but should compute its own review and publish state.

## Storage Rules

The MVP should avoid turning article capture into a permanent full article mirror.

Allowed long-term storage:

- normalized source metadata
- source run history
- bounded visible text needed for extraction and review
- extracted event draft fields
- evidence asset metadata
- selected screenshots or images needed for review
- OCR/vision excerpts needed to justify extracted fields
- failure diagnostics

Avoid storing:

- browser cookies or session state
- unbounded HTML snapshots
- unrelated page assets
- full article mirrors as a product feature
- secrets in diagnostics

## Agent Implementation Guidance

Future coding agents should implement this in independent slices.

### Slice 1: Shared Contracts

Create TypeScript types and Zod schemas for normalized objects. Add tests for valid and invalid payloads.

Expected output:

- shared collector contract module
- schema tests
- example fixtures for the four capture modes

### Slice 2: Ingest API

Implement authenticated Vercel API routes that validate collector envelopes and persist normalized records.

Expected output:

- collector API route group
- auth tests
- schema validation tests
- idempotency tests

### Slice 3: Supabase Schema

Add tables and constraints for source runs, article snapshots, evidence assets, event drafts, and failures.

Expected output:

- migration files
- unique constraints for idempotency
- indexes for admin review queues

### Slice 4: Local Collector Harness

Build a local collector command that can process a seed URL and emit normalized uploads.

Expected output:

- local CLI or script entry point
- persistent browser profile configuration
- run report upload
- fixture mode for saved sample pages

### Slice 5: Extraction Adapters

Implement mode-specific extraction adapters:

- DOM text extraction
- QR/poster evidence detection
- image saving
- OCR or vision extraction provider abstraction
- failure mapping

Expected output:

- deterministic adapter tests using saved fixtures
- no captcha or login bypass behavior

### Slice 6: Admin Review Integration

Show uploaded drafts, evidence, and failures in the admin portal implementation.

Expected output:

- draft review queues
- evidence links
- source/run error detail state
- publish blocking based on backend eligibility

## Validation Expectations

For this spec:

- run a marker scan for unresolved drafting markers
- run `git diff --check`
- inspect consistency with `docs/technical-baseline.md`, `docs/tech-stack.md`, and `docs/admin-portal-requirements.md`

For future implementation:

- unit-test contracts and schema validation
- integration-test collector API authentication and idempotency
- fixture-test all four capture modes
- test failure mapping for captcha, login, fetch block, image download, OCR, and vision failures
- test that collector uploads cannot directly publish canonical events
- browser-smoke admin review of image evidence and error detail state
