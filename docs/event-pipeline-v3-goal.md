# Event Pipeline V3 Goal Pack

This document is the execution contract for the next implementation goal. It
must be enough for a Codex goal-mode session to complete the Event Pipeline V3
cleanup without relying on chat history.

## Goal Objective

Refactor the current event pipeline into explicit, independently testable
modules and stabilize the production path around the Mac-local Wechat2RSS
collector.

The product goal is a usable Beijing cultural activity catalog backed by an
automated local events desk:

- Wechat2RSS acts as the current production source provider for WeChat official
  account subscriptions.
- The collector captures official-account articles and evidence.
- The LLM extractor classifies public eligibility and extracts event candidates
  from article text and visual evidence.
- Backend ingest, dedupe, publication policy, and admin review own all trusted
  state transitions.
- Public pages show only canonical, public, user-actionable events.

## Source Of Truth

Read these before implementation:

- [AGENTS.md](../AGENTS.md)
- [Requirements](requirements.md)
- [Technical Baseline](technical-baseline.md)
- [Event Pipeline Architecture](event-pipeline-architecture.md)
- [Testing Strategy](testing-strategy.md)
- [Vision Eval And Bad-Case Workflow](vision-eval-workflow.md)
- [Admin Portal Requirements](admin-portal-requirements.md)
- [External Dependencies](external-dependencies.md)
- [Quickstart](quickstart.md)
- this document

Follow the GitHub workflow in `AGENTS.md`. Use the implementation issues listed
below. Do not rely on prior chat history.

## Implementation Issues

Complete the issues in order unless a later issue is strictly blocked by a
missing operator credential. Each issue must have its own branch, tests, PR, and
handoff comment.

