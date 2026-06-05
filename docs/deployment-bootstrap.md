# Deployment Bootstrap Spec

## Purpose

This document defines the MVP bootstrap target for running the product end to end:

```text
GitHub repository
-> Vercel web app and API
-> Supabase Postgres
-> Mac-local Wechat2RSS service and collector runtime
-> OpenAI-compatible provider used by the local extractor
```

The intended reader is a future coding agent implementing deployment scripts, environment validation, local collector startup, or end-to-end smoke tests. Treat this as an execution spec. It defines the required operating shape, secret boundaries, commands that implementation should support, and acceptance criteria.

## Goals

- A fresh clone can be bootstrapped into a working Vercel app/API deployment.
- Required Vercel environment variables can be added or checked with Vercel CLI.
- An operator Mac can clone the same repository, configure local collector
  secrets, run Wechat2RSS in Docker, and run the collector without direct
  Supabase access.
- The local collector can check Wechat2RSS source health, fetch subscribed
  official-account articles, call an OpenAI-compatible provider, upload
  normalized results, and surface reviewable state in the admin portal.
- The backend remains the authority for validation, deduplication, review state, and publication.

## Non-Goals

- Do not make ordinary Vercel request/response functions run unbounded browser automation.
- Do not deploy a dynamic per-URL agent environment.
- Do not let the collector write directly to Supabase.
- Do not put LLM provider keys into browser-visible code.
- Do not add OAuth, per-device certificates, or mTLS for the MVP collector.
- Do not add third-party observability beyond Vercel built-ins.
- Do not require the home collector machine to expose a public inbound URL.

## Target Topology

### Vercel App/API

Vercel hosts:

- public mobile-first event pages
- admin portal
- collector ingest endpoints
- collector run/report endpoints
- lightweight health endpoints
- optional Vercel Cron or Workflow entry points for bounded orchestration

Vercel does not host:

- persistent WeChat browser/login profiles
- unbounded Playwright sessions inside ordinary request/response functions

### Supabase

Supabase Postgres stores:

- sources and source health
- collector jobs
- source runs
- source posts or article index records
- article snapshots
- evidence assets and metadata
- event drafts
- canonical events
- event mentions and revisions
- collector failures and diagnostics

Only server-side Vercel code should use privileged Supabase credentials. The collector uploads through Vercel APIs and never receives service-role credentials.

### Mac-local Collector Machine

The first deployment target is the operator's Mac.

The collector machine runs:

- the same repository clone
- Docker Desktop
- a local Wechat2RSS service
- a local collector command or service
- a local operator console, preferably bound to `127.0.0.1` unless LAN access is explicitly needed
- local run storage when needed
- LLM extraction API client

The collector authenticates to Vercel using `COLLECTOR_API_KEY` and identifies itself with `COLLECTOR_ID`. It does not need inbound access from Vercel.

### Wechat2RSS Collector Runtime

Wechat2RSS is the current production source provider for WeChat official
account subscriptions. It runs locally in Docker so the operator can complete
login and resolve ordinary account prompts without exposing WeChat state to a
hosted crawler.

The collector reads from Wechat2RSS, normalizes articles into snapshots and
evidence assets, calls the LLM extractor when configured, and uploads through
collector APIs. It must not receive Supabase service-role credentials.

### LLM Extractor Provider

The local collector calls the configured OpenAI-compatible provider for
classification and structured extraction. The provider is not a custom
`/extract` service.

Rules:

- The collector converts provider responses into the normalized collector contracts before upload.
- Vercel APIs must not depend on provider-specific response shapes.
- The provider API must not receive `COLLECTOR_API_KEY`, Supabase secrets,
  Vercel tokens, or admin tokens.

## Prerequisites

Both the developer machine and collector machine should support:

- Node.js 24 LTS
- pnpm 11
- Git
- Vercel CLI for the machine that manages Vercel project configuration
- Supabase CLI for schema and local database work
- Access to the OpenAI-compatible provider used for extraction

