# MVP Goal Pack

This document is the execution contract for a future Codex goal-mode session.
It must be enough for that session to complete the MVP without relying on chat
history.

## Goal Objective

Complete the local activities MVP so an operator can maintain official activity
sources, ingest new posts through a local WeChat RSS path, extract reviewable
event drafts, publish approved events, and show a mobile-first public catalog of
upcoming Beijing cultural activities.

The first tracked-source path is a Mac-local Wechat2RSS Docker service feeding a
local collector. Vercel hosts the Next.js app and APIs. Supabase stores sources,
article snapshots, event drafts, assets, and published events.

## Verified Baseline

The repository already has a working deployed app/API boundary and Supabase
connection. Treat this as a verified starting point, not as a feature to
redesign.

Verified on 2026-06-02:

- `pnpm smoke:admin-readonly --env-file .env.local` passed against
  `https://local-activities.vercel.app`.
- `/api/health` returned `200` with `ok: true` in production.
- `/api/health/supabase` returned `200` with `ok: true` against the configured
  Supabase host.
- `/api/collector/ping` returned `200` with the configured collector API key and
  `COLLECTOR_ID=local-dev-collector`.
- `pnpm env:check --env-file .env.local --target local-app` passed.

The local shell may warn if Node.js is not `24.x`. The project target remains
Node.js 24 LTS and pnpm 11.

## Source Of Truth

Read these before coding:

- [AGENTS.md](../AGENTS.md)
- [Requirements](requirements.md)
- [Technical Baseline](technical-baseline.md)
- [External Dependencies](external-dependencies.md)
- [Testing Strategy](testing-strategy.md)
- [Smoke Tests](smoke-tests.md)
- this document

Follow the GitHub workflow in `AGENTS.md`. If a suitable implementation issue
does not exist, create one before coding. For a large goal, create an umbrella
issue and split independently testable subissues as needed.

## Scope

Implement a complete MVP path across these modules:

1. Asset storage abstraction
2. Wechat2RSS local source adapter
3. Local collector sync
4. Collector ingestion and source health updates
5. LLM information extraction
6. Admin review and publish flow
7. Public mobile catalog and event details
8. Local Mac setup docs and smoke commands

The implementation must keep frontend, backend, collector, storage, and LLM
responsibilities explicit.

## Non-Goals

- Do not promise complete coverage of all WeChat official accounts.
- Do not bypass captchas, login checks, platform protections, or account risk
  controls.
- Do not put long-running browser or WeChat sessions inside ordinary Vercel
  request/response functions.
- Do not require LangChain or LangGraph for MVP extraction.
- Do not make Codex/editor-agent scraping the primary tracked-source mechanism.
- Do not auto-publish uncertain LLM results.
- Do not build a generic user-submitted city-events platform.
- Do not add third-party APM such as Sentry, Datadog, or New Relic.
- Do not store permanent full article mirrors as a product feature.

## External Dependency Contract

The repository must support two run levels:

### Fixture Path

The fixture path must run from a fresh clone with local env values and no real
Wechat2RSS login or live LLM call. Use fixtures and mocks for deterministic
tests.

### Real Source Path

The real source path requires operator-provided external inputs:

- Vercel app/API environment already configured.
- Supabase credentials already configured.
- Vercel Blob token or selected asset-storage provider config.
- LLM provider API key and model.
- Wechat2RSS license/config when required by that service.
- Wechat2RSS login completed by operator QR scan in the local web UI.
- Collector API key and collector ID.

If these inputs are missing, keep the fixture path working and report the missing
operator action. Do not redesign around the missing secret.

## Architecture

The MVP pipeline is:

```text
Wechat2RSS or fixture source
-> local collector source adapter
-> normalized article index and article snapshot
-> authenticated Vercel collector APIs
-> Supabase records and asset storage
-> LLM classification and event extraction
-> backend schema validation and review-state assignment
-> admin review/publish
-> public catalog and event detail pages
```

Collector and LLM outputs are untrusted. Backend code must validate schemas,
deduplicate, assign source health, and decide draft/publish state.

## Module Contracts

