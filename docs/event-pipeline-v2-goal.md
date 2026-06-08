# Event Pipeline V2 Goal Pack

> Superseded for current implementation planning by
> [Event Pipeline V4 Goal Pack](event-pipeline-v4-goal.md). Keep this file for
> historical context only.

This document is the execution contract for a future Codex goal-mode session.
It must be enough for that session to implement the Event Pipeline V2 refactor
without relying on chat history.

## Goal Objective

Refactor the activity pipeline so tracked official-account posts can become
deduplicated, evidence-backed, public-ready Beijing activity listings through a
fixture-replayable workflow.

The product direction is an automated local events desk: source adapters act as
reporters, evidence capture records reporter notes, the LLM editorial processor
triages and extracts event information, LLM resolution handles dedupe and update
judgment, backend policy owns publication, and admin work handles exceptions.

The target stack remains the current stack from `docs/quickstart.md`: Next.js,
TypeScript, Node.js 24, pnpm 11, direct OpenAI-compatible API calls, Vercel,
Vercel Blob or the selected asset storage adapter, and Supabase Postgres.

## E2E Product Outcomes

### Public User View

Public users should see only published canonical events. A real-world event
should not appear multiple times because it was mentioned by multiple articles.

The public catalog and detail pages must support:

- single events with exact start and end times
- multi-day events with a clear display range
- long-running exhibitions with schedule text such as `through August 30,
  Tuesday-Sunday 10:00-18:00, closed Monday`
- recurring activities with schedule text and generated upcoming occurrences
- poster thumbnails when a public poster asset exists
- registration links or QR sections when the source requires them
- non-public official news, private visits, and internal itineraries excluded
  from ordinary public discovery

Public pages must not expose triage, extraction, or resolution diagnostics,
model names, confidence, field evidence, review state labels, or admin-only
reasoning.

### Admin And Developer View

Admins and developers should see the full pipeline state:

- source health and recent source runs
- article snapshots, content hashes, image candidates, and capture mode
- evidence assets, including poster, QR, screenshot, OCR text, and vision
  summaries
- editorial processor prompt version, schema version, provider, model, triage
  decision, raw parsed output, field evidence, missing fields, confidence, and
  public eligibility
- dedupe candidates and LLM resolution rationale
- publish blockers with specific reasons
- excluded article review, promote-to-extraction, draft edit, reject, merge,
  needs-info, and publish actions

The admin portal must explain why a publish action is blocked. A disabled
button without a visible reason is not acceptable.

## Source Of Truth

Read these before implementation:

- [AGENTS.md](../AGENTS.md)
- [Requirements](requirements.md)
- [Admin Portal Requirements](admin-portal-requirements.md)
- [Technical Baseline](technical-baseline.md)
- [External Dependencies](external-dependencies.md)
- [Testing Strategy](testing-strategy.md)
- [Event Pipeline V2 Testing And Environment Isolation](event-pipeline-v2-testing.md)
- [Smoke Tests](smoke-tests.md)
- [Quickstart](quickstart.md)
- this document

Follow the GitHub workflow in `AGENTS.md`. Use the implementation issues listed
below. Do not rely on prior chat history.

## Implementation Issues

Complete these issues in order unless a later issue is strictly blocked by a
missing operator credential. Each issue must have its own branch, tests, PR, and
handoff comment.

