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

This checks public pages and guards against raw WeChat image URLs, localhost
image URLs, and other non-product evidence URLs appearing in public output.

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

## V5 Private Corpus / Live Model Smoke

The committed regression corpus remains the default validation path and must not
call live providers:

```bash
pnpm pipeline:v5:eval -- --corpus-dir tests/regression-corpus --all --store memory
```

Use a private local corpus directory for live model smoke checks, especially
when validating poster, QR, or long-image behavior. The private corpus must use
the same case shape as `tests/regression-corpus`, but it must not be committed.

Live evaluation is fail-closed. It requires all of:

- `--variant live-configured`
- `--allow-live`
- `--max-cost-cny <positive number>`
- provider config from `--env-file`

The live provider config can use either V5-specific variables or the Edge
Function analysis variables:

```text
V5_LIVE_BASE_URL      or ANALYSIS_LLM_BASE_URL
V5_LIVE_API_KEY       or ANALYSIS_LLM_API_KEY
V5_LIVE_MODEL         or ANALYSIS_LLM_MODEL
V5_LIVE_PROVIDER      or ANALYSIS_LLM_PROVIDER
V5_LIVE_MAX_TOKENS    or ANALYSIS_LLM_MAX_OUTPUT_TOKENS
V5_LIVE_ENABLE_THINKING
```

Example:

```bash
pnpm pipeline:v5:eval -- \
  --corpus-dir /path/to/private-v5-corpus \
  --case <case-id> \
  --store local \
  --variant live-configured \
  --allow-live \
  --max-cost-cny 10 \
  --env-file .env.local
```

For SiliconFlow Qwen reasoning models that return `reasoning_content`, set
`V5_LIVE_ENABLE_THINKING=false` so the provider returns the extraction JSON in
`message.content`. Use `V5_LIVE_MAX_TOKENS` to keep enough output budget for
Full Extract and Editor Pass responses.

This smoke writes only evaluation artifacts. It must not write production drafts
or canonical events.

## Capture Worker Dry Run

Run the capture worker dry-run against local Wechat2RSS input:

```bash
pnpm capture:wechat2rss:once -- --dry-run --env-file .env.collector
```

The dry run prints discovered bundle metadata and intended Storage paths without
uploading bundle files, invoking analysis, or writing production event rows.
Use `--limit <positive integer>` to query the configured lookback window but
process only the first N discovered articles, for example:

```bash
pnpm capture:wechat2rss:once -- --dry-run --env-file .env.collector --limit 3
```

Use `--apply` only after `analyze-article-bundle` exists and the target has been
approved for bundle uploads. For bounded production acceptance, combine `--apply`
with a small `--limit`.

When running the Edge Function locally for acceptance, set
`ANALYZE_FUNCTION_URL` to that local function URL and optionally set
`ANALYZE_FUNCTION_TIMEOUT_MS` for slow live model calls. Use `--proxy-url` only
for outbound Supabase/Vercel/LLM calls that need the local proxy; the worker
does not proxy localhost function URLs.

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
