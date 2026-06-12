# Eval Preview Review Loop Goal Pack

本文是 Eval Preview Review Loop 的执行 contract。实现 agent 应先读
`AGENTS.md`、`docs/agent-operable-event-pipeline.zh.md`、
`docs/event-pipeline-architecture.md` 和本文。不要依赖聊天历史。

## 目标

实现一套可复用的 live eval review loop：regression corpus 可以调用 live LLM
跑完整 pipeline，结果写入 `eval` scope，并通过复用正式公开页组件的 preview
页面供人工 review。Codex 后续可以基于 eval metrics、structured feedback、
artifacts 和 issue/PR handoff 完成诊断、修复、重跑和对比。

## 核心架构约束

```text
production / eval / test / smoke 共享 pipeline、DB shape、read model 和 UI component。
区别只来自 scope，不来自分叉实现。
```

硬性要求：

- 不实现独立的 eval pipeline。
- 不实现独立的 eval event UI。
- Eval preview 只能通过 scoped read model 读取数据。
- Live eval 默认写 `data_class = eval`，并绑定 `eval_run_id`。
- Production public pages 默认不读取 eval 数据。

## 模块

### 1. Scoped Pipeline Persistence

统一 pipeline 写入接口，概念上是：

```text
persistPipelineResult(result, scope)
```

`scope` 至少包含：

```text
data_class
eval_run_id optional
config_id optional
corpus_version optional
```

同一套写入逻辑应支持 production、eval、test、smoke。Eval 写入同一套表，如
`canonical_events`、`event_drafts`、`evidence_assets`、`processing_ledger` 和
`llm_usage_ledger`。

### 2. Eval Run Registry

每次 eval 形成稳定记录：

```text
eval_run_id
corpus_version
provider / model
prompt_version / schema_version
config_id
status
started_at / completed_at
total_usage
summary metrics
artifact paths
preview url
```

### 3. Metrics Layer

在现有 FP/FN、accuracy、cost、latency 基础上补齐：

```text
qr_extraction_success_rate
poster_extraction_success_rate
registration_success_rate
multi_event_split_accuracy
duplicate_update_accuracy
human_feedback_count
human_reject_rate
```

指标来自 corpus expected metadata、pipeline output 和 feedback ledger。

### 4. Scoped Public Read Model

公开 read model 支持 scope 参数：

```text
listPublicEvents(scope)
getPublicEvent(scope, eventId)
```

Production 默认行为保持不变。Eval preview 使用：

```text
{ dataClass: "eval", evalRunId }
```

### 5. Shared Public UI

抽出或确认复用正式 public card/detail 组件。Production 首页、archive、detail 与
eval preview 使用同一套 event shape 和组件。

### 6. Eval Preview Surface

增加 admin preview 页面：

```text
/admin/eval-runs/<evalRunId>/preview
/admin/eval-runs/<evalRunId>/events/<eventId>
```

页面展示 eval run metadata、metrics、event list、event detail。活动展示必须复用
正式 public UI。

### 7. Structured Feedback

Preview 页面支持对 eval event/article 提交反馈：

```text
not_event
not_public
should_publish
missing_event
wrong_time
wrong_location
missing_registration
missing_qr
duplicate_event
bad_summary
bad_category_or_tags
other
```

Feedback 关联 `eval_run_id`、`case_id`、`event_id`、`article_bundle_id`。Feedback
不直接修改 canonical event。

### 8. Skill Checklist

更新 `.agents/skills/local-activities-weekly-audit/SKILL.md`，加入 Live Eval
Review Loop：

```text
选择 corpus
跑 live eval
生成 eval_run_id
写入 eval scope
打开 preview
收集 feedback
读取 metrics/artifacts/feedback
归因并开 issue/PR
修复后重跑同一 corpus
对比 baseline vs candidate
```

### 9. Agent Report

`agent:report` 输出 eval review summary：

```text
eval_run_id
preview url
key metrics
failed cases
feedback summary
likely root causes
recommended fixes
follow-up issues / PRs
```

## 非目标

- Live eval 默认不写入 production。
- 不建设独立 BI/分析 portal；本阶段只做 review loop 所需的最小 preview 和
  feedback surface。

## 验收标准

- Eval 和 production 写入复用同一套 persistence path。
- Eval 和 production 展示复用同一套 public event shape 和 UI component。
- Eval 数据不会出现在 production 首页、archive 或 detail 查询中。
- Eval summary 输出 QR、poster、registration 等新增指标。
- Preview feedback 能写入并关联 eval run。
- Skill 能让新 Codex session 在没有聊天历史的情况下执行 review loop。
- 默认测试不调用 live LLM，不写 production。

最终验证：

```bash
pnpm test
pnpm typecheck
pnpm agent:regression-gate
```

## 完成后下一步

完成本 goal pack 后，再执行一次已批准的 live LLM test：选定 corpus、模型、预算
和 env，跑 live eval，打开 preview，由 operator 做人工 review，Codex 基于 metrics
和 feedback 做诊断。