The Vercel project should be linked to the GitHub repository so PRs create preview deployments and `main` creates production deployments.

The Supabase project should exist before production bootstrap. Local development may use Supabase CLI containers once the schema implementation lands.

## Environment Boundaries

Before setting or rotating secrets, run the environment inventory command for
the target runtime. It prints only variable names and status; it does not print
configured values.

```bash
pnpm env:check --target local-app --env-file .env.local
pnpm env:check --target vercel --env-file .env.local
pnpm env:check --target collector --env-file .env
```

Use `--target all` to check every runtime target against the current process
environment, or `--list-targets` to print the supported target names. Placeholder
values from `.env.example`, such as `replace-with-*`, are treated as not ready.

### Vercel Environment Variables

Vercel production and preview environments need the variables required by the deployed web app and API:

```text
NEXT_PUBLIC_APP_URL
ADMIN_ACCESS_TOKEN
COLLECTOR_API_KEY
INTERNAL_API_SECRET

NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
DATABASE_URL

CRON_SECRET

VERCEL_WEB_ANALYTICS_ENABLED
VERCEL_SPEED_INSIGHTS_ENABLED
OBSERVABILITY_PROVIDER
```

Map/geocoding variables are planned but not required until map or location
features are implemented:

```text
NEXT_PUBLIC_AMAP_JS_API_KEY
AMAP_WEB_SERVICE_API_KEY
AMAP_SECURITY_JS_CODE
```

Keep legacy Supabase aliases only where implementation or local scripts still require them:

```text
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPA_API_URL
SUPA_DB_URL
SUPA_ANON_KEY
SUPA_SERVICE_KEY
```

Provider keys used by the local collector stay on the collector machine unless a
later approved backend issue requires server-side provider access.

### Collector Machine Variables

The collector machine needs:

```text
APP_BASE_URL=https://your-vercel-app.example
COLLECTOR_BASE_URL=https://your-vercel-app.example
COLLECTOR_API_KEY=same-long-random-secret-as-vercel
COLLECTOR_ID=home-mac-1
COLLECTOR_INTERVAL_HOURS=4
COLLECTOR_CAPABILITIES=wechat_browser,dom_text,image_capture,vision_extraction
LOCAL_COLLECTOR_CONSOLE_TOKEN=optional-local-console-token

WECHAT2RSS_BASE_URL=http://127.0.0.1:4000
WECHAT2RSS_TOKEN=wechat2rss-token
WECHAT2RSS_LOOKBACK_DAYS=7

AGENT_PROVIDER=openai_compatible
OPENAI_API_KEY=collector-side-openai-secret
OPENAI_MODEL=provider-model-name
OPENAI_BASE_URL=https://api.openai.com/v1
AGENT_TIMEOUT_SECONDS=120
AGENT_MAX_ATTEMPTS=3
```

The collector may also use `EXA_API_KEY`, `SERPER_API_KEY`, or `FIRECRAWL_API_KEY` if an implementation slice adopts those providers for search or crawl assistance.

Collector `.env` files stay on the collector machine and must not be committed.

### Developer Local Variables

Developer `.env.local` should start from [`.env.example`](../.env.example). It can contain both app and collector variables for local testing, but implementation should keep browser-visible variables limited to `NEXT_PUBLIC_*` values.

## Vercel CLI Bootstrap

Implementation should use Vercel CLI for project linking and environment management.

Expected setup commands:

```bash
vercel link
vercel env ls production
vercel env ls preview
```

Add missing production variables interactively:

```bash
vercel env add ADMIN_ACCESS_TOKEN production
vercel env add COLLECTOR_API_KEY production
vercel env add INTERNAL_API_SECRET production
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY production
vercel env add SUPABASE_SECRET_KEY production
vercel env add DATABASE_URL production
vercel env add CRON_SECRET production
vercel env add NEXT_PUBLIC_APP_URL production
vercel env add OBSERVABILITY_PROVIDER production
vercel env add VERCEL_WEB_ANALYTICS_ENABLED production
vercel env add VERCEL_SPEED_INSIGHTS_ENABLED production
```

