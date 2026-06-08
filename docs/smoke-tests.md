# Smoke Tests

## Purpose

Smoke tests prove key deployed and local runtime boundaries are reachable before
deeper validation starts.

## Local Proxy

Some developer machines can reach Vercel from the browser through a local proxy
while command-line tools time out on direct connections. Configure project-local
smoke proxy variables in `.env.local`:

```bash
LOCAL_TEST_HTTP_PROXY=http://127.0.0.1:7897
LOCAL_TEST_HTTPS_PROXY=http://127.0.0.1:7897
```

These variables are read only by local smoke scripts.

## Read-Only Admin Smoke

```bash
pnpm smoke:admin-readonly --env-file .env.local
```

This checks public/admin reachability and authenticated read-only admin APIs. It
must not create drafts, events, bundles, or usage rows.

## Public Catalog Smoke

```bash
pnpm smoke:public-catalog --env-file .env.local
```

This checks public pages and guards against fixture/test copy, fake source URLs,
and remote WeChat image URLs appearing in public output.

## Wechat2RSS Source Smoke

```bash
pnpm smoke:wechat2rss --env-file .env.collector
```

This is read-only against the local Wechat2RSS service. It verifies service
reachability, login/source health, and response shape without uploading bundles
or mutating production data.

## Supabase Edge Function Smoke

After `analyze-article-bundle` exists:

```bash
supabase functions serve analyze-article-bundle --env-file .env.local
```

Then run the project fixture analysis smoke added by the Edge Function issue.
The default smoke must use a mocked provider. Live provider smoke requires
configured secrets and budget approval.

## Capture Worker Dry Run

Run the capture worker dry-run against local Wechat2RSS input:

```bash
pnpm capture:wechat2rss:once -- --dry-run --env-file .env.collector
```

The dry run prints discovered bundle metadata and intended Storage paths without
uploading bundle files, invoking analysis, or writing production event rows.
Use `--apply` only after `analyze-article-bundle` exists and the target has been
approved for bundle uploads.

## Hosted Data Cleanup

Use audit before cleanup:

```bash
pnpm data:audit -- --env-file .env.local --limit 1000
```

Destructive cleanup must print counts and a report path. The reset request
approves cleanup, but the command must still log exactly what was removed.

## Final Production Acceptance

Final acceptance uses a small approved live path:

```text
Wechat2RSS article
-> capture bundle
-> Supabase Storage
-> analyze-article-bundle
-> ledger/draft/event/evidence/usage
-> admin/public verification
```

Stop if Wechat2RSS login, captcha, or platform-risk intervention is required.
