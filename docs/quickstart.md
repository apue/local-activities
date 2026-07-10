# Bootstrap Quickstart

Use this quickstart for local development of the reset architecture.

## Prerequisites

- Node.js 24 LTS
- pnpm 11
- Supabase CLI
- Vercel CLI
- Docker Desktop when running local Wechat2RSS
- direnv if you use directory-local env loading

```bash
brew install node@24 pnpm supabase vercel-cli direnv
export PATH="$(brew --prefix node@24)/bin:$PATH"
node --version
pnpm --version
```

The repository's `.nvmrc` also selects Node.js 24 for developers using nvm.
Node.js 24.x and pnpm 11.x are required; Node.js 26 is intentionally deferred
until Vercel supports it.

## Local Environment

```bash
cp .env.example .env.local
direnv allow
```

Fill real secrets only on your machine. Do not commit secrets.

Important groups:

- app/admin: `ADMIN_ACCESS_TOKEN`, `INTERNAL_API_SECRET`
- Supabase app keys: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
- capture worker auth: `COLLECTOR_EDGE_TOKEN`, `COLLECTOR_ID`
- Supabase Storage buckets: `ARTICLE_BUNDLES_BUCKET`,
  `EVENT_EVIDENCE_ASSETS_BUCKET`, `EVAL_ARTIFACTS_BUCKET`
- Supabase Edge Function LLM secrets: `ANALYSIS_LLM_*`
- Wechat2RSS worker input: `WECHAT2RSS_BASE_URL`, `WECHAT2RSS_TOKEN`

Production analysis provider keys belong in Supabase Edge Function secrets.

## App Development

Install dependencies:

```bash
pnpm install --frozen-lockfile
```

Run the web app:

```bash
pnpm dev
```

Run routine checks:

```bash
pnpm test
pnpm typecheck
pnpm typecheck:ts6
pnpm build
pnpm env:check --env-file .env.local --target local-app
```

`pnpm typecheck` runs the TypeScript 7 primary compiler. The temporary
`pnpm typecheck:ts6` command verifies compatibility with the TypeScript 6 API
that Next.js 16.2.6 still loads during `next build`. `pnpm build` first reruns
the TS7 gate, then runs the Next.js build and its compatibility validation.

## Supabase Development

Check project linkage and function state:

```bash
supabase status
supabase migration list
supabase functions list
```

Serve Edge Functions locally after they exist:

```bash
supabase functions serve analyze-article-bundle --env-file .env.local
```

Deploy functions only through the GitHub workflow and after local validation.

## Wechat2RSS Smoke

After the local Wechat2RSS Docker service is running and configured:

```bash
pnpm smoke:wechat2rss --env-file .env.collector
```

This smoke is read-only. It does not upload bundles or create events.

## Capture Worker Dry Run

After Wechat2RSS smoke passes, build article bundles without writing Storage or
triggering analysis:

```bash
pnpm capture:wechat2rss:once -- --dry-run --env-file .env.collector
```

Use `--apply` only when the Supabase Edge Function is available and the target
environment is approved for bundle uploads.

## Active Architecture

The production path is:

```text
external capture worker
-> Supabase Storage article bundle
-> Supabase Edge Function analysis
-> Supabase DB
-> Vercel public/admin UI
```

Do not use removed local extractor or legacy write commands as production paths.

See:

- [Event Pipeline Architecture](event-pipeline-architecture.md)
- [Smoke Tests](smoke-tests.md)
