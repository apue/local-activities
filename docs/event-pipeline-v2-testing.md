# Event Pipeline V2 Testing And Environment Isolation

This document defines the testing and environment isolation contract for Event
Pipeline V2. It is referenced by `docs/event-pipeline-v2-goal.md` and should be
followed before running fixture, Supabase, Vercel, or live-source validation.

## Core Rules

- Default validation must be deterministic and offline.
- Default validation must not call live WeChat, live LLM providers, or live
  asset providers.
- Default validation must not mutate a hosted Supabase database.
- Vercel Preview deployments must not write to a production Supabase project.
- Live capture, live LLM, hosted Supabase writes, production replay, cleanup,
  and publish commands require explicit operator approval in the current
  conversation.
- Test fixtures must not contain secrets, cookies, private account state,
  bearer tokens, Supabase credentials, Vercel tokens, or full article mirrors
  beyond what is needed for deterministic validation.

## Test Layers

### Unit And Contract Tests

Use unit and contract tests for module-level behavior:

- schema validation for collector, triage, extraction, resolution, admin, and
  public event contracts
- malformed LLM response handling
- schedule normalization and display helpers
- recurrence and occurrence generation
- publish blocker computation
- candidate lookup query construction
- asset-storage adapter contracts with fake storage
- store behavior with fake or local test stores

These tests should run under `pnpm test` without hosted services.

### Fixture Replay Tests

Fixture replay is the default pipeline-level validation path. It proves that the
application can consume captured source material and recorded LLM outputs through
triage, extraction, resolution, publish policy, admin state, and public rendering.

Add fixtures under:

```text
fixtures/event-pipeline-v2/<case-id>/
```

Each case should contain:

```text
source.json
raw-wechat2rss.json
article-snapshot.json
image-candidates.json
evidence-assets.json
triage-input.json
triage-response.json
triage-decision.json
extraction-input.json
extraction-response.json
extracted-event-candidates.json
candidate-events.json
resolution-response.json
expected.json
```

Required commands:

```bash
pnpm fixture:replay -- --case <case-id> --stage snapshot
pnpm fixture:replay -- --case <case-id> --stage triage
pnpm fixture:replay -- --case <case-id> --stage extraction
pnpm fixture:replay -- --case <case-id> --stage resolution
pnpm fixture:e2e -- --case <case-id>
pnpm fixture:e2e -- --all
```

Replay commands must use committed fixture files and recorded provider
responses. They must not call live LLM providers.

### LLM Response Testing

Default tests validate how the system consumes LLM output, not whether a live
model repeats the same answer.

- Store recorded triage, extraction, and resolution responses in fixtures.
- Validate provider responses against versioned schemas.
- Normalize recorded responses into backend-owned contracts.
- Test malformed responses with focused mocks.
- When prompts or schemas change, update recorded responses and `expected.json`
  deliberately in the same implementation PR.

Live LLM calls are allowed only in operator-run capture or smoke workflows.

### Vision Model Policy Tests

The default policy is triage-first: use `Qwen/Qwen3-VL-8B-Instruct` for the
first pass and reserve `Qwen/Qwen3-VL-30B-A3B-Instruct` for complex or uncertain
cases. `scripts/vision-model-policy.mjs` owns this policy so config parsing and
escalation triggers can be tested without calling a live model.

Run the focused policy tests with:

```bash
pnpm vitest run scripts/vision-model-policy.test.mjs scripts/llm-extractor.test.mjs
```

The escalation triggers are low confidence, ambiguous public eligibility,
multi-event pages, long-running or recurring schedules, QR registration evidence
with incomplete registration details, and missing required event fields.

For the persistent labeled eval set and bad-case workflow, see
`docs/vision-eval-workflow.md`.

### Supabase Validation

Hosted Supabase validation is read-only by default.

Allowed by default:

- environment checks
- read-only health checks
- read-only admin smoke checks
- read-only schema parity checks

Not allowed by default:

- hosted fixture replay that inserts drafts or canonical events
- hosted migration execution
- hosted draft cleanup
- hosted canonical-event cleanup
- hosted publish or withdrawal actions

Write-path integration tests should use one of these targets:

- fake stores for CI and fast local tests
- Supabase CLI local database for SQL/store integration
- a separate hosted Supabase test project when operator credentials exist

If a shared hosted database must be used temporarily, the command must require
explicit operator approval, print the target URL or project alias before
writing, scope all rows to a unique `test_run_id`, and clean up only rows from
that `test_run_id`. This is not the default Event Pipeline V2 validation path.

### Vercel Preview Validation

Keep `main` as the production branch. Feature branches and PRs use Vercel
Preview deployments.

Preview deployments may run:

- build checks
- browser/UI inspection
- public-page smoke checks
- read-only admin smoke checks
- fixture replay that does not mutate hosted Supabase

Preview deployments must not run production-mutating collector, replay, cleanup,
publish, or migration commands against the production Supabase project.

A persistent `staging` branch is not required for Event Pipeline V2. If a
separate hosted Supabase test project is provisioned later, a staging branch or
branch-specific Vercel Preview environment may be added so hosted write-path
smoke tests point at test Supabase, test asset storage, and separate admin and
collector tokens.

### Live Capture And Smoke

Live URLs are sampling inputs for fixture capture, not stable CI inputs.

Operator-run commands may include:

```bash
pnpm fixture:capture -- --case <case-id> --url <source-url> --env-file .env.collector
pnpm smoke:wechat2rss --env-file .env.collector
pnpm collector:wechat2rss:once --env-file .env.collector --extract
```

`fixture:capture` may require Wechat2RSS login, local browser state, live LLM
credentials, and asset-storage credentials. Captured output must be sanitized
before committing.

`smoke:wechat2rss` is read-only against the local Wechat2RSS service.

`collector:wechat2rss:once --extract` uploads to the configured collector API.
Treat it as production-mutating when `COLLECTOR_BASE_URL` points at a deployed
app backed by production Supabase.

## Validation Command Groups

Default local validation:

```bash
pnpm test
pnpm typecheck
pnpm fixture:e2e -- --all
```

Read-only hosted validation when `.env.local` is configured:

```bash
pnpm env:check --env-file .env.local --target local-app
pnpm smoke:admin-readonly --env-file .env.local
```

Operator-run live validation only when credentials and login state are present:

```bash
pnpm smoke:wechat2rss --env-file .env.collector
pnpm fixture:capture -- --case <case-id> --url <source-url> --env-file .env.collector
```

## Script Guardrails

Any command that can write to hosted Supabase, publish public events, clean
hosted records, run hosted migrations, or upload collector results must:

- require an explicit command flag or documented operator approval path
- print the target environment without printing secrets
- refuse ambiguous production targets
- record created IDs or run IDs in command output
- document cleanup steps when cleanup is expected

Read-only smoke commands must verify that invalid credentials are rejected
without printing token values.
