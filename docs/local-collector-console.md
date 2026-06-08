# Local Collector Console And Job Queue Spec

> Historical V2 design. The active event pipeline uses the Mac-local Wechat2RSS
> collector path and the module boundaries in
> [Event Pipeline Architecture](event-pipeline-architecture.md). Do not treat
> this document as the current collector execution contract.

## Purpose

This document defined the earlier MVP design for a home-machine collector
console and a Vercel-backed collector job queue.

The intended reader is a future coding agent implementing the local collector UI, local queue, Vercel job APIs, polling worker, or admin portal integration. The design keeps the home machine simple while preserving the project boundary that collector and agent outputs are untrusted.

For operational bootstrap on Vercel and the first home collector machine, see [Deployment Bootstrap Spec](deployment-bootstrap.md).

## Core Design

The historical V2 design had three ways to start collection work:

- local console seed: the operator opens a local page on the home machine, pastes a URL, and starts a local collector run
- admin portal seed: the operator pastes a URL in the Vercel admin portal,
  which creates a queued job for the historical hosted runner
- local fallback: hosted-runner failures with expected platform/browser reasons
  make the same job claimable by the home-machine collector

All paths converge on the same backend-validated upload boundary:

```text
admin portal job
-> hosted Agent runner or local fallback collector
-> external agent API for classification and extraction
-> normalized upload to Vercel ingest API with collector contract
-> Vercel validates and stores in Supabase
-> admin portal reviews drafts, evidence, and failures
```

The home machine observes pages and proposes results. Vercel and the backend validate uploads, compute review state, enforce publish blocking, deduplicate records, and decide final product state.

## Non-Goals

- Do not let the hosted runner, local collector, or Agent write directly to Supabase.
- Do not expose the home-machine console as a public internet service.
- Do not let the collector write directly to Supabase.
- Do not let the collector or agent publish canonical events.
- Do not add OAuth, per-device key management, signed requests, or mTLS for the MVP.
- Do not make ordinary Vercel request/response functions run unbounded browser sessions.

## Local Console

The local console is a small operator page served by the home-machine collector service.

Minimum controls:

- seed URL input
- start run button
- current queue list
- run status
- captured text and asset summary
- extracted draft JSON summary
- upload status
- retry failed run button

The console may bind to `localhost` or a private network interface. If it is reachable by other devices, the MVP should support a simple `LOCAL_COLLECTOR_CONSOLE_TOKEN` gate. This token protects only the local console. It is separate from `COLLECTOR_API_KEY`, which authenticates the collector to Vercel.

The console should not store Vercel secrets in browser-accessible JavaScript. It should call the local collector service, and the local service should hold secrets server-side in environment variables.

## Local Queue

The home-machine collector service should use a local queue even for manually pasted URLs.

Required local states:

- `queued`
- `capturing`
- `extracting`
- `uploading`
- `uploaded`
- `failed`
- `cancelled`

The local queue should process one browser-heavy run at a time for the MVP. This avoids browser profile contention and makes failures easier to understand.

Recommended local behavior:

- Creating a local seed run returns immediately with a local run ID.
- The worker processes the queue in the background.
- The page can refresh or reconnect without losing run state.
- Local run artifacts are retained long enough for debugging.
- A failed run can be retried with the same seed URL and a new run ID.

Before the browser-based collector lands, the repository includes a fixture
smoke command that exercises the same Vercel collector API boundary:

```bash
pnpm collector:bootstrap-env --env-file .env.local --collector-host 192.168.0.16 --output .env
pnpm env:check --target collector --env-file .env
pnpm collector:console --env-file .env
pnpm collector:fixture --env-file .env --seed-url "https://mp.weixin.qq.com/s/example"
pnpm collector:fixture --env-file .env --claim-once --fixture ready-event
pnpm collector:fixture --env-file .env --claim-once --fixture failure
```

