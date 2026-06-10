# Event Pipeline V5 Phase 2 Goal Pack

本文是 Event Pipeline V5 Phase 2 的执行 contract。实现 agent 应先读
`AGENTS.md`、`docs/event-pipeline-v5-design.zh.md`、`docs/event-pipeline-architecture.md`
和本文，再开始编码。不要依赖聊天历史。

## Goal

在 Phase 1 离线 replay harness 的基础上，完成 V5 的真实模型接入边界和可观测
评估基础设施：

```text
Regression / private raw corpus
-> V5 Replay artifacts
-> V5-native Evaluation
-> Live-capable Full Extract Harness
-> Deterministic Validator v2
-> Repair Loop
-> Live-capable Editor Pass Harness
-> Publish Policy v2
-> Pipeline run/step/artifact ledger
-> Admin read visibility
```

Phase 2 的目标不是直接跑生产数据，也不是让 CI 依赖真实模型。目标是把真实模型、
repair loop、evaluation、ledger 和 admin visibility 的代码边界打通，让后续
production orchestration 可以替换 mock harness 而不改 replay/eval/admin 的契约。

## Umbrella

Umbrella issue: #319

Implementation order:

1. #320 - V5 Phase 2 goal pack and execution contract
2. #321 - V5-native evaluation runner
3. #322 - V5 live Full Extract and Editor harnesses
4. #323 - V5 Validator v2 and Publish Policy v2
5. #324 - V5 pipeline artifacts ledger and admin visibility
6. #325 - V5 private corpus and live smoke support
7. #326 - V5 Phase 2 final validation and handoff

## Runtime Boundary

Default Phase 2 validation remains local/offline:

- reads committed public-safe regression corpus data
- writes memory or local artifacts only
- does not call WeChat
- does not call live LLM providers
- does not write Supabase production tables
- does not mutate public catalog data

Live model paths may exist, but must require all of:

- explicit `--allow-live`
- explicit positive `--max-cost-cny`
- configured provider/model/API key
- non-production default `dataClass`

## Non-goals

- Do not introduce LangChain, LangGraph, or another heavy workflow framework.
- Do not reintroduce reset-era `eval:run` or `regression:replay`.
- Do not reintroduce Vercel Sandbox as crawler runtime.
- Do not run live WeChat crawling in CI.
- Do not run live LLM calls in CI.
- Do not mutate production Supabase data without explicit operator approval in
  the current conversation.
- Do not bypass captcha, login, or platform protections.

## Required Module Boundaries

### V5-native Evaluation

Input: corpus cases and V5 replay outputs/artifacts.

Output: evaluation run summary with per-case result, score dimensions, usage,
cost, latency, false-positive count, false-negative count, and artifact paths.

Default variants must be deterministic mocks. Live variants must fail closed
without explicit allow-live and budget flags.

### Live Provider Adapter

Provider calls must be injected behind a small interface. The adapter records:

- provider
- model
- prompt version
- schema version
- usage
- latency
- raw provider error shape

The adapter must support OpenAI-compatible chat completions because Alibaba
Cloud, SiliconFlow, Moonshot-compatible gateways, and GLM-compatible gateways can
all expose that style.

### Full Extract Harness

Input: normalized content, candidate packet, cheap triage result, and optional
image evidence metadata.

Output: structured extraction result:

- event/non-event decision
- one event per activity
- public eligibility
- schedule fields
- venue/registration/evidence fields
- confidence and reasons
- attempts and usage

The harness may run a bounded repair loop after Validator v2 reports fixable
issues.

### Deterministic Validator v2

Validator v2 is code-only and must not call LLM. It checks:

- public eligibility
- Beijing/not-Beijing
- event vs news/official visit/recap/internal item
- starts/ends schedule sanity
- recurring and long-running schedule shape
- venue or online attendance path
- registration status and URL/QR evidence consistency
- required publish fields

It returns hard issues, soft issues, and repairable issues.

### Editor Pass Harness

Input: extraction result and Validator v2 result.

Output: display title, summary, tags, category, audience note, corrections,
quality issues, and editor decision.

Editor Pass may use a model, but it must not overwrite facts without
traceable corrections. It must record attempts, usage, and prompt/schema
versions.

### Publish Policy v2

Publish Policy v2 maps extraction + validation + editor outputs to:

- `published`
- `needs_review`
- `needs_info`
- `excluded`
- `failed`

It owns final publication state for replay/eval/admin trace. LLM/editor outputs
remain untrusted.

### Pipeline Ledger And Admin Visibility

Add schema and read APIs for V5 pipeline runs, steps, artifacts, attempts, and
usage summaries. Admin UI Phase 2 is read-only:

- show run id and article/case id
- show step order
- show decision/reason/status
- show provider/model/prompt/schema
- show token/cost/latency
- show validation issues
- show artifact paths

No rerun or mutation UI is required in Phase 2.

### Private Corpus And Live Smoke

Private local corpora may include full HTML and image assets. They must stay out
of the public repo. CLI docs must show how to run live smoke with `--allow-live`
and budget flags, but CI must use mock variants.

## Expected Commands

Phase 2 adds:

```bash
pnpm pipeline:v5:eval -- --corpus-dir tests/regression-corpus --all --store memory
```

Existing replay remains:

```bash
pnpm pipeline:v5:replay -- --corpus-dir tests/regression-corpus --all --store memory
```

Live smoke examples may be documented, but must not be required by CI:

```bash
pnpm pipeline:v5:eval -- --corpus-dir /path/to/private-corpus --all --store local --variant live-configured --allow-live --max-cost-cny 10 --env-file .env.local
```

## Validation

Before closing #326 and #319, run:

```bash
pnpm test
pnpm typecheck
pnpm pipeline:v5:replay -- --corpus-dir tests/regression-corpus --all --store memory
pnpm pipeline:v5:eval -- --corpus-dir tests/regression-corpus --all --store memory
```

Issue-specific PRs must also run focused tests for touched modules.

## Handoff Requirements

Every issue must receive a handoff comment:

```markdown
## Handoff - YYYY-MM-DD

Done:
- ...

Validated:
- `command`

Open:
- ...

Next:
- ...
```

The final handoff on #319 must summarize:

- merged PRs
- validation commands and results
- V5 replay summary
- V5 eval summary
- any remaining production orchestration work explicitly not included
