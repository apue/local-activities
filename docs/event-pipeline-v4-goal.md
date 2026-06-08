# Event Pipeline V4 Goal Pack

This document is the execution contract for Event Pipeline V4. It must be
enough for a lower-context implementation agent to work without relying on chat
history.

## Goal Objective

Harden the event pipeline so the product can keep improving from stable module
contracts and deterministic regression tests instead of one-off live WeChat
debugging.

The V4 outcome is:

- explicit pipeline modules with clear input/output contracts
- deterministic tests for every non-LLM stage
- a capture contract that preserves text, HTML, images, links, mini-program
  actions, diagnostics, and typed failures
- evidence extraction for posters, QR codes, registration links, and action
  surfaces
- mocked/replay LLM paths for CI and live eval only when explicitly requested
- dedupe and publish-policy decisions that are deterministic and auditable
- admin/public surfaces that consume backend state correctly
- a categorized regression corpus and supervisor acceptance loop

## Source Of Truth

Read these before implementation:

- [AGENTS.md](../AGENTS.md)
- [Event Pipeline Architecture](event-pipeline-architecture.md)
- [Regression Corpus](regression-corpus.md)
- [Testing Strategy](testing-strategy.md)
- [Vision Eval And Bad-Case Workflow](vision-eval-workflow.md)
- [Admin Portal Requirements](admin-portal-requirements.md)
- [Technical Baseline](technical-baseline.md)
- [Quickstart](quickstart.md)
- this document

Follow the GitHub workflow in `AGENTS.md`. Use the implementation issues listed
below. Do not rely on prior chat history.

## Implementation Issues

Complete the issues in order unless a later issue is strictly blocked by a
missing operator credential. Each normal implementation issue must have its own
branch, tests, PR, checks, merge, and handoff comment.

1. [#250 Event Pipeline V4: document contracts, orchestration, and regression corpus](https://github.com/apue/local-activities/issues/250)
2. [#251 Event Pipeline V4: capture bundle contract and browser cleanup](https://github.com/apue/local-activities/issues/251)
3. [#252 Event Pipeline V4: evidence extraction for posters, QR, links, and mini-program actions](https://github.com/apue/local-activities/issues/252)
4. [#254 Event Pipeline V4: LLM extraction adapter and replay harness](https://github.com/apue/local-activities/issues/254)
5. [#255 Event Pipeline V4: deterministic dedupe, update, and publish-policy contracts](https://github.com/apue/local-activities/issues/255)
6. [#256 Event Pipeline V4: orchestrator mock E2E and failure handling](https://github.com/apue/local-activities/issues/256)
7. [#257 Event Pipeline V4: admin/public rendering fixes for evidence and actions](https://github.com/apue/local-activities/issues/257)
8. [#258 Event Pipeline V4: self-contained regression corpus and replay acceptance](https://github.com/apue/local-activities/issues/258)
9. [#259 Event Pipeline V4: supervisor validation and acceptance loop](https://github.com/apue/local-activities/issues/259)

Umbrella: [#249 Event Pipeline V4 umbrella](https://github.com/apue/local-activities/issues/249).

Issue [#253](https://github.com/apue/local-activities/issues/253) is a closed
duplicate of #252 and must not be used for implementation.

## Non-Goals

- Do not bypass captchas, login checks, platform protections, account-risk
  controls, or anti-bot systems.
- Do not reintroduce Vercel Sandbox as a crawler runtime for this MVP slice.
- Do not introduce LangChain, LangGraph, or third-party APM.
- Do not write directly to Supabase from collector code.
- Do not require live WeChat crawling or live LLM calls for CI.
- Do not let eval, replay, fixture, or smoke commands publish public events by
  default.
- Do not run production-mutating migrations, cleanup, replay, publish, or seed
  commands without explicit operator approval in the current conversation.
- Do not store permanent full article mirrors as a product feature.
- Do not treat LLM confidence as a direct publication command.
- Do not add a mandatory separate triage prefilter unless
  [Event Pipeline Architecture](event-pipeline-architecture.md) is updated.

## Determinism Requirement

Only the live LLM provider call may be non-deterministic. The rest of the
pipeline must be testable through explicit input/output fixtures or fake
adapters:

```text
CaptureSource -> CapturedArticleBundle
EvidenceExtractor -> EvidenceSet
LLMEventExtractor mock -> ExtractionResult
NormalizeAndValidate -> NormalizedEventCandidate[]
DedupeResolver -> DedupeDecision
PublishPolicy -> PublishDecision
BackendIngest fake -> persisted ids/report
PipelineOrchestrator -> PipelineRunReport
```

CI-safe tests must not depend on live WeChat, live LLM calls, or hosted
production writes.

## Supervisor Loop

The supervisor owns contract and validation. The implementation agent owns
focused coding slices. The loop is:

```text
issue contract -> implementation -> supervisor review -> validation
-> if failed, write concrete fix instructions -> implementation retry
-> repeat until deterministic acceptance passes or a real blocker is documented
```

Validation failures must name:

- command or check that failed
- violated contract
- expected output
- actual output
- files or module boundaries likely involved
- constraints that must not be changed

## Validation Commands

Before V4 is considered complete, run:

```bash
pnpm test
pnpm typecheck
pnpm fixture:e2e -- --all
```

When `.env.local` is available, also run:

```bash
pnpm env:check --env-file .env.local --target local-app
pnpm smoke:admin-readonly --env-file .env.local
```

When V4 corpus/mock E2E commands are implemented, include them in the final
validation report.

Live source, live LLM, storage, hosted write, cleanup, production seed import,
and public publish commands remain operator-approved only.

## Completion Criteria

V4 is complete only when:

- all non-closed V4 implementation issues are merged or explicitly documented as
  blocked by a real external condition
- module contracts in [Event Pipeline Architecture](event-pipeline-architecture.md)
  match implementation
- regression coverage in [Regression Corpus](regression-corpus.md) has a
  deterministic replay path or a documented migration gap
- agent-browser/capture resources are closed by default
- poster, QR, link, and mini-program/action evidence are preserved through the
  pipeline contracts
- mocked LLM output can drive downstream pipeline tests
- dedupe and publish policy are deterministic under fixtures
- admin actions and public rendering consume backend state correctly
- final supervisor validation records commands, results, skipped live checks,
  and any real blockers