### Asset Storage

Create or replace the current narrow poster uploader with an `AssetStorage`
boundary.

Expected behavior:

- Upload runtime assets such as posters, QR images, screenshots, covers, and
  article images.
- Return a stable asset record containing provider, storage key, public URL or
  access mode, content type, byte size, content hash, and optional etag.
- First adapter may use Vercel Blob.
- Business code must reference `asset_id`, not provider URLs as primary keys.
- Keep the adapter boundary suitable for later S3 or Cloudflare R2 migration.

### Wechat2RSS Adapter

Add a source adapter that can read from a Mac-local Wechat2RSS service.

Expected behavior:

- Read base URL and token from collector env.
- Query new articles using a bounded lookback window based on last successful
  sync.
- Normalize feed/API results into article index items and snapshots.
- Map login/account/risk/fetch failures into product-visible source health and
  failure reasons.
- Treat Wechat2RSS as a source provider, not as the database of record.
- Do not expose Wechat2RSS publicly.

### Local Collector Sync

Add a local collector command for tracked Wechat2RSS sources.

Expected behavior:

- Run once on demand and be safe to run repeatedly.
- Use `last_success_at` minus a safety window to recover from missed runs.
- Deduplicate by article URL, source identity, and content hash.
- Upload only normalized payloads through Vercel APIs.
- Never write directly to Supabase from the collector.
- Prepare for launchd/cron later, but do not require automatic installation.

### Ingestion And Source Health

Collector-facing APIs must remain authenticated by collector token or scoped
collector token.

Expected behavior:

- Store sources, source runs, article snapshots, evidence assets, event drafts,
  and structured failures.
- Preserve product-visible health states and reasons.
- Make repeated uploads idempotent.
- Keep source health visible to admin users, not hidden only in logs.

### LLM Extraction

Use direct provider API calls plus prompt and schema management.

Expected behavior:

- Do not introduce LangChain or LangGraph unless a later issue proves the need.
- Version prompts, schema versions, provider names, and model IDs.
- Classify articles before expensive extraction.
- Extract structured event drafts with evidence, missing fields, confidence, and
  review signals.
- Support text-dominant articles, image-dominant posters, QR-registration
  assets, multi-mention posts, cancellations, and non-activity posts.
- Default tests must use fixtures or mocked provider responses. Live model smoke
  tests are optional and operator-run.

### Admin Review

Expected behavior:

- Show source health and recent run state.
- Show event drafts with source article, field evidence, asset evidence, missing
  fields, and confidence.
- Allow approve/publish, reject, and needs-info decisions.
- Avoid exposing public users to extraction diagnostics.

### Public Catalog

Expected behavior:

- Mobile-first upcoming activity list grouped for weekend planning.
- Public event detail pages show action-critical fields first: status, time,
  venue/address, registration requirement, registration URL or QR, source URL.
- Hide expired events from the main public flow.
- Keep event pages shareable by URL.

### Mac-Local Wechat2RSS Setup

Add operator-facing setup artifacts:

- `docker-compose.wechat2rss.yml`
- `.env.wechat2rss.example`
- `.env.collector.example` or update the existing collector env example path
- `docs/local-wechat2rss-collector.md`
- smoke or setup commands for checking Wechat2RSS connectivity and collector
  upload

The documented flow should be:

```text
git clone repository
copy and fill Wechat2RSS env
start Docker Compose
open local Wechat2RSS admin UI
scan QR code and resolve account risk manually
configure collector env
run one collector sync
run smoke checks
```

## Expected Commands

Use existing commands where available:

```bash
pnpm env:check --env-file .env.local --target local-app
pnpm smoke:admin-readonly --env-file .env.local
pnpm test
pnpm typecheck
```

Implement additional commands when their modules land. Names may change if the
implementation chooses a clearer equivalent, but the capabilities must exist:

```bash
pnpm smoke:collector-ping --env-file .env.local
pnpm smoke:wechat2rss --env-file .env.collector
pnpm collector:wechat2rss:once --env-file .env.collector
pnpm smoke:e2e-mvp --env-file .env.local
```