`pnpm collector:bootstrap-env` writes a collector-only dotenv file for the home
machine. It copies the public app URL and collector token from a trusted source
env when available, defaults `COLLECTOR_ID` to `home-192-168-0-16`, and leaves
operator-owned `AGENT_*` values as editable placeholders when they are
not present.

The local console command starts a local-only web service with Vercel job
polling, a JSON-backed queue, and one-at-a-time worker. Use
`LOCAL_COLLECTOR_PROCESSOR=fixture` for deterministic source-run,
article-snapshot, and draft uploads through the existing collector API boundary.
Use `LOCAL_COLLECTOR_PROCESSOR=agent` for the real extraction path. The local
collector observes the seed URL with the repo-local browser agent, sends page
observation and run context to the configured provider, validates the structured
provider response, retries invalid responses locally, and uploads only
normalized collector payloads to Vercel.

Fixture mode was not a real browser or LLM extractor, and it was not intended as
a substitute for production collection. The historical agent mode was the V2
collector boundary for page understanding, OCR, vision, and LLM reasoning. The
shared purpose was to prove that the collector machine could queue work,
authenticate to Vercel, and upload normalized objects without direct Supabase
access.

## Historical Vercel Collector Job Queue

The V2 design stored collector jobs created by the admin portal or backend
workflows. That design allowed a hosted runner or a local collector runner. It
is not the active Event Pipeline execution contract.

### Runner State

Collector jobs preserve the execution runner separately from terminal job state:

- `preferredRunner`: historical hosted runner or `local_collector`
- `actualRunner`: runner used by the current or latest attempt
- `runnerState`: historical hosted-runner states, `local_pending`,
  `local_claimed`, `local_running`, historical fallback states, `completed`, or
  `failed`
- `fallbackEligible`: whether the local collector may claim a hosted-runner
  failure
- `fallbackReason`: structured reason such as `captcha_required`,
  `login_required`, `fetch_blocked`, `fetch_timeout`,
  `region_network_failed`, or a hosted-runner timeout

### Job States

Required Vercel-side job states:

- `queued`
- `claimed`
- `running`
- `completed`
- `partial`
- `failed`
- `cancelled`
- `expired`

State ownership:

- Admin portal or backend creates `queued` jobs.
- Collector changes `queued` to `claimed` through the claim API.
- Collector sends heartbeats while processing.
- Collector reports `completed`, `partial`, or `failed`.
- Backend may mark stale claimed/running jobs as `expired` when their lease expires.
- Admin may mark jobs `cancelled`.

### Claim And Lease

The collector should poll a claim endpoint instead of listing all jobs.

Endpoint:

```text
POST /api/collector/jobs/claim
```

Request:

```ts
type ClaimJobRequest = {
  collectorId: string;
  capabilities: CollectorCapability[];
  maxJobs?: 1;
};

type CollectorCapability =
  | "agent_api"
  | "wechat_browser"
  | "dom_text"
  | "image_capture"
  | "ocr"
  | "vision_extraction";
```

Response when a job is available:

```ts
type ClaimJobResponse = {
  job: {
    jobId: string;
    seedUrl: string;
    sourceId?: string;
    requestedAt: string;
    leaseExpiresAt: string;
    attemptNumber: number;
    requestedMode?: "auto" | "text_only" | "image_heavy_debug";
    preferredRunner: "historical_hosted_runner" | "local_collector";
    actualRunner?: "historical_hosted_runner" | "local_collector";
    runnerState: string;
    fallbackEligible: boolean;
    fallbackReason?: string;
  };
};
```

Response when no job is available:

```ts
type ClaimJobResponse = {
  job: null;
  retryAfterSeconds: number;
};
```

Claim rules:

- Only `queued` jobs can be claimed.
- The local collector can claim only `preferredRunner=local_collector` jobs or
  `fallbackEligible=true` jobs.
