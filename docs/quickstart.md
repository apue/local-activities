# Bootstrap Quickstart

Use this quickstart for local development and the current Mac-local
Wechat2RSS collector workflow.

## Prerequisites

- Node.js 24 LTS.
- pnpm 11.
- Vercel CLI.
- Supabase CLI.
- agent-browser CLI.
- direnv.

If a common local CLI is missing on macOS, prefer installing it with Homebrew first. Keep global npm installs for tools that are not packaged well in Homebrew or that the project explicitly wants from npm:

```bash
brew install node@24 pnpm vercel-cli supabase/tap/supabase agent-browser direnv
```

## Local Environment

Start from the checked-in safe template:

```bash
cp .env.example .env.local
direnv allow
```

Fill `.env.local` with real values only on your machine. Do not commit secrets.

For the full Vercel plus home-machine collector setup target, see [Deployment Bootstrap Spec](deployment-bootstrap.md). This quickstart is for local scaffolding; the deployment bootstrap spec is the source of truth for production Vercel env setup and the `192.168.0.16` collector machine.

Minimum groups to prepare:

- app/admin secrets: `ADMIN_ACCESS_TOKEN`, `COLLECTOR_API_KEY`, `INTERNAL_API_SECRET`
- Supabase/Postgres: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`
- runtime public assets: `BLOB_READ_WRITE_TOKEN` when uploading event posters to Vercel Blob
- Supabase CLI/local compatibility: `SUPA_API_URL`, `SUPA_DB_URL`, `SUPA_ANON_KEY`, `SUPA_SERVICE_KEY`
- map/geocoding: `NEXT_PUBLIC_AMAP_JS_API_KEY`, `AMAP_WEB_SERVICE_API_KEY`
- LLM extraction provider: `AGENT_PROVIDER`, `OPENAI_API_KEY`,
  `OPENAI_MODEL`, optional `OPENAI_BASE_URL`
- search/crawling: `EXA_API_KEY`, `SERPER_API_KEY`, `FIRECRAWL_API_KEY`
- Vercel: `VERCEL_PROJECT_ID`, `VERCEL_ORG_ID`, `VERCEL_TOKEN`, `CRON_SECRET`

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

Use [Deployment Bootstrap Spec](deployment-bootstrap.md) when adding production or preview variables with `vercel env add`; it separates Vercel-side secrets from collector-machine-only LLM and agent secrets.

For local development, prefer the framework dev command after env is loaded:

```bash
pnpm dev
```

Use Vercel CLI for preview deployment checks when needed:

```bash
vercel deploy
vercel logs --deployment <preview-deployment-id> --level error
```

For deployed app smoke checks, see [Smoke Tests](smoke-tests.md). If command-line
requests to Vercel time out while the browser works through a local proxy, set
`LOCAL_TEST_HTTP_PROXY` and `LOCAL_TEST_HTTPS_PROXY` in `.env.local`; these
variables are only read by local smoke scripts.

For non-interactive CLI use, set `VERCEL_TOKEN` in `.env.local` or the calling shell. Prefer the environment variable over passing `--token` inline so the token is less likely to appear in logs.

## GitHub And Vercel Preview Deployments

Manually connect the GitHub repository to the Vercel project in the Vercel dashboard so each PR gets an automatic preview deployment.

Expected shape:

- the project repository is connected to Vercel
- the production branch matches the repository's default release branch
- feature branches and PRs create Vercel preview deployments
- Vercel preview environment variables filled from the same groups as `.env.example`

Use the Vercel dashboard for project-level Git binding because it is easier to review installation permissions, production branch settings, and preview deployment behavior there than from a one-off CLI command.

## Vercel Workflow

Vercel Workflow is the likely first durable serverless execution option for bounded multi-step backend work. Candidate jobs include extraction orchestration, retryable provider calls, source-run follow-up, and admin review-state transitions.

Keep these boundaries:

- Vercel Cron can trigger lightweight callbacks or kick off workflow runs.
- Workflow can coordinate resumable backend steps and preserve run state.
- Browser-heavy or WeChat-account-bound collection belongs in the Mac-local
  collector runtime for this MVP slice.
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

## Local Capture Commands

The current production source path is Mac-local Wechat2RSS:

```bash
pnpm smoke:wechat2rss --env-file .env.collector
pnpm collector:wechat2rss:once --env-file .env.collector --extract
```

`smoke:wechat2rss` is read-only against the local Wechat2RSS service.
`collector:wechat2rss:once --extract` uploads through the configured collector
API and is production-mutating when `COLLECTOR_BASE_URL` points at the deployed
app backed by production Supabase.

The collector must report structured failures such as `captcha_required`,
`login_required`, or `fetch_blocked` instead of bypassing platform protections.

For Event Pipeline V4 architecture and module boundaries, see
[Event Pipeline Architecture](event-pipeline-architecture.md).

Current project skills:

- `frontend-design`: Anthropic frontend design skill.
- `agent-browser`: agent-browser CLI skill for browser automation and verification workflows.
- `firecrawl`: Firecrawl CLI skill for search, scrape, crawl, map, and browser-style web operations.
- `exa-search`: Exa search skill discovered through `find-skills`.
- `vercel-nextjs`, `vercel-cli`, `vercel-env-vars`, `vercel-workflow`, `vercel-observability`: Vercel/Next.js implementation and operations skills.
- `vercel-deployment`, `vercel-react-best-practices`: Vercel deployment and React/Next.js performance skills.
- `supabase-postgres-best-practices`: Supabase/Postgres schema and query guidance.
- `web-design-guidelines`: UI review guidance.

Keep user-level secrets outside the repository.
