# Event Pipeline V5 Phase 1 Goal Pack

本文是 Event Pipeline V5 Phase 1 的执行 contract。实现 agent 应先读
`AGENTS.md`、`docs/event-pipeline-v5-design.zh.md` 和本文，再开始编码。

## Goal

完成一条默认离线、可回放、可观测、低成本的 V5 Phase 1 pipeline harness：

```text
captured regression bundle
-> Content Cleaner
-> Signal Scorer
-> Candidate Packet Builder
-> Cheap Triage mock provider
-> Mock Full Extract Harness
-> Deterministic Validator
-> Mock Editor Pass Harness
-> Publish Trace
-> Replay artifacts
```

Phase 1 的目标不是生产发布，也不是真实多模态抽取。目标是先把节点 contract、
artifact、usage/cost placeholder、attempt trace 和 replay 能力打牢，让后续
Phase 2 可以安全接入真实模型和 Editor Agent。

## Umbrella

Umbrella issue: #302

Implementation order:

1. #303 - V5 Phase 1 goal pack and execution plan
2. #304 - V5 pipeline contracts and artifact metadata
3. #305 - V5 content cleaner, signal scorer, and candidate packet
4. #306 - V5 cheap triage providers and budget guard
5. #307 - V5 mock full extract and editor harnesses
6. #308 - V5 replay runner and artifact writer
7. #309 - V5 Phase 1 validation, docs, and handoff

## Runtime Boundary

Default Phase 1 replay is local/offline:

- reads committed public-safe regression corpus data
- writes local or memory artifacts only
- does not call WeChat
- does not call live LLM providers
- does not write Supabase production tables
- does not mutate public catalog data

Any future live provider path must require explicit opt-in flags and budget limits.
CI and default replay must remain deterministic.

## Non-goals

- Do not introduce LangChain, LangGraph, or another heavy agent/workflow framework.
- Do not implement real multimodal Full Extract.
- Do not implement real Editor Agent.
- Do not add production publication behavior.
- Do not add production-mutating Supabase writes.
- Do not reintroduce Vercel Sandbox as crawler runtime.
- Do not require live WeChat, live LLM, or private raw corpus for validation.

## Required Module Boundaries

### Contracts and Artifacts

Define the minimal Phase 1 contracts for:

- pipeline context
- node input/output metadata
- artifact pointers
- node decision and reason
- attempts trace
- usage/cost placeholder
- validation issues

Every node result must be contract-checkable and independently testable.

### Content Cleaner

Input: captured article bundle.

Output: normalized content containing title, source, publish time, markdown-ish
text, links, images, mini programs, and content stats.

This node must not decide whether the article is an event and must not call LLM.

### Signal Scorer

Input: normalized content.

Output: positive signals, negative signals, score, negative score, conservative
decision, and reason.

The scorer is a high-recall routing node. It may flag obvious negative cases, but
must preserve auditable reasons.

### Candidate Packet Builder

Input: normalized content and signal result.

Output: bounded packet text with included section names, source signal ids, and
estimated token count.

The packet must include high-information windows around dates, places,
registration, ticketing, links, mini programs, and image metadata when present.

### Cheap Triage

Input: candidate packet.

Output: decision, confidence, reason, risk flags, provider/model/prompt/schema
versions, usage/cost placeholder, latency, and attempts.

Phase 1 default uses mock provider. A live provider interface may exist, but must
fail closed unless explicitly allowed and budgeted.

### Mock Full Extract and Editor Harnesses

These harnesses are CI-safe stand-ins for Phase 2 model work. They must:

- use bounded attempts traces
- record provider/model/prompt/schema versions
- record usage/cost placeholders
- avoid DB writes
- avoid live LLM calls
- produce stable output from regression expected data when available

### Replay Runner

The replay runner must support:

- `--corpus-dir`
- `--case`
- `--all`
- `--store memory|local`
- `--artifact-dir`

Default replay runs offline with mock providers. It must output a summary and
write per-case artifacts when using local store.

## Expected Command

Add this package script:

```bash
pnpm pipeline:v5:replay -- --corpus-dir tests/regression-corpus --all --store memory
```

Local artifact mode should also work:

```bash
pnpm pipeline:v5:replay -- --corpus-dir tests/regression-corpus --all --store local
```

## Validation

Before closing #309 and #302, run:

```bash
pnpm test
pnpm typecheck
pnpm regression:replay -- --corpus-dir tests/regression-corpus --all
pnpm eval:run -- --corpus-dir tests/regression-corpus --store memory
pnpm pipeline:v5:replay -- --corpus-dir tests/regression-corpus --all --store memory
```

If implementation touches only one issue, also run its focused test command
before opening that issue's PR.

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

The final handoff on #302 must summarize:

- merged PRs
- validation commands and results
- replay command output summary
- any remaining Phase 2 work explicitly not included