Production-mutating smoke tests must be clearly labeled and must not run by
default in ordinary unit-test or CI flows.

## Validation Matrix

Every module must have fixture or mock tests first. Real external-service checks
are smoke tests.

| Area | Required validation |
| --- | --- |
| Asset storage | fake adapter unit tests, Vercel Blob adapter tests with mocked SDK |
| Wechat2RSS adapter | fixture/mock API tests for article parsing, auth failures, account risk, and dedupe |
| Collector sync | tests for lookback recovery, idempotent uploads, source health updates, and retry boundaries |
| Ingest API | auth negative tests, schema validation, duplicate upload behavior |
| LLM extraction | schema validation, prompt version recording, mocked provider responses, extraction fixtures |
| Admin review | service tests for approve/reject/needs-info and source health state |
| Public catalog | tests for upcoming filtering, expired hiding, QR registration rendering, and public-only fields |
| Deployed app | read-only admin smoke, health endpoints, collector ping |

## Blocking Conditions

Only stop for user input when the work is genuinely blocked by one of these:

- Missing or invalid secrets that are explicitly operator-provided.
- Wechat2RSS license, login, QR scan, or account-risk state that requires the
  operator.
- Vercel or Supabase permission failure that cannot be resolved by code changes.
- A destructive git/database action would be required.
- A production-mutating smoke test needs explicit approval.
- The same external outage or platform block prevents meaningful progress after
  repeated attempts.
- Required current documentation for a fast-moving dependency cannot be fetched
  and implementation would be guesswork.

Do not stop merely because the goal is large. Continue with fixture-backed
implementation and document the remaining operator action.

## Completion Criteria

The MVP goal is complete when:

- A fresh clone can run fixture-based local tests without Wechat2RSS login or
  live LLM calls.
- Current Vercel/Supabase health checks still pass.
- The deployed API accepts authenticated collector requests.
- A Mac-local Wechat2RSS Docker setup is documented and can be checked by smoke
  commands when operator credentials are present.
- The local collector can discover new WeChat RSS articles, upload normalized
  article snapshots, and update source health.
- LLM extraction produces validated reviewable event drafts from fixture and
  real article snapshots.
- Admin can review and publish drafts.
- Public mobile pages show approved upcoming events and hide admin diagnostics.
- Required tests and read-only smoke checks pass.
- A PR or PR set exists with issue handoff comments recording what was done,
  what was validated, and what remains operator-dependent.

## Handoff Requirements

For every implementation issue, add the handoff comment required by `AGENTS.md`:

```markdown
## Handoff - YYYY-MM-DD

Done:
- ...

Validated:
- `command used`

Open:
- ...

Next:
- ...
```

The final handoff must include the exact local Mac setup commands, smoke
commands, and any external operator actions that still need to be performed.

## Goal-Mode Prompt

Use this in a new Codex goal-mode session:

```text
/goal Complete the MVP described in docs/mvp-goal.md.

Read AGENTS.md and docs/mvp-goal.md first. Treat docs/mvp-goal.md as the
execution contract and do not rely on prior chat history.

Work autonomously until every completion criterion in docs/mvp-goal.md is met,
or until you are genuinely blocked by one of its listed blocking conditions.

Follow the GitHub workflow in AGENTS.md. Create or locate implementation issues
before coding, create focused branches, add tests, open PRs, and update issue
handoff comments. If the MVP needs multiple independently testable issues, split
them and keep working through the set without asking for steering.

Do not expand scope beyond docs/mvp-goal.md. Do not introduce LangChain,
LangGraph, third-party APM, direct Supabase writes from the collector, or
anti-captcha/anti-platform-protection behavior.

Use fixture-backed tests for deterministic validation and use real
external-service smoke tests only when the required env vars and operator
credentials are present. Do not run production-mutating smoke tests without
explicit approval.

Before marking the goal complete, run the relevant validation commands, including
pnpm test, pnpm typecheck, pnpm env:check --env-file .env.local --target
local-app, pnpm smoke:admin-readonly --env-file .env.local, and any new smoke
commands implemented for the MVP.
```