1. [#212 Event Pipeline V3: retire Vercel Sandbox crawler path](https://github.com/apue/local-activities/issues/212)
2. [#213 Event Pipeline V3: modularize Wechat2RSS source and collector orchestration](https://github.com/apue/local-activities/issues/213)
3. [#214 Event Pipeline V3: modularize LLM extraction and replay contracts](https://github.com/apue/local-activities/issues/214)
4. [#215 Event Pipeline V3: enforce eval, replay, smoke, and production write isolation](https://github.com/apue/local-activities/issues/215)
5. [#216 Event Pipeline V3: retain and render poster and QR evidence](https://github.com/apue/local-activities/issues/216)
6. [#217 Event Pipeline V3: fix dedupe, publication policy, schedules, and occurrences](https://github.com/apue/local-activities/issues/217)
7. [#218 Event Pipeline V3: repair admin portal actions, auth persistence, source URLs, and blockers](https://github.com/apue/local-activities/issues/218)
8. [#219 Event Pipeline V3: track usage across extractor, eval, and production acceptance](https://github.com/apue/local-activities/issues/219)
9. [#220 Event Pipeline V3: clean hosted dirty data with explicit approval](https://github.com/apue/local-activities/issues/220)
10. [#221 Event Pipeline V3: run curated production seed import and product acceptance](https://github.com/apue/local-activities/issues/221)

Umbrella: [#211 Event Pipeline V3 umbrella](https://github.com/apue/local-activities/issues/211).

## Non-Goals

- Do not bypass captchas, login checks, platform protections, account-risk
  controls, or anti-bot systems.
- Do not reintroduce Vercel Sandbox as a crawler runtime for this MVP slice.
- Do not introduce LangChain, LangGraph, or third-party APM.
- Do not write directly to Supabase from the collector.
- Do not let eval, replay, fixture, or smoke commands publish public events by
  default.
- Do not run production-mutating migrations, cleanup, replay, publish, or seed
  commands without explicit operator approval in the current conversation.
- Do not store permanent full article mirrors as a product feature.
- Do not treat LLM confidence as a direct publication command.

## Current Production Architecture

The V3 production path is:

```text
Mac-local Wechat2RSS service
-> Wechat2RSS source provider
-> article snapshot builder
-> evidence extraction and asset storage
-> LLM information extractor
-> collector upload client
-> backend ingest
-> backend dedupe and publication policy
-> admin review for exceptions
-> public canonical event pages
```

Vercel hosts the Next.js app, public pages, admin portal, API routes, read-only
smoke checks, and lightweight backend work. Vercel does not run the production
WeChat crawler in this slice.

Scripts are thin command wrappers. Core crawler, extractor, storage, upload,
dedupe, publication, usage, and admin behavior must live in modules with the
contracts defined in [Event Pipeline Architecture](event-pipeline-architecture.md).

## Module Contract Requirement

Every pipeline node touched by implementation must have a clear module contract:

```text
1. module location
2. input contract
3. output contract
4. allowed side effects
5. forbidden responsibilities
6. independent test path
```

These boundaries are mandatory:

- Source providers do not call LLMs.
- Source providers do not decide whether an article is public, publishable, or a
  duplicate.
- Extractors do not crawl pages, write production databases, or publish events.
- Storage adapters do not infer event semantics.
- Collector upload clients do not bypass backend validation.
- Backend ingest treats collector and LLM output as untrusted input.
- Publication policy owns final publish, review, reject, duplicate, and blocked
  states.
- Admin UI does not re-run extraction logic or hide backend blockers.
- Public UI does not expose model diagnostics, draft state, or admin reasoning.

## Testing Contract

Default validation must be deterministic and non-mutating:

```bash
pnpm test
pnpm typecheck
pnpm fixture:e2e -- --all
```

Hosted read-only validation may run when `.env.local` is configured:

```bash
pnpm env:check --env-file .env.local --target local-app
pnpm smoke:admin-readonly --env-file .env.local
```

Live source and production write commands are operator-run only:

```bash
pnpm smoke:wechat2rss --env-file .env.collector
pnpm collector:wechat2rss:once --env-file .env.collector --extract
pnpm seed:production-events --env-file .env.local --manifest tests/seed-corpus/production-seed-manifest.json
```

Fixture upload and E2E fixture smoke are mutating fixture-data workflows, not
default validation. They must require explicit write flags and must print their
target and write mode:

```bash
pnpm fixture:upload -- --all --allow-hosted-write
pnpm smoke:e2e-fixture --env-file .env.local --seed-url URL --allow-hosted-write --allow-public-fixture-data
```

Implementation may adjust exact script names only if the issue handoff records
the equivalent commands and the scripts preserve the same write boundaries.

## Fixture, Eval, And Production Seed Separation

Use three separate workflows:

- **Fixture/replay**: deterministic pipeline regression tests; no live provider
  calls and no hosted production writes.
- **Eval**: operator-run model comparison and bad-case discovery; live calls may
  spend provider credit and should record real usage, but eval must not publish
  public events.
- **Production seed import**: deliberate final acceptance run using curated real
  official-account URLs or captured source snapshots; this writes through the
  production backend and is validated from the public and admin surfaces.

The production seed import is not a test side effect. It must require explicit
operator approval, print the target environment without secrets, assign a batch
or run id, and produce an import report with created or updated ids.

## Required Production Acceptance Corpus

Create and maintain:

```text
tests/seed-corpus/production-seed-manifest.json
```

The manifest must include curated real source pages that cover:

- high-confidence single public event
- multi-event article
- QR-only or QR-required registration
- poster or image-dominant event
- long-running exhibition
- recurring activity with occurrences
- duplicate event pair
- official visit or non-public news item
- generic cultural article that is not a public event
- incomplete event that should route to admin review

Expected outcomes must be product-facing:

- public events appear as canonical public cards
- duplicate mentions do not create duplicate public cards
- non-public/news cases do not enter the public catalog
- incomplete cases remain reviewable without confusing public output
- poster and QR evidence are visible in admin and public pages when relevant
- token usage for the production acceptance run is visible in admin usage views

## Completion Criteria

The V3 goal is complete only when all implementation issues are merged and:

- Vercel Sandbox crawler behavior is removed from the active MVP path.
- The Wechat2RSS collector path is modular and independently testable.
- The LLM extractor is modular, schema-validated, and free of production upload
  side effects.
- Eval/replay cannot accidentally publish production public events.
- Admin draft actions work and explain blockers.
- Dedupe, publication policy, long-running schedules, recurring schedules,
  poster evidence, QR evidence, and source URLs are validated by fixtures.
- Usage ledger includes live extractor, eval, and production acceptance usage
  with separate environment labels.
- A curated production seed import has been run with operator approval and its
  public/admin results are recorded in the final issue handoff.

## Blocking Conditions

Mark the goal blocked only if one of these repeats for at least three consecutive
goal turns and no meaningful progress can be made:

- Required operator credentials are missing for a live smoke or production seed
  step that cannot be replaced by deterministic validation.
- Required Wechat2RSS login state is unavailable for the final live source
  validation.
- Hosted Supabase or Vercel APIs are unreachable and the remaining work depends
  on live hosted validation.
- A production-mutating action is required and the operator has not approved it
  in the current conversation.