Add preview variables the same way:

```bash
vercel env add ADMIN_ACCESS_TOKEN preview
vercel env add COLLECTOR_API_KEY preview
vercel env add INTERNAL_API_SECRET preview
vercel env add NEXT_PUBLIC_SUPABASE_URL preview
vercel env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY preview
vercel env add SUPABASE_SECRET_KEY preview
vercel env add DATABASE_URL preview
vercel env add CRON_SECRET preview
vercel env add NEXT_PUBLIC_APP_URL preview
vercel env add OBSERVABILITY_PROVIDER preview
vercel env add VERCEL_WEB_ANALYTICS_ENABLED preview
vercel env add VERCEL_SPEED_INSIGHTS_ENABLED preview
```

After variables are set, local development can pull a local file:

```bash
vercel env pull .env.local
```

Rules:

- Prefer interactive `vercel env add` prompts over passing secret values inline.
- Do not commit `.vercel`, `.env`, or `.env.local` files.
- Use production and preview values deliberately. The production collector token may be different from preview.
- If a variable must change, use `vercel env update <name> <environment>` and restart or redeploy affected deployments as needed.
- Production should normally deploy through GitHub after merge to `main`. Manual `vercel deploy --prod` is an operator recovery path, not the default PR workflow.

## Collector Machine Bootstrap

The collector machine setup should be possible with a clean clone:

```bash
git clone git@github.com:apue/local-activities.git
cd local-activities
pnpm install
```

If the operator already has a Vercel/app env file on a trusted machine, generate
a collector-only env file instead of copying the whole app environment:

```bash
pnpm collector:bootstrap-env \
  --env-file .env.local \
  --collector-host 192.168.0.16 \
  --output .env
chmod 600 .env
```

The generated file intentionally excludes admin, Supabase, database, and Vercel
management secrets. The operator then edits `.env` with collector-machine
values, especially:

- `APP_BASE_URL`
- `COLLECTOR_BASE_URL`
- `COLLECTOR_API_KEY`
- `COLLECTOR_ID`
- `LOCAL_COLLECTOR_PROCESSOR`
- `AGENT_PROVIDER`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `AGENT_MAX_ATTEMPTS`

Current collector commands:

```bash
pnpm run collector:dev
pnpm run collector
pnpm run collector:console
```

The current V3 target starts the local Wechat2RSS service and runs explicit
collector commands. `pnpm smoke:wechat2rss --env-file .env.collector` checks
source health without uploading. `pnpm collector:wechat2rss:once --env-file
.env.collector --extract` runs the production collector path and uploads through
the configured collector API.

The local console should default to localhost. If exposed on the LAN for convenience, it should require `LOCAL_COLLECTOR_CONSOLE_TOKEN`.

Example startup:

```bash
pnpm env:check --target collector --env-file .env
pnpm collector:console --env-file .env
pnpm collector:console --help
```

If a later local console or scheduler is used, poll cadence is controlled by
`COLLECTOR_POLL_INTERVAL_SECONDS`, `COLLECTOR_ERROR_BACKOFF_SECONDS`, and
`COLLECTOR_CAPABILITIES`.

Live extraction requires collector-side `AGENT_PROVIDER`, `OPENAI_API_KEY`, and
`OPENAI_MODEL`. If they are missing, the local run fails as
`agent_config_missing` without printing provider secrets. The collector validates
provider response schemas before upload, retries invalid responses up to
`AGENT_MAX_ATTEMPTS`, and uploads a structured
`agent_response_invalid_schema` failure when retries are exhausted. Provider keys
stay on the collector machine unless a later approved backend issue changes that
boundary. Provider secrets must never be uploaded as collector payload data.

## Runtime Flow

### Wechat2RSS Scheduled Or Manual Run

