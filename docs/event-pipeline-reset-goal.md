# Event Pipeline Reset Goal

This document is the execution contract for replacing the previous local
collector/extractor pipeline with the new automated capture-to-analysis
architecture. Do not rely on older Event Pipeline V2/V3/V4 goal packs as active
requirements.

## Goal

Build a mostly automated event pipeline:

```text
External capture worker
-> Supabase Storage article bundle
-> Supabase Edge Function analysis
-> Supabase DB ledger/drafts/events/evidence/usage/eval
-> Vercel public catalog and admin portal
```

The operator should normally intervene only for model/prompt selection, review
decisions, source/login failures, and error recovery.

## Active Architecture

### Capture Runtime

The capture runtime runs outside Vercel, initially as a Docker-side worker next
to the local Wechat2RSS service. It may later run on a home server or cloud VM.

It owns:

- checking Wechat2RSS health
- polling recent subscribed articles
- detecting new article URL/content hash pairs
- building article bundles with manifest, HTML, text, images, links, and source
  metadata
- uploading bundle files to Supabase Storage
- calling the Supabase Edge Function with bundle metadata

It must not:

- call LLM providers in the production path
- write Supabase event/draft/evidence rows directly
- decide publication state
- bypass captchas or platform protections

### Supabase Runtime

Supabase owns product processing after capture.

Supabase Storage buckets:

```text
article-bundles        private raw capture material, retained by policy
event-evidence-assets  public or signed display assets for events/drafts
eval-artifacts         private evaluation reports and model outputs
```

Supabase Edge Functions:

```text
analyze-article-bundle
run-evaluation
```

The analysis function owns:

- validating collector authentication
- reading a stored article bundle
- assembling multimodal LLM input from text, HTML structure, links, and image
  assets
- calling the configured OpenAI-compatible model provider, initially Alibaba
  Cloud Model Studio
- schema validation and normalization
- public eligibility classification
- multi-event extraction
- poster and registration QR evidence selection
- dedupe and publish routing
- ledger, evidence, draft/event, and usage writes

Every processed article must create a ledger row, including excluded and failed
articles.

### Vercel Runtime

Vercel owns:

- the public catalog
- the admin portal
- read-only operational views
- admin actions that update review state or trigger Supabase analysis/evaluation

Vercel must not run WeChat crawling or the production LLM analysis pipeline for
this reset.

## Required Code Removal

The reset is not a legacy compatibility layer. Active code and package scripts
must not expose the old production paths after implementation.

Remove or replace:

- local collector path that reads Wechat2RSS and directly calls LLM providers
- local collector path that uploads article snapshots, evidence assets, event
  drafts, or extraction failures to Vercel collector APIs
- Vercel collector ingest APIs as a production collector entrypoint
- Vercel Blob runtime asset storage for posters and QR images
- `BLOB_READ_WRITE_TOKEN` as an active production dependency
- single URL agent-browser extraction upload as a production path
- provider-specific eval scripts as active evaluation infrastructure
- old V2/V3/V4 goal packs from active docs

Keep or rebuild only when it serves the new architecture:

- Wechat2RSS source querying
- captured article bundle contracts
- regression corpus concepts and existing reusable cases
- public and admin UI surfaces
- Supabase app clients and migration infrastructure
- deterministic tests and smoke commands

## New Contracts

### Article Bundle

An article bundle is raw capture material. It must preserve source context and
avoid early business judgment.

```text
manifest.json
article.html
article.txt
links.json
images/<image-id>.<ext>
diagnostics.json
```

Manifest fields:

```text
bundleVersion
bundleId
sourceProvider
sourceId
sourceName
sourceUrl
canonicalUrl
publishedAt
capturedAt
contentHash
images[]
links[]
diagnostics[]
```

Image records must preserve article order, source URL, local storage path,
content type, byte hash, dimensions when available, and nearby/alt text when
available. Capture may include role hints, but analysis owns final evidence
selection.

### Edge Function Request

`analyze-article-bundle` accepts JSON:

```json
{
  "sourceUrl": "https://mp.weixin.qq.com/s/example",
  "publishedAt": "2026-06-08T10:00:00+08:00",
  "bundleId": "bundle_...",
  "storagePrefix": "article-bundles/bundle_...",
  "contentHash": "sha256...",
  "sourceProvider": "wechat2rss",
  "sourceId": "optional",
  "sourceName": "optional",
  "mode": "production"
}
```

`mode=eval` writes evaluation outputs and usage but must not write production
draft/event rows.

### Ledger

