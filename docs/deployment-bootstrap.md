# Deployment Bootstrap Spec

## Purpose

This document defines the MVP bootstrap target for running the product end to end:

```text
GitHub repository
-> Vercel web app and API
-> Supabase Postgres
-> home-machine collector at 192.168.0.16
-> external LLM or agent API used only by the collector runtime
```

The intended reader is a future coding agent implementing deployment scripts, environment validation, local collector startup, or end-to-end smoke tests. Treat this as an execution spec. It defines the required operating shape, secret boundaries, commands that implementation should support, and acceptance criteria.

## Goals

- A fresh clone can be bootstrapped into a working Vercel app/API deployment.
- Required Vercel environment variables can be added or checked with Vercel CLI.
- A second machine, initially `192.168.0.16`, can clone the same repository, configure local collector secrets, and run the collector without direct Supabase access.
- The local collector can poll Vercel, claim jobs, call a local/external LLM or agent API, upload normalized results, and surface reviewable state in the admin portal.
- The backend remains the authority for validation, deduplication, review state, and publication.

## Non-Goals

- Do not make Vercel run unbounded browser automation.
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
- collector job claim, heartbeat, and report endpoints
- lightweight health endpoints
- optional Vercel Cron or Workflow entry points after concrete implementation issues adopt them

Vercel does not host:

- persistent browser profiles
- long-running Playwright sessions
- the external LLM or agent runtime for browser-heavy extraction

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

### Home Collector Machine

The first deployment target is a machine reachable by the operator as `192.168.0.16` on the private network.

The collector machine runs:

- the same repository clone
- a local collector service
- a local operator console, preferably bound to `127.0.0.1` unless LAN access is explicitly needed
- browser automation with a persistent profile
- local queue storage
- Vercel polling client
- LLM or agent API client

The collector authenticates to Vercel using `COLLECTOR_API_KEY` and identifies itself with `COLLECTOR_ID`. It does not need inbound access from Vercel.

### External LLM Or Agent API

The LLM or agent API is a collector-side dependency for classification, OCR/vision interpretation, and structured extraction.

Rules:

- The collector converts provider responses into the normalized collector contracts before upload.
- Vercel APIs must not depend on provider-specific response shapes.
- Provider API keys can live only on the collector machine unless a later issue moves a bounded extraction step into Vercel.
- The agent API must not receive `COLLECTOR_API_KEY`, Supabase secrets, Vercel tokens, or admin tokens.

## Prerequisites

Both the developer machine and collector machine should support:

- Node.js 24 LTS
- pnpm 11
- Git
- Vercel CLI for the machine that manages Vercel project configuration
- Supabase CLI for schema and local database work
- Playwright browser dependencies after the collector implementation lands

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

NEXT_PUBLIC_AMAP_JS_API_KEY
AMAP_WEB_SERVICE_API_KEY

VERCEL_WEB_ANALYTICS_ENABLED
VERCEL_SPEED_INSIGHTS_ENABLED
OBSERVABILITY_PROVIDER
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

Do not add collector-only LLM keys to Vercel for the MVP unless a later implementation issue explicitly runs extraction inside Vercel.

### Collector Machine Variables

The collector machine needs:

```text
APP_BASE_URL=https://your-vercel-app.example
COLLECTOR_BASE_URL=https://your-vercel-app.example
COLLECTOR_API_KEY=same-long-random-secret-as-vercel
COLLECTOR_ID=home-192-168-0-16
COLLECTOR_INTERVAL_HOURS=4
COLLECTOR_BROWSER_PROFILE_DIR=.collector-profile
LOCAL_COLLECTOR_CONSOLE_TOKEN=optional-local-console-token

TEXT_INFERENCE_PROVIDER=openai-compatible
TEXT_INFERENCE_API_BASE_URL=https://your-agent-or-llm-api.example/v1
TEXT_INFERENCE_API_KEY=collector-side-provider-secret
TEXT_INFERENCE_MODEL=provider-model-name
TEXT_INFERENCE_ENDPOINT_STYLE=chat-completions
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
vercel env add NEXT_PUBLIC_AMAP_JS_API_KEY production
vercel env add AMAP_WEB_SERVICE_API_KEY production
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
vercel env add NEXT_PUBLIC_AMAP_JS_API_KEY preview
vercel env add AMAP_WEB_SERVICE_API_KEY preview
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
cp .env.example .env
```

The operator then edits `.env` with collector-machine values, especially:

- `APP_BASE_URL`
- `COLLECTOR_BASE_URL`
- `COLLECTOR_API_KEY`
- `COLLECTOR_ID`
- `COLLECTOR_BROWSER_PROFILE_DIR`
- `TEXT_INFERENCE_API_BASE_URL`
- `TEXT_INFERENCE_API_KEY`
- `TEXT_INFERENCE_MODEL`