- Claiming sets `collectorId`, `claimedAt`, `leaseExpiresAt`, and `attemptNumber`.
- The MVP should use a 10-minute lease by default.
- A job whose lease expires can return to `queued` or move to `expired`, depending on attempt count.
- The claim endpoint should return at most one job for the MVP.

### Heartbeat

Endpoint:

```text
POST /api/collector/jobs/:jobId/heartbeat
```

Request:

```ts
type HeartbeatRequest = {
  collectorId: string;
  localRunId: string;
  stage:
    | "capturing"
    | "extracting"
    | "uploading";
  message?: string;
  extendLeaseSeconds?: number;
};
```

Rules:

- Heartbeat is accepted only from the collector that holds the lease.
- Heartbeat extends the lease within a backend-defined maximum.
- Heartbeat messages must not contain secrets, cookies, or raw page dumps.

### Report

Endpoint:

```text
POST /api/collector/jobs/:jobId/report
```

The report endpoint records final job state and links to normalized uploads.

Request:

```ts
type JobReportRequest = {
  collectorId: string;
  localRunId: string;
  status: "completed" | "partial" | "failed";
  sourceRunId?: string;
  articleSnapshotIds?: string[];
  eventDraftIds?: string[];
  evidenceAssetIds?: string[];
  failureIds?: string[];
  suggestedDisposition?: SuggestedDisposition;
  message?: string;
};

type SuggestedDisposition =
  | "ready_for_review"
  | "needs_review"
  | "needs_info"
  | "failed"
  | "not_activity";
```

`suggestedDisposition` is collector guidance only. The backend must compute its own review state and publish eligibility.

## Polling Cadence

Recommended polling behavior:

- development/debug mode: every 10 seconds
- production MVP default: every 60 seconds
- immediately poll again after finishing a job
- when no jobs are returned for 10 consecutive polls, back off to 2 minutes
- maximum idle backoff: 5 minutes
- network or server errors: exponential backoff of 1 minute, 2 minutes, 5 minutes, then 10 minutes

The collector should not claim a new job while one is running in the MVP. It can still send heartbeats and finish uploads for the current job.

## Authentication

The V2 MVP design used one shared local collector token and a separate scoped
token secret for short-lived hosted-runner ingest credentials.

Vercel environment:

```text
COLLECTOR_API_KEY=long-random-secret
COLLECTOR_SCOPED_TOKEN_SECRET=long-random-signing-secret
```

Home collector environment:

```text
APP_BASE_URL=https://your-vercel-app.example
COLLECTOR_API_KEY=same-long-random-secret
COLLECTOR_ID=home-mac-1
LOCAL_COLLECTOR_CONSOLE_TOKEN=optional-local-console-token
```

Collector requests to Vercel must include:

```text
Authorization: Bearer <COLLECTOR_API_KEY>
X-Collector-Id: <COLLECTOR_ID>
```

Historical hosted-runner ingest requests used a signed scoped token instead of
the long-lived collector token:

```text
Authorization: Bearer scoped.<payload>.<signature>
X-Collector-Id: hosted-<job-id>
X-Collector-Job-Id: <job-id>
```

MVP token rules:

- Use a high-entropy random token.
- Do not log the token.
- Do not expose the token in browser-side code.
- Rotate the token if the home machine is lost, shared, or suspected compromised.
- Scoped hosted-runner tokens expire and are limited to one signed job ID.

## Admin Portal Integration

The admin portal should create collector jobs rather than directly invoking the home machine.

Minimum admin portal behavior:

- paste seed URL
- create `queued` collector job
- show job state, preferred runner, actual runner, attempt number, fallback
  state, failure reason, and last heartbeat
- show claimed collector ID when present
- link completed jobs to uploaded source run, snapshots, drafts, evidence, and failures
- show `needs_review`, `needs_info`, `failed`, and `not_activity` outcomes in review queues

This keeps the home machine behind outbound-only network access. The home machine does not need a public URL.

## Suggested Disposition Rules

The collector may suggest one disposition per job:

