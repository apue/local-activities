# Smoke Tests

## Purpose

Smoke tests prove that the deployed app boundary is reachable before deeper
collector or agent validation starts. Keep these commands operator-facing and
small enough to run after changing Vercel env vars or merging deployment fixes.

## Local Proxy

Some developer machines can reach Vercel from the browser through a local proxy
while command-line tools time out on direct connections. Configure project-local
smoke proxy variables in `.env.local`:

```bash
LOCAL_TEST_HTTP_PROXY=http://127.0.0.1:7897
LOCAL_TEST_HTTPS_PROXY=http://127.0.0.1:7897
```

These variables are only for local smoke scripts. The Next.js app, Vercel
runtime, collector runtime, and Agent API do not read them.

## Available Cases

### Read-Only Admin Smoke

Use this after deployment, admin-token changes, Supabase env changes, or admin
API error handling changes:

```bash
pnpm smoke:admin-readonly --env-file .env.local
```

The command checks:

- public homepage returns `200`
- `/admin` returns `200`
- `/api/admin/collector-jobs` returns `200` JSON with a `jobs` array
- `/api/admin/event-drafts` returns `200` JSON with a `drafts` array
- the same admin API with an invalid token returns `401` JSON

This command is read-only and should be safe against production. It does not
create collector jobs, drafts, or public events.

### Fixture End-To-End Smoke

Use this only when it is acceptable to create disposable fixture data:

```bash
pnpm smoke:e2e-fixture --env-file .env.local --seed-url "https://mp.weixin.qq.com/s/example"
```

The command covers:

- admin job creation
- collector claim and heartbeat
- deterministic fixture upload
- admin publish
- public event detail check

Fixture smoke writes data. Use disposable environments or manually clean up
generated fixture drafts/events before launch.

## Not Yet Covered

These cases are still useful but are not automated in the current smoke layer:

- Browser-level admin portal interaction: fill token, click Load state, verify
  rendered success/error message.
- Vercel Sandbox Agent job smoke using real `AGENT_API_BASE_URL`,
  `AGENT_API_KEY`, and `VERCEL_SANDBOX_API_KEY`.
- Local collector fallback after a forced fallback-eligible Sandbox failure.
- Health endpoint expected-success smoke after all production env vars are
  configured.
- Visual/mobile smoke for the public list/detail pages and admin dashboard.