Expected future collector commands:

```bash
pnpm run collector:install-browsers
pnpm run collector:dev
pnpm run collector
```

Expected future local console command:

```bash
pnpm run collector:console
```

The implementation may choose one long-running command that starts both the worker and console, but it must document the behavior clearly.

The local console should default to localhost. If exposed on the LAN for convenience, it should require `LOCAL_COLLECTOR_CONSOLE_TOKEN`.

## Runtime Flow

### Admin-Triggered Job

1. Admin opens the Vercel admin portal.
2. Admin pastes a source or article URL.
3. Backend validates the URL and creates a queued collector job.
4. Collector polls Vercel and claims the job.
5. Collector sends heartbeats while running.
6. Collector captures the page, classifies the capture mode, calls the LLM or agent API if needed, and uploads normalized results.
7. Vercel validates uploads, stores state in Supabase, computes review state, and links results to the job.
8. Admin reviews the draft, failure, or missing-information state.

### Local Console Job

1. Operator opens the collector console on the home machine.
2. Operator pastes a URL.
3. Local service creates a local queued run.
4. Local worker runs the same capture, extraction, and upload pipeline used for Vercel-claimed jobs.
5. Vercel stores and routes the result through the same review queues.

## Expected Health Checks

Implementation should provide health checks that can be used manually and by smoke tests:

- app/API health endpoint returns build and environment summary without secrets
- database health endpoint confirms server-side Supabase/Postgres connectivity
- collector authenticated ping confirms `COLLECTOR_API_KEY` and `COLLECTOR_ID`
- collector job claim endpoint returns either a claimed job or a no-job response
- local collector health endpoint reports queue depth, active job, last poll, and last upload result
- admin portal shows job state, heartbeat age, result links, and failure reason

## End-To-End Smoke Test

A complete MVP deployment is considered runnable when this scenario passes:

1. Production Vercel deployment is live.
2. Supabase migrations have been applied.
3. Vercel production environment has required app, admin, collector, and Supabase variables.
4. The collector machine at `192.168.0.16` has the repository cloned and dependencies installed.
5. Collector `.env` has `APP_BASE_URL`, `COLLECTOR_API_KEY`, `COLLECTOR_ID`, and LLM or agent API settings.
6. Admin creates a collector job from a known test URL.
7. Collector claims the job within the configured polling window.
8. Collector heartbeats are visible in admin job state.
9. Collector uploads at least one source run and either an event draft or a structured failure.
10. Admin portal displays the result as `ready_for_review`, `needs_review`, `needs_info`, `failed`, or `not_activity`.
11. If a draft is publishable, admin can publish it and the public event page displays it.
12. Expired events are not shown in the default public upcoming list.

## Failure And Recovery Requirements

Implementation should make these failures visible and recoverable:

- Missing Vercel env var: fail deployment checks or health checks with variable name, never with secret value.
- Invalid collector token: return `401` and record no job mutation.
- Missing `X-Collector-Id`: return `400` or `401` before job mutation.
- Collector offline: queued jobs remain visible with no heartbeat.
- Lease expired: job becomes claimable again according to the job queue spec.
- LLM config missing: local run fails with `agent_config_missing` and uploads or displays a structured failure when possible.
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

Add collector install and startup commands.

Expected command shape:

```bash
pnpm run collector:install-browsers
pnpm run collector:dev
pnpm run collector
pnpm run collector:console
```

### Slice 5: End-To-End Smoke Test

Add a smoke test or checklist command that proves:

- admin can create a collector job
- collector can claim and heartbeat
- collector can upload a controlled fixture result
- admin can see the resulting review state

### Slice 6: Operational Handoff

Add an operator runbook after implementation exists. It should cover start, stop, logs, token rotation, collector machine replacement, failed-job retry, and Vercel deployment rollback.

## Acceptance Criteria

This spec is complete when:

- it defines Vercel-side and collector-machine responsibilities separately
- it names the environment variables required for each runtime target
- it documents how Vercel CLI should be used to add and inspect variables
- it explains how a clone on `192.168.0.16` should be configured and started after implementation lands
- it defines an end-to-end smoke test from admin seed URL to public event display
- it keeps collector outputs untrusted and routes all publication decisions through the backend/admin boundary
- it links to the collector ingestion and local collector queue specs

## Related Documents

- [Collector Agent Ingestion Spec](collector-agent-ingestion.md)
- [Local Collector Console And Job Queue Spec](local-collector-console.md)
- [Admin Portal Requirements](admin-portal-requirements.md)
- [Technical Baseline](technical-baseline.md)
- [Security And Permissions](security-and-permissions.md)
- [Bootstrap Quickstart](quickstart.md)