1. Operator starts Docker Desktop and the local Wechat2RSS service.
2. Operator verifies Wechat2RSS login/source health with `smoke:wechat2rss`.
3. Operator or cron triggers the Wechat2RSS collector once.
4. The collector fetches subscribed official-account articles, builds snapshots,
   prepares evidence, calls the LLM extractor when configured, and uploads
   normalized payloads through the collector API.
5. Vercel validates uploads, stores state in Supabase, computes dedupe and
   publication state, and exposes reviewable state in admin.
6. Admin reviews exceptions, missing information, duplicates, and blockers.

### Curated Production Seed Run

1. Operator approves a production seed import in the current conversation.
2. The seed command reads `tests/seed-corpus/production-seed-manifest.json`.
3. The command prints target environment and planned writes, then runs the
   approved import through the same backend ingest, dedupe, storage, publication,
   and usage paths.
4. Operator validates the public catalog, admin draft queue, evidence display,
   source URLs, dedupe behavior, and usage dashboard.

## Expected Health Checks

Implementation should provide health checks that can be used manually and by smoke tests:

- app/API health endpoint returns build and environment summary without secrets
- database health endpoint confirms server-side Supabase/Postgres connectivity
- collector authenticated ping confirms `COLLECTOR_API_KEY` and `COLLECTOR_ID`
- Wechat2RSS smoke confirms local source service and login health when
  `.env.collector` is configured
- admin portal shows source run state, result links, and failure reason

## End-To-End Smoke Test

A complete MVP deployment is considered runnable when this scenario passes:

1. Production Vercel deployment is live.
2. Supabase migrations have been applied.
3. Vercel production environment has required app, admin, collector, and Supabase variables.
4. The operator Mac has the repository cloned, dependencies installed, Docker
   Desktop running, and Wechat2RSS configured.
5. Collector `.env.collector` has `APP_BASE_URL`, `COLLECTOR_BASE_URL`,
   `COLLECTOR_API_KEY`, `COLLECTOR_ID`, Wechat2RSS settings, and LLM provider
   settings when extraction is enabled.
6. `pnpm smoke:wechat2rss --env-file .env.collector` passes.
7. A guarded collector or production seed run uploads at least one source run and
   either event candidates or structured excluded/failure records.
8. Admin portal displays review, publishable, blocked, excluded, or failed state
   with clear reasons.
9. Public pages show only canonical public events and hide non-public/news cases.
10. Expired events are not shown in the default public upcoming list unless the
    product intentionally exposes historical browsing.

## Failure And Recovery Requirements

Implementation should make these failures visible and recoverable:

- Missing Vercel env var: fail deployment checks or health checks with variable name, never with secret value.
- Invalid collector token: return `401` and record no job mutation.
- Missing `X-Collector-Id`: return `400` or `401` before job mutation.
- Collector offline: source runs do not advance and source health remains
  visible to admin.
- Agent config missing: local run fails with `agent_config_missing` and uploads or displays a structured failure when possible.
- Captcha/login/fetch block: collector reports `captcha_required`, `login_required`, or `fetch_blocked`.
- Supabase write failure: backend returns a structured error and logs server-side details through Vercel logs.
- Partial extraction: backend stores available evidence and routes result to review or missing-information state.

## Implementation Slices

Future implementation should keep slices independently testable:

### Slice 1: Environment Inventory

Add a script or command that checks required environment variables by runtime target:

- Vercel production
- Vercel preview
- local development
- collector machine

The command must print missing variable names without printing values.

### Slice 2: Vercel Bootstrap Documentation Or Script

Document or implement the Vercel CLI flow for linking the project, listing env vars, adding missing vars, and pulling `.env.local`.

The first implementation may be documentation-only. A later script may wrap CLI checks but should not echo secret values.

### Slice 3: Supabase Bootstrap

Add schema migration commands and validation once the database schema lands.

Expected command shape:

```bash
pnpm run db:migrate
pnpm run db:check
```

### Slice 4: Collector Bootstrap

