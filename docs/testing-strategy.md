# Testing Strategy

## Purpose

Testing should make each feature independently verifiable. Every GitHub issue should state how its behavior will be checked before a PR is merged.

## General Rules

- Prefer small, focused tests around domain behavior.
- Add fixtures for crawler, extraction, matching, and revision examples.
- Keep high-risk logic out of UI components so it can be unit tested.
- Record validation commands in the PR and issue handoff.
- Do not claim a task is complete without running the relevant checks.

## Public Frontend

Test focus:

- upcoming event filtering
- event card and detail rendering
- empty states
- mobile layout regressions after UI scaffolding exists
- cultural-calendar grouping by date or near-term bucket
- desktop agenda plus detail preview behavior
- mobile list-to-detail behavior
- registration QR section rendering for QR-only registration events
- hiding admin or extraction diagnostics from public pages

Expected checks:

- component or route tests for data-to-view behavior
- browser smoke tests for key public pages once the app is scaffolded
- fixture-driven visual smoke checks for mobile and desktop layouts

## Admin Dashboard

Test focus:

- source health states
- event draft review decisions
- duplicate review decisions
- update and cancellation review decisions

Expected checks:

- unit tests for state transitions
- integration tests for admin actions
- browser smoke tests for critical admin flows after UI scaffolding exists

## Backend API

Test focus:

- request schema validation
- collector authentication
- idempotent ingestion by URL and content hash
- public/admin/collector permission boundaries

Expected checks:

- API route tests or service-level integration tests
- negative tests for missing auth and malformed payloads
- duplicate upload tests

## Collector Runtime

Test focus:

- adapter output normalization
- failure reason mapping
- source run reporting
- upload retries and idempotency
- WeChat lazy-loaded image discovery after scrolling
- poster and QR image preservation
- source pattern classification

Expected checks:

- unit tests for adapters using saved page fixtures
- integration tests against local or mocked ingest endpoints
- no tests should require bypassing captcha or platform protections
- fixtures for text-dominant, image-dominant, QR-registration, multi-mention, blocked, and expired source posts

## Extraction / LLM

Test focus:

- article classification
- multi-event extraction from one article
- evidence attachment
- confidence routing
- relative date normalization using article publication date and Asia/Shanghai timezone
- OCR or vision extraction from retained poster images
- QR-registration detection and asset attachment
- separation of public fields from admin-only extraction notes

Expected checks:

- fixture-based extraction tests with saved article text
- fixture-based extraction tests with saved poster and QR images
- schema validation tests for model output
- regression fixtures for known extraction failures

## Matching / Revision

Test focus:

- no-ID duplicate detection
- blocking candidate selection
- weighted scoring explanations
- update proposals
- cancellation proposals

Expected checks:

- deterministic unit tests for matching scores and thresholds
- fixtures for multi-source duplicates such as a shared embassy event
- tests proving missing or failed source fetches do not imply cancellation

## Location

Test focus:

- provider abstraction
- geocoding confidence handling
- coordinate system persistence
- map deeplink construction

Expected checks:

- provider contract tests with mocked geocoding responses
- unit tests for coordinate metadata and deeplink output

## Documentation-Only Changes

For documentation-only PRs:

- run a placeholder scan for unresolved markers
- inspect the diff for internal consistency
- verify links and file paths that were added