- `ready_for_review`: extraction produced a plausible event draft with required public fields and no special evidence blocker
- `needs_review`: extraction includes QR registration, image-derived fields, low confidence, possible duplicate, or secondary mention
- `needs_info`: event appears real but is missing key public fields such as date/time, venue, address, or registration action
- `failed`: collection or extraction could not complete
- `not_activity`: page does not appear to announce a relevant activity

Backend rules:

- Do not let collector or Agent output publish directly.
- Do not treat `failed` source fetches as event cancellations.
- Recompute review state and auto-publish eligibility from normalized uploads.
- Preserve collector disposition as diagnostics for admin review.

## Local Provider Boundary

The local worker may call an OpenAI-compatible provider for classification and
extraction. That provider is an implementation detail of the home-machine
runtime.

Provider responses should be converted into normalized collector objects before
upload to Vercel. The Vercel app should not depend on a specific provider's
response format.

Local worker responsibilities:

- send page observation and run context to the configured provider
- request structured extraction with bounded retry behavior
- validate the provider response locally before upload
- map agent uncertainty to draft signals and suggested disposition

The agent API must not receive collector API secrets, admin tokens, Supabase
secrets, Vercel tokens, or other backend credentials.

## Implementation Slices

Future coding agents should implement this design in independently testable slices.

### Slice 1: Collector Job Contracts

Add shared TypeScript types and schema validation for job state, claim, heartbeat, report, and suggested disposition.

Expected output:

- contract module
- schema tests
- example fixtures for no-job, claimed-job, heartbeat, completed, partial, and failed reports

### Slice 2: Vercel Job API

Implement job creation, claim, heartbeat, and report endpoints.

Expected output:

- authenticated collector endpoints
- admin job creation endpoint or server action
- lease and stale-job handling
- tests for authentication, claiming, lease ownership, and idempotent report handling

### Slice 3: Supabase Job Schema

Add collector job persistence.

Expected output:

- `collector_jobs` table
- indexes for queued jobs and stale leases
- constraints for state and attempt count
- relations to source runs, snapshots, drafts, evidence, and failures

### Slice 4: Local Console Skeleton

Implement the local operator page and local queue.

Expected output:

- local-only web service: implemented by `pnpm collector:console`
- seed URL form: implemented in the local console HTML/API
- run list and run detail API: implemented
- local queue worker: implemented for one-at-a-time fixture processing
- local run persistence: implemented through `LOCAL_COLLECTOR_QUEUE_FILE`

Remaining work:

- richer browser smoke coverage for the local console page
- durable runtime image storage for poster and QR assets

### Slice 5: Polling Worker

Implement Vercel job polling and local execution handoff.

Expected output:

- configurable polling cadence: implemented through
  `COLLECTOR_POLL_INTERVAL_SECONDS` and `COLLECTOR_ERROR_BACKOFF_SECONDS`
- claim API client: implemented in `pnpm collector:console`
- heartbeat loop: implemented during local run state transitions
- report submission: implemented after upload or failure
- retry/backoff behavior: implemented for no-job and error polling states

Remaining work:

- richer lease recovery behavior after interrupted local processes
- real-machine browser smoke for lazy-loaded WeChat pages

### Slice 6: Admin Portal Job Visibility

Show collector job state in the admin portal.

Expected output:

- seed URL job creation
- job status display
- links from completed jobs to drafts, evidence, failures, and run diagnostics

## Validation Expectations

For this spec:

- run a marker scan for unresolved drafting markers
- run `git diff --check`
- inspect consistency with `docs/collector-agent-ingestion.md`, `docs/admin-portal-requirements.md`, `.env.example`, and `docs/technical-baseline.md`

For future implementation:

- unit-test job state transitions
- unit-test claim lease behavior
- integration-test collector auth
- integration-test heartbeat ownership
- integration-test stale lease recovery
- integration-test report idempotency
- browser-smoke local console seed URL flow
- browser-smoke admin portal job creation and result visibility
