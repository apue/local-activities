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
runtime, collector runtime, and provider APIs do not read them.

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
- `/api/admin/llm-usage?range=today`, `7d`, and `all` return usage JSON
- the same admin API with an invalid token returns `401` JSON

This command is read-only and should be safe against production. It does not
create collector jobs, drafts, or public events.

### Public Catalog Quality Smoke

Use this after live extraction, admin publishing, fixture cleanup, or public UI
changes:

```bash
pnpm smoke:public-catalog --env-file .env.local
```

The command is read-only. It checks:

- public homepage returns `200`
- public event detail links from the homepage return `200`
- public pages do not contain fixture copy such as `Fixture case`,
  `*-fixture`, or `fixture-assets/`
- public pages do not contain fake `example.com` source/register URLs
- public pages do not render WeChat source-site image URLs such as
  `mp.weixin.qq.com` or `mmbiz.qpic.cn`
- public pages do not show `Organizer TBA`, which is too weak for published
  high-confidence events when organizer/source evidence exists

Expected live verification flow:

1. Run one real extraction smoke or collector job against a real source URL.
2. Review drafts in `/admin`; publish only real public events.
3. Run `pnpm smoke:public-catalog --env-file .env.local`.
4. Open the public homepage and one detail page on mobile width. Confirm the
   source URL is the original official source, posters/QRs render when present,
   and no test fixture copy appears.

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

Do not use fixture smoke or fixture upload as a substitute for production
content ingestion. Fixture rows are test artifacts even when they are derived
from official source posts. They may include synthetic source URLs, placeholder
asset paths, and manual expected decisions. Real production catalog entries must
come from live extraction of real source URLs.

### Real Agent Job Smoke

Use this after Vercel production has real Sandbox and OpenAI provider settings:

```bash
pnpm smoke:agent-job --env-file .env.local --seed-url "https://mp.weixin.qq.com/s/example"
```

The command creates a real admin collector job with
`preferredRunner=vercel_sandbox`, polls admin job state by `jobId`, and verifies
reported IDs in Supabase. The Sandbox runner opens the seed URL in a browser,
passes the page observation to the configured provider, uploads normalized
collector results, auto-publishes when minimum public fields are present, and
verifies the public list/detail pages.

The command treats these outcomes as explainable smoke results:

- a draft is created and auto-published as `approved`
- a draft is created and remains reviewable, such as `ready_for_review`,
  `needs_review`, `needs_info`, or `possible_duplicate`
- the job reports `not_activity`
- the job uploads a structured collector failure with failure IDs
- the job completes or partially completes with a terminal state

The command fails when:

- job creation fails or returns non-JSON
- the job is not visible in admin polling
- the job remains non-terminal beyond the polling window
- the job reports IDs that are missing from Supabase
- the job fails without structured failure details

Browser runner benchmark:

```bash
node scripts/browser-runner-benchmark.mjs \
  --seed-url https://mp.weixin.qq.com/s/r14ZCPdt5E56TFXzUPJ5Dg
```

The benchmark uses the same page-observation code as the Sandbox agent and
prints comparable timing diagnostics for `playwright` and `agent_browser`.
Local timing is useful for regressions, but the production runner should be
chosen from Sandbox job diagnostics because Sandbox setup time counts against
the monthly quota.

Optional polling controls:

```bash
AGENT_JOB_SMOKE_MAX_POLLS=40
AGENT_JOB_SMOKE_POLL_INTERVAL_MS=15000
```

Required Vercel provider settings for live extraction:

```bash
AGENT_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=...
OPENAI_BASE_URL=https://api.openai.com/v1 # optional
```

## Not Yet Covered

These cases are still useful but are not automated in the current smoke layer:

- Browser-level admin portal interaction: fill token, click Load state, verify
  rendered success/error message.
- Local collector fallback after a forced fallback-eligible Sandbox failure.
- Health endpoint expected-success smoke after all production env vars are
  configured.
- Visual/mobile smoke for the public list/detail pages and admin dashboard.
