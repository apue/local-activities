# Bootstrap Quickstart

This repository is documentation-first until the app scaffold is approved. Use this quickstart when creating the first implementation PR.

## Prerequisites

- Node.js 24 LTS.
- pnpm 11.
- Vercel CLI.
- Supabase CLI.
- direnv.
- Access to the fork branch intended for the PR, usually `sparticle9:env/agent-stack`.

## Local Environment

Start from the checked-in safe template:

```bash
cp .env.example .env.local
direnv allow
```

Fill `.env.local` with real values only on your machine. Do not commit secrets.

Minimum groups to prepare:

- app/admin secrets: `ADMIN_ACCESS_TOKEN`, `COLLECTOR_API_KEY`, `INTERNAL_API_SECRET`
- Supabase/Postgres: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`
- Supabase CLI/local compatibility: `SUPA_API_URL`, `SUPA_DB_URL`, `SUPA_ANON_KEY`, `SUPA_SERVICE_KEY`
- map/geocoding: `NEXT_PUBLIC_AMAP_JS_API_KEY`, `AMAP_WEB_SERVICE_API_KEY`
- text inference: `TEXT_INFERENCE_API_BASE_URL`, `TEXT_INFERENCE_API_KEY`, `TEXT_INFERENCE_MODEL`
- search/crawling: `EXA_API_KEY`, `SERPER_API_KEY`, `FIRECRAWL_API_KEY`
- Vercel: `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`, `VERCEL_TOKEN`, `CRON_SECRET`

For Supabase Auth, prefer the current hosted API key pair:

- browser/client code: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- server-only admin code: `SUPABASE_SECRET_KEY`

Keep legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in the template for compatibility with older Supabase examples and libraries. Keep `SUPA_*` aliases for scripts that consume `supabase status --output env` from the local CLI stack.

## Scaffold With Next.js

Create the app with pnpm and the App Router defaults. Because this repository already contains project docs and workflow files, use a temporary scaffold directory and copy the generated app files back into the repo in the implementation PR:

```bash
pnpm create next-app@latest local-activities-app
```

Choose TypeScript and App Router. Keep the final app in this repository root unless a later issue explicitly adopts a workspace layout.

After copying the scaffolded app into the repo root, install the planned server and test packages:

```bash
pnpm add hono zod
pnpm add -D vitest
```

Use Hono for API route grouping only where it improves collector/admin API clarity. A typical Next.js App Router mount is:

```ts
// app/api/[[...route]]/route.ts
import { Hono } from "hono";
import { handle } from "hono/vercel";

const app = new Hono().basePath("/api");

app.get("/health", (c) => c.json({ ok: true }));

export const GET = handle(app);
export const POST = handle(app);
```

For tests, keep pure business logic and Hono apps easy to call with Vitest using `app.request()` or Hono's `testClient`.

## Scaffold With Vercel CLI

If the Vercel project already exists, link it from the repo:

```bash
vercel link
vercel env pull .env.local
```

For local development, prefer the framework dev command after env is loaded:

```bash
pnpm dev
```

Use Vercel CLI for preview deployment checks when needed:

```bash
vercel deploy
vercel logs --deployment <preview-deployment-id> --level error
```

For non-interactive CLI use, set `VERCEL_TOKEN` in `.env.local` or the calling shell. Prefer the environment variable over passing `--token` inline so the token is less likely to appear in logs.

## GitHub And Vercel Preview Deployments

Manually connect the GitHub fork/repository to the Vercel project in the Vercel dashboard so each PR gets an automatic preview deployment.

Expected setup:

- Git repository: `sparticle9/local-activities`
- PR target: `apue/local-activities:main`
- work branch: `env/agent-stack` or a smaller feature branch from it
- Vercel production branch: `main`
- Vercel preview environment variables filled from the same groups as `.env.example`

Use the Vercel dashboard for project-level Git binding because it is easier to review installation permissions, production branch settings, and preview deployment behavior there than from a one-off CLI command.

## Vercel Workflow

Vercel Workflow is the likely first durable serverless execution option for bounded multi-step backend work. Candidate jobs include extraction orchestration, retryable provider calls, source-run follow-up, and admin review-state transitions.

Keep these boundaries:

- Vercel Cron can trigger lightweight callbacks or kick off workflow runs.
- Workflow can coordinate resumable backend steps and preserve run state.
- Browser-heavy collection still belongs in a local or VM collector runtime unless a later issue proves a bounded Vercel-native path.
- Do not place unbounded Playwright sessions inside ordinary request/response handlers.

Only enable `VERCEL_WORKFLOW_ENABLED=true` after the first concrete workflow implementation lands.

## Observation

Use Vercel built-in observation for the MVP:

- build logs and runtime logs in the Vercel dashboard
- Vercel Observability for function, edge, middleware, external request, and workflow signals
- Vercel Web Analytics for visitor analytics
- Vercel Speed Insights for real-user web vitals

Do not add Sentry, Datadog, New Relic, or other third-party observability providers unless a later issue explicitly requires one.

## Project Agent Config

The repository includes `.codex/config.toml` with the built-in Context7 MCP endpoint. Use Context7 for current framework and provider docs during implementation planning, especially for Next.js, Vercel, Supabase, Hono, and Vitest details.

Project-level skills live in `.agents/skills`.

Current project skills:

- `frontend-design`: Anthropic frontend design skill.
- `firecrawl`: Firecrawl CLI skill for search, scrape, crawl, map, and browser-style web operations.
- `exa-search`: Exa search skill discovered through `find-skills`.
- `vercel-nextjs`, `vercel-cli`, `vercel-env-vars`, `vercel-workflow`, `vercel-observability`: Vercel/Next.js implementation and operations skills.
- `vercel-deployment`, `vercel-react-best-practices`: Vercel deployment and React/Next.js performance skills.
- `supabase-postgres-best-practices`: Supabase/Postgres schema and query guidance.
- `web-design-guidelines`: UI review guidance.

Keep user-level secrets outside the repository.