The ledger records every article processing outcome:

```text
captured
analysis_started
published
needs_review
needs_info
excluded
duplicate
failed
```

Ledger rows must include source URL, content hash, bundle ID/prefix, model,
prompt version, schema version, decision, reason, confidence, usage reference,
and structured error details when relevant.

### Evaluation

Evaluation is first-class. An extractor variant is:

```text
provider + model + promptVersion + schemaVersion + parameters
```

Evaluation runs compare variants against a fixed corpus and write:

```text
evaluation_runs
evaluation_case_results
llm_usage
eval-artifacts/*
```

Evaluation must not mutate production drafts or canonical events.

## Required Database And Storage Work

Implement migrations for the reset schema and storage policies. The exact table
names may be adjusted during implementation, but these capabilities are required:

- article bundle metadata
- processing ledger
- event evidence assets
- event drafts
- canonical events
- dedupe decisions
- LLM usage
- evaluation runs
- evaluation case results

Run a read-only audit before destructive cleanup. Production deletion of old
rows and old storage objects is approved by this reset request, but the
implementation must log exactly what was removed and preserve a handoff record
in the relevant GitHub issue.

## Required Admin/Public Work

Admin portal must expose:

- draft review
- article audit / ledger
- usage
- evaluation reports

Admin actions must support publish, reject with reason, edit/override where
allowed by policy, and re-run analysis/evaluation through Supabase functions.

Public catalog must read only canonical published events and show poster and
registration QR assets when available.

## Regression Corpus

Build a 15-25 case corpus from the local Wechat2RSS cache and existing fixtures.
It must include:

- ordinary public event
- registration-required event
- registration QR event
- poster/image-dominant event
- multi-event article
- long-running exhibition
- recurring occurrences
- duplicate or update case
- non-public official visit or internal event
- not an event/news article
- not Beijing event
- QR present but not registration
- information-sparse event requiring review

The corpus must be replayable without live WeChat, live LLM, production writes,
or hosted Storage writes.

## Validation

Required validation before completion:

```bash
pnpm test
pnpm typecheck
supabase migration list
supabase functions list
supabase functions serve analyze-article-bundle --env-file .env.local
```

Add and run project-specific commands for:

- capture worker dry-run from Wechat2RSS cache/API
- article bundle contract validation
- Edge Function fixture analysis with mocked provider
- live LLM analysis smoke when configured and within approved budget
- regression corpus replay
- evaluation run with mocked provider
- admin read-only smoke
- public catalog smoke
- production cleanup/import report

Live WeChat crawling and live LLM calls are allowed for final acceptance when
credentials are present. Do not bypass captchas or platform protections.

## GitHub Workflow

Use the workflow in `AGENTS.md`:

```text
Issue -> branch -> implementation -> tests -> PR -> review -> checks -> merge
```

Create an umbrella issue and independently testable implementation issues.
Each issue must include goal, scope, non-goals, acceptance criteria, testing
expectations, and handoff comments.

Implementation issue order:

1. [#270 Event Pipeline Reset: archive old docs and remove active legacy entrypoints](https://github.com/apue/local-activities/issues/270)
2. [#271 Event Pipeline Reset: Supabase schema, storage buckets, and cleanup tooling](https://github.com/apue/local-activities/issues/271)
3. [#272 Event Pipeline Reset: capture worker uploads Wechat2RSS article bundles](https://github.com/apue/local-activities/issues/272)
4. [#273 Event Pipeline Reset: Supabase Edge Function analysis pipeline](https://github.com/apue/local-activities/issues/273)
5. [#274 Event Pipeline Reset: Vercel public/admin UI for ledger, review, usage, and eval](https://github.com/apue/local-activities/issues/274)
6. [#275 Event Pipeline Reset: regression corpus from Wechat2RSS cache](https://github.com/apue/local-activities/issues/275)
7. [#276 Event Pipeline Reset: evaluation runs for extractor variants](https://github.com/apue/local-activities/issues/276)
8. [#277 Event Pipeline Reset: final cleanup, production acceptance, and handoff](https://github.com/apue/local-activities/issues/277)

## Completion Criteria

The reset is complete only when:

- old active production paths and docs are removed
- new capture worker path uploads bundles to Supabase Storage
- Supabase Edge Function analysis writes ledger and product rows
- Supabase Storage separates raw bundles, event evidence, and eval artifacts
- admin and public pages read the new data model
- evaluation runs can compare extractor variants
- old production data/config has been cleaned with a recorded report
- validation commands pass
- PRs are merged and issue handoffs are updated