Add collector startup commands.

Expected command shape:

```bash
pnpm run collector:dev
pnpm run collector
pnpm run collector:console
```

The current local console command uses Vercel polling and JSON local queue.
Use `LOCAL_COLLECTOR_PROCESSOR=fixture` for deterministic API connectivity
checks, or `LOCAL_COLLECTOR_PROCESSOR=agent` for real provider extraction:

```bash
pnpm collector:bootstrap-env --env-file .env.local --collector-host 192.168.0.16 --output .env
pnpm env:check --target collector --env-file .env
pnpm collector:console --env-file .env
pnpm collector:fixture --env-file .env --seed-url "https://mp.weixin.qq.com/s/example"
pnpm collector:fixture --env-file .env --claim-once --fixture ready-event
```

### Slice 5: End-To-End Smoke Test

Before running a write path, use the read-only admin smoke to verify deployment
reachability, admin auth, Supabase-backed admin list queries, and JSON error
shape:

```bash
pnpm smoke:admin-readonly --env-file .env.local
```

If the browser reaches Vercel but command-line requests time out, configure the
project-local smoke proxy variables in `.env.local`:

```bash
LOCAL_TEST_HTTP_PROXY=http://127.0.0.1:7897
LOCAL_TEST_HTTPS_PROXY=http://127.0.0.1:7897
```

These variables are not Vercel runtime env vars and should not be required by
the app itself.

Add a smoke test or checklist command that proves:

- admin can create a collector job
- collector can claim and heartbeat
- collector can upload a controlled fixture result
- admin can see the resulting review state

The current fixture smoke command covers the deterministic path through publish:

```bash
pnpm smoke:e2e-fixture --env-file .env.local --seed-url "https://mp.weixin.qq.com/s/example"
```

Run it from a machine or network that can resolve and reach the configured
`APP_BASE_URL`. The command uses the same admin and collector API boundaries as
the deployed app, publishes the fixture draft, and verifies the resulting public
event detail page contains the published title.

Fixture and mock runs are allowed for deployment smoke tests, but they must stay
identifiable before public launch. Fixture collector outputs should keep
diagnostics or titles that include `fixture`, and operators should remove those
drafts/events from Supabase after validation if they were created against a
shared or production project. A later cleanup script can automate deletion by
matching fixture diagnostics, fixture source URLs, or deterministic fixture
titles; until then, run fixture smoke tests only against disposable data or
manually delete generated fixture drafts and canonical events before launch.

After Wechat2RSS, collector, and extractor credentials are configured, run the
read-only Wechat2RSS smoke and then the approved live collector or seed command:

```bash
pnpm smoke:wechat2rss --env-file .env.collector
pnpm collector:wechat2rss:once --env-file .env.collector --extract
```

The collector command uploads through the configured collector API. Treat it as
production-mutating when `COLLECTOR_BASE_URL` points at a deployed app backed by
production Supabase.

### Slice 6: Operational Handoff

Add an operator runbook after implementation exists. It should cover start, stop, logs, token rotation, collector machine replacement, failed-job retry, and Vercel deployment rollback.

## Acceptance Criteria

This spec is complete when:

- it defines Vercel-side and collector-machine responsibilities separately
- it names the environment variables required for each runtime target
- it documents how Vercel CLI should be used to add and inspect variables
- it explains how a clone on the operator Mac should be configured and started
  after implementation lands
- it defines an end-to-end smoke test from admin seed URL to public event display
- it keeps collector outputs untrusted and routes all publication decisions through the backend/admin boundary
- it links to the V3 architecture and testing specs

## Related Documents

- [Collector Agent Ingestion Spec](collector-agent-ingestion.md)
- [Local Collector Console And Job Queue Spec](local-collector-console.md)
- [Admin Portal Requirements](admin-portal-requirements.md)
- [Technical Baseline](technical-baseline.md)
- [Security And Permissions](security-and-permissions.md)
- [Bootstrap Quickstart](quickstart.md)