1. [#142 Event Pipeline V2: align Supabase schema and contracts](https://github.com/apue/local-activities/issues/142)
2. [#143 Event Pipeline V2: build testing infrastructure and fixture replay harness](https://github.com/apue/local-activities/issues/143)
3. [#144 Event Pipeline V2: retain WeChat image, poster, and QR evidence](https://github.com/apue/local-activities/issues/144)
4. [#150 Event Pipeline V2: implement LLM editorial triage](https://github.com/apue/local-activities/issues/150)
5. [#146 Event Pipeline V2: implement extraction schema v2](https://github.com/apue/local-activities/issues/146)
6. [#147 Event Pipeline V2: add LLM dedupe and resolution to WeChat sync](https://github.com/apue/local-activities/issues/147)
7. [#148 Event Pipeline V2: enforce publish policy and admin review controls](https://github.com/apue/local-activities/issues/148)
8. [#145 Event Pipeline V2: render schedules, posters, QR, and deduped events publicly](https://github.com/apue/local-activities/issues/145)

Umbrella: [#141 Event Pipeline V2 umbrella](https://github.com/apue/local-activities/issues/141).

## Non-Goals

- Do not bypass captchas, login checks, platform protections, or account-risk
  controls.
- Do not require live WeChat crawling or live LLM calls for CI.
- Do not introduce LangChain or LangGraph.
- Do not add Sentry, Datadog, New Relic, or other third-party APM.
- Do not write directly to Supabase from the collector.
- Do not run production-mutating migrations, draft cleanup, canonical-event
  cleanup, or production replay without explicit operator approval.
- Do not store permanent full article mirrors as a product feature.
- Do not make every source-site image public. Only retain assets needed for
  extraction, review, or public user action.

## Architecture

The V2 pipeline is:

```text
source adapter or fixture
-> article snapshot plus image candidates
-> evidence asset preparation and storage
-> direct LLM editorial triage
-> excluded article state or extraction input
-> direct LLM extraction for extractable articles
-> schema parse and normalization
-> candidate lookup
-> direct LLM dedupe/resolution
-> backend publish policy
-> admin review/edit/merge/publish
-> public canonical-event rendering
```

Collector and LLM outputs remain untrusted inputs for state changes. They may
make an event candidate eligible for backend auto-publication, but the backend
validates schemas, assigns review state, computes publish blockers, records
dedupe decisions, and performs the final publication transition.

Triage and extraction are separate contracts and persisted stages. Runtime code
may implement them in one direct LLM API call when that is simpler or cheaper,
but tests, fixtures, backend state, and admin surfaces must treat the triage
decision separately from extracted event candidates.

## Fixture And Replay Contract

Testing and environment isolation are defined in
[Event Pipeline V2 Testing And Environment Isolation](event-pipeline-v2-testing.md).
Live source URLs are sampling inputs, not long-term tests. Default development
and CI must use committed fixtures and recorded LLM responses.

Add fixtures under:

```text
fixtures/event-pipeline-v2/<case-id>/
```

Each case directory must contain these files:

```text
source.json
raw-wechat2rss.json
article-snapshot.json
image-candidates.json
evidence-assets.json
triage-input.json
triage-response.json
triage-decision.json
extraction-input.json
extraction-response.json
extracted-event-candidates.json
candidate-events.json
resolution-response.json
expected.json
```

Required fixture cases:

- `beiping-beer-festival`: same real-world event appears in multiple WeChat
  articles and an existing canonical event.
- `goethe-weekend-roundup`: one roundup article contains several standalone
  events and long-running/recurring mentions.
- `goethe-weekly-library`: recurring weekly activity, `every Saturday
  16:00-17:00`.
- `goethe-sonic-exhibition`: long-running exhibition, through 2026-08-30,
  Tuesday-Sunday 10:00-18:00, closed Monday.
- `official-visit-news`: official visit/news item that is not public-facing
  activity.
- `korean-red-flavor`: high-confidence single public activity.
- `italian-monthly-roundup`: one article with many cultural activities.
- `qr-registration-poster`: event where registration action is a QR image.

Implement commands with these capabilities. The exact script names may differ
only if the issue handoff clearly records the equivalent command.

```bash
pnpm fixture:capture -- --case <case-id> --url <source-url> --env-file .env.collector
pnpm fixture:replay -- --case <case-id> --stage snapshot
pnpm fixture:replay -- --case <case-id> --stage triage
pnpm fixture:replay -- --case <case-id> --stage extraction
pnpm fixture:replay -- --case <case-id> --stage resolution
pnpm fixture:e2e -- --case <case-id>
pnpm fixture:e2e -- --all
```

Default tests must use replay. `fixture:capture` is operator-run and may require
Wechat2RSS login, local browser state, or live LLM credentials. Captured
fixtures must not include secrets, cookies, private account state, or full
article mirrors beyond what is needed for deterministic tests.

## Target Data Semantics

V2 editorial processing must distinguish these concerns:

- triage decision: `public_activity`, `possible_public_activity`,
  `official_visit`, `non_public_news`, `internal_or_private`, `not_event`, or
  `unsupported`
- triage action: `extract`, `review`, or `exclude`
- public eligibility: `public`, `not_public`, or `unclear`
- event kind: `single`, `multi_day`, `long_running`, `recurring`, `news`,
  `visit`, `cancellation`, or `unsupported`
- schedule: exact datetimes, display schedule text, recurrence rule, generated
  upcoming occurrences, and timezone
- evidence: asset ids for poster, QR, article image, screenshot, OCR text, and
  vision summary
- registration: `required`, `not_required`, or `unknown`, plus URL, QR asset, or
  source action text when present
- dedupe resolution: `new_event`, `same_event`, `update_existing`,
  `cancel_existing`, `withdraw_existing`, `not_public_activity`, or
  `insufficient_info`
- publish blockers: explicit backend-computed reasons

`confidence` is one policy input, not a publication instruction. High confidence
must not publish a non-public visit, duplicate event, unsupported schedule, or
QR-required event without QR evidence.

Triage must happen before ordinary event draft creation. Articles classified as
`official_visit`, `non_public_news`, `internal_or_private`, `not_event`, or
`unsupported` should become excluded article records, not ordinary event drafts.
They remain source evidence and may be promoted to extraction by an admin action
or backend command when triage produced a false negative.

## Required Fixture Outcomes

The all-case fixture E2E command must validate these outcomes:

- `beiping-beer-festival`: exactly one public canonical event for the real-world
  beer festival; new mentions resolve to the existing canonical event or update
  proposal, not duplicate public cards.
- `goethe-weekend-roundup`: standalone events become drafts or canonical events
  according to policy; weak secondary mentions do not auto-publish.
- `goethe-weekly-library`: recurring schedule is preserved and upcoming
  occurrences can be generated without a live crawl.
- `goethe-sonic-exhibition`: long-running exhibition schedule is preserved and
  renderable without requiring a fake exact start datetime.
- `official-visit-news`: classified as non-public activity or news/visit; it
  does not enter the ordinary publish queue.
- `korean-red-flavor`: high-confidence complete public single event can
  auto-publish when no blockers exist.
- `italian-monthly-roundup`: multiple activities are separated; incomplete or
  date-only items route to review instead of creating confusing public listings.
- `qr-registration-poster`: QR evidence is retained and required before publish.

## Module Contracts

### Schema And Store Parity

Supabase migrations, contracts, stores, and route handlers must agree on V2
fields. Add read-only checks that surface missing production columns before live
ingestion. Do not rely on optional-column fallbacks for required V2 behavior.

### Source Adapter And Snapshot

The Wechat2RSS path must normalize article text and image candidates. Image
candidates should include source URL, width, height, order, nearby text when
available, and capture source. Browser fallback may be used only when operator
credentials are present and platform protections are not bypassed.

### Evidence And Asset Storage

Use the `AssetStorage` boundary for posters, QR images, screenshots, and article
images. App-owned public asset URLs may be used for public rendering. Source-site
image URLs should remain source evidence unless uploaded to the configured asset
store.

### Editorial Triage V2

Use direct OpenAI-compatible API calls. Version the triage prompt and schema.
Triage output decides whether an article should be extracted, reviewed as
possible public activity, or excluded as non-public/news/not-event. It does not
publish events. Tests must use recorded provider responses by default.

### Extraction V2

Use direct OpenAI-compatible API calls. Version the prompt and schema. Tests must
use recorded provider responses by default. Extraction runs only for articles
that triage routes to `extract` or `review`. Extraction output is normalized
input to backend policy, not a publish command.

### Dedupe And Resolution

Candidate lookup must include published canonical events, cancelled canonical
events, and active event drafts. Do not rely on strict title `ilike` as the final
dedupe decision. Use LLM resolution only after a bounded candidate set is
available. Record rationale and source evidence.

### Publish Policy

Backend policy computes blockers and final state. Blockers must be separated
into hard and soft blockers.

Hard blockers cannot be overridden by ordinary publish actions:

- triage or extraction indicates not-public activity, official visit, news,
  internal/private content, not-event, or unsupported content
- duplicate, update, cancellation, or withdrawal resolution is unresolved
- source URL is missing
- schedule is not renderable for public users
- QR-required event has no QR evidence

Soft blockers may be overridden by an admin only when the public page remains
readable and actionable, and the publish action records an operator override
reason:

- low confidence
- missing end time
- incomplete venue details when venue text is still human-readable
- missing optional registration notes or description

Auto-publish is allowed only when all required conditions are met:

- public eligibility is `public`
- schedule is supported and renderable
- no duplicate/update/cancellation blocker remains
- required public fields are present for the event kind
- QR-required events have QR evidence
- confidence meets the configured threshold
- no hard or soft blockers remain

### Admin

Admin must show blockers, evidence, source context, extraction metadata,
resolution rationale, and editable fields needed to make a draft publishable.
Save incomplete drafts without publishing. Publishing remains backend-gated.
Admin must support a lightweight session cookie after the operator submits the
configured admin token once. Admin APIs must continue to support bearer-token
authentication for smoke scripts and CLI tools.

The ordinary draft queue should not be polluted by excluded articles. Admin may
have a separate low-priority excluded article surface that shows triage rationale
and supports promote-to-extraction for false negatives.

### Public

Public pages render only canonical published events. Schedule formatting and
upcoming filtering must work for single, multi-day, long-running, and recurring
events.

## Validation Commands

Follow [Event Pipeline V2 Testing And Environment Isolation](event-pipeline-v2-testing.md)
before running fixture, Supabase, Vercel, or live-source validation.

Before the umbrella issue is marked complete, run:

```bash
pnpm test
pnpm typecheck
pnpm env:check --env-file .env.local --target local-app
pnpm smoke:admin-readonly --env-file .env.local
pnpm fixture:e2e -- --all
```

Run these only when the required operator-controlled env and login state are
present. `smoke:wechat2rss` is read-only against the local Wechat2RSS service.
`collector:wechat2rss:once --extract` uploads to the configured collector API
and must be treated as production-mutating when `COLLECTOR_BASE_URL` points at
the deployed app.

```bash
pnpm smoke:wechat2rss --env-file .env.collector
pnpm collector:wechat2rss:once --env-file .env.collector --extract
```

Do not run production-mutating migration, cleanup, replay, or publish commands
without explicit operator approval in the current conversation.

## Blocking Conditions

It is acceptable to stop and request operator input only when one of these
conditions is reached:

- production migration approval is required
- production draft or canonical-event cleanup approval is required
- Wechat2RSS login, license, or account-risk state blocks live smoke
- required LLM or asset-storage credentials are missing for a live smoke
- Vercel or Supabase credentials required for read-only smoke are unavailable
- the fixture path cannot progress because the committed fixtures are missing or
  internally inconsistent

Do not mark the goal blocked because live WeChat crawling is unavailable if the
fixture path can still be implemented and tested.

## Goal Prompt For Implementation

Use this when starting the medium goal-mode implementation:

```text
/goal Complete Event Pipeline V2 as described in docs/event-pipeline-v2-goal.md.

Read AGENTS.md and docs/event-pipeline-v2-goal.md first. Treat the document as
the execution contract and do not rely on chat history.

Work through issues #142, #143, #144, #150, #146, #147, #148, and #145 in order
under umbrella issue #141. Use the GitHub workflow in AGENTS.md: issue ->
branch -> implementation -> tests -> PR -> checks -> merge -> issue handoff.

Do not expand scope beyond docs/event-pipeline-v2-goal.md. Do not introduce
LangChain, LangGraph, third-party APM, direct Supabase writes from the collector,
or anti-platform-protection behavior.

Use fixture/replay tests as the default validation path. Do not require live
WeChat crawling or live LLM calls for CI. Run live external-service smoke tests
only when the required env vars and operator credentials are present. Do not run
production-mutating migrations, cleanup, replay, or publish commands without
explicit approval.

Before marking the goal complete, run all validation commands listed in
docs/event-pipeline-v2-goal.md and update issue handoff comments.
```
