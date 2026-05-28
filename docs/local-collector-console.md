# Local Collector Console And Job Queue Spec

## Purpose

This document defines the MVP design for a home-machine collector console and a Vercel-backed collector job queue.

The intended reader is a future coding agent implementing the local collector UI, local queue, Vercel job APIs, polling worker, or admin portal integration. The design keeps the home machine simple while preserving the project boundary that collector and agent outputs are untrusted.

For operational bootstrap on Vercel and the first home collector machine, see [Deployment Bootstrap Spec](deployment-bootstrap.md).

## Core Design

The MVP has two ways to start collection work:

- local console seed: the operator opens a local page on the home machine, pastes a URL, and starts a local collector run
- admin portal seed: the operator pastes a URL in the Vercel admin portal, which creates a queued collector job for the home machine to claim

Both paths converge on the same local collector runtime:

```text
local console or Vercel collector job
-> local queue
-> collector worker with browser/profile
-> external agent API for classification and extraction
-> normalized upload to Vercel ingest API
-> Vercel validates and stores in Supabase
-> admin portal reviews drafts, evidence, and failures
```

The home machine observes pages and proposes results. Vercel and the backend validate uploads, compute review state, enforce publish blocking, deduplicate records, and decide final product state.

## Non-Goals

- Do not dynamically deploy a new agent for each URL.
- Do not expose the home-machine console as a public internet service.
- Do not let the collector write directly to Supabase.
- Do not let the collector or agent publish canonical events.
- Do not add OAuth, per-device key management, signed requests, or mTLS for the MVP.
- Do not make Vercel run unbounded browser sessions.

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
pnpm collector:console --env-file .env
pnpm collector:fixture --env-file .env --seed-url "https://mp.weixin.qq.com/s/example"
pnpm collector:fixture --env-file .env --claim-once --fixture ready-event
pnpm collector:fixture --env-file .env --claim-once --fixture failure
```

The local console command starts a local-only web service with Vercel job
polling, a JSON-backed queue, and one-at-a-time worker. Use
`LOCAL_COLLECTOR_PROCESSOR=fixture` for deterministic source-run,
article-snapshot, and draft uploads through the existing collector API boundary.
Use `LOCAL_COLLECTOR_PROCESSOR=extract` for the first real HTTP/HTML capture and
collector-side text-inference extraction path.

Fixture mode is not a real browser or LLM extractor, and it must not be used as
a substitute for production collection. Extract mode is the first real
processor, but browser-heavy WeChat scrolling and durable image storage are
still later enhancements. The shared purpose is to prove that the collector
machine can queue work, authenticate to Vercel, and upload normalized objects
without direct Supabase access.

## Vercel Collector Job Queue

The Vercel app stores collector jobs created by the admin portal or backend workflows. The home collector polls Vercel to claim jobs.

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

The MVP uses one shared collector token.

Vercel environment:

```text
COLLECTOR_API_KEY=long-random-secret
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

MVP token rules:

- Use a high-entropy random token.
- Do not log the token.
- Do not expose the token in browser-side code.
- Rotate the token if the home machine is lost, shared, or suspected compromised.
- A later issue may add per-collector tokens, but the MVP should not start there.

## Admin Portal Integration

The admin portal should create collector jobs rather than directly invoking the home machine.

Minimum admin portal behavior:

- paste seed URL
- create `queued` collector job
- show job state and last heartbeat
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

- Do not treat `ready_for_review` as publishable.
- Do not treat `failed` source fetches as event cancellations.
- Recompute review state from normalized uploads.
- Preserve collector disposition as diagnostics for admin review.

## Local Agent API Boundary

The local worker may call an external agent API for classification and extraction. That API is an implementation detail of the home-machine runtime.

Agent API responses should be converted into normalized collector objects before upload to Vercel. The Vercel app should not depend on a specific agent provider's response format.

Local worker responsibilities:

- prepare bounded page context for the agent
- pass image evidence or image references when needed
- request structured extraction
- validate the agent response locally before upload
- map agent uncertainty to draft signals and suggested disposition

The agent API must not receive collector API secrets unless the provider is explicitly trusted and a later issue documents that boundary.

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
- browser-backed capture for lazy-loaded WeChat images
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
- browser-backed capture for lazy-loaded WeChat pages

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
