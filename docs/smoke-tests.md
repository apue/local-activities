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

1. Run one live Wechat2RSS collector or approved production seed import against
   real source material.
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

### Wechat2RSS Source Smoke

Use this after the local Wechat2RSS Docker service is running and `.env.collector`
has Wechat2RSS settings:

```bash
pnpm smoke:wechat2rss --env-file .env.collector
```

The command is read-only against the local Wechat2RSS service. It should verify
service reachability, login/source health, and response shape without uploading
drafts or public events.

### Live Collector Upload Smoke

Use this only when production writes are acceptable and explicitly approved:

```bash
pnpm collector:wechat2rss:once --env-file .env.collector --extract
```

The command uploads through the configured collector API. Treat it as
production-mutating when `COLLECTOR_BASE_URL` points at a deployed app backed by
production Supabase.

The command treats these outcomes as explainable smoke results:

- a draft is created and auto-published as `approved`
- a draft is created and remains reviewable, such as `ready_for_review`,
  `needs_review`, `needs_info`, or `possible_duplicate`
- the job reports `not_activity`
- the job uploads a structured collector failure with failure IDs
- the job completes or partially completes with a terminal state

The command fails when:

- Wechat2RSS source health is unavailable without a structured reason
- collector upload fails or returns non-JSON
- uploaded result IDs are not visible through admin/read APIs
- a failure is reported without structured failure details

### Production Seed Acceptance

Use this as the final product acceptance path after module, admin, dedupe,
storage, usage, and cleanup work is complete:

```bash
pnpm seed:production-events --env-file .env.local --manifest tests/seed-corpus/production-seed-manifest.json
```

This is production-mutating and requires explicit operator approval in the
current conversation. It should produce a batch or run id and an import report.
The operator validates public pages, admin drafts, source URLs, evidence,
dedupe, non-public exclusions, and usage totals.

### Historical Browser Runner Benchmark

This benchmark is historical for the V2 sandbox/agent path and is not part of
Event Pipeline V3 acceptance:

```bash
node scripts/browser-runner-benchmark.mjs \
  --seed-url https://mp.weixin.qq.com/s/r14ZCPdt5E56TFXzUPJ5Dg
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
- Health endpoint expected-success smoke after all production env vars are
  configured.
- Visual/mobile smoke for the public list/detail pages and admin dashboard.
