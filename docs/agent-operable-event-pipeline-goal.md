# Agent-Operable Event Pipeline Phase 1 Goal Pack

本文是 Agent-Operable Event Pipeline Phase 1 的执行 contract。实现 agent
应先读 `AGENTS.md`、`docs/agent-operable-event-pipeline.zh.md`、
`docs/event-pipeline-architecture.md`、`docs/event-pipeline-v5-design.zh.md`
和本文。不要依赖聊天历史。

## 目标

把当前 V5 event pipeline 扩展为 Codex 或其它强力 coding agent 可以自主诊断、
自主实验、自主修复的系统。operator 只需要以最终用户身份提出问题，agent
应能基于数据库、artifact、feedback 和 eval report 找原因、提出候选修复、
验证并交付结果。

Phase 1 不要求完全自动化生产 rollout；它的目标是建立 agent 可以安全操作的
控制面：

```text
Detailed pipeline artifacts
-> LLM call ledger
-> Structured feedback
-> Private corpus builder
-> Prompt/model config registry
-> Baseline vs candidate eval
-> Agent audit CLI
-> Admin feedback surface
```

## 产品约束

- 系统每天抓取和发布一次即可，不要求实时。
- 自动发布 precision 优先，目标 false positive rate 不超过 10%。
- 可以漏掉一部分活动，但不能因为过度保守导致公开目录长期没有内容。
- 月 token 预算目标为人民币 100 元以内。
- operator 不应被要求分析 trace、prompt、模型输出或数据库细节。

## 运行边界

默认验证路径：

- 不调用 live WeChat。
- 不调用 live LLM。
- 不写 production Supabase 数据。
- 使用 fixture、fake provider、temporary private corpus。

Live smoke 必须显式开启：

- `--allow-live`
- 正数预算。
- provider/model/API key 配置。
- `data_class` 不得默认为 production。

生产影响动作必须受 policy 控制：

- destructive cleanup
- production active config 切换
- 批量 publish / reject
- secrets 修改
- 超预算 live eval

## 非目标

- 不引入 LangChain、LangGraph 或重型 agent framework。
- 不让 LLM 直接写 Supabase production 表。
- 不绕过验证码、登录风控或平台保护。
- 不把 private raw corpus、完整微信 HTML 或图片资产提交到公开 repo。
- 不要求 CI 调 live LLM 或 live WeChat。
- 不把 admin portal 做成给 operator 深度分析 trace 的主要工具；深层信息主要给
  agent 使用。

## 实施任务切分

实现 agent 应在 umbrella issue 下创建并按顺序完成以下 issues。每个 issue
必须独立可测试，遵循 `AGENTS.md` 的 GitHub workflow：

```text
issue -> branch -> implementation -> tests -> PR -> checks -> merge -> handoff
```

建议切分：

1. Agent-operable goal pack 和 schema 计划。
2. 详细 live artifact 持久化。
3. LLM 调用 ledger 和 usage/error audit。
4. 结构化 admin feedback ledger。
5. 基于 pipeline run 和 feedback 的 private corpus builder。
6. Prompt/model config registry。
7. Baseline vs candidate eval comparison。
8. Agent audit CLI 和 report generator。
9. Admin feedback 与质量摘要界面。
10. 最终验证和 handoff。

## 必备能力

### 1. Detailed Live Artifact Persistence

当前问题：

V5 eval 可以告诉 agent 某个 case 失败，但不总能解释失败原因。agent 经常需要
重新调用 live model 才能检查 extraction/editor 的细节，这会浪费预算，也让
debug 变得不可复现。

必需行为：

- 每次 live Full Extract 都写入 request、raw response、normalized response、
  attempts、validator issues 和 usage artifacts。
- 每次 live Editor Pass 都写入 request、raw response、normalized response、
  attempts、quality issues 和 usage artifacts。
- Publish Policy 写入最终 decision、reasons 和 source step references。
- 每个 case 的 eval artifact 必须包含足够信息，用于判断失败来自：
  provider error、malformed JSON、extraction issue、validator issue、
  editor issue、dedupe issue 或 publish policy issue。

验收标准：

- 失败的 live eval case 可以只通过 artifacts 诊断，不需要重新调用 LLM。
- 测试使用 fake provider，并断言 artifact 内容。
- artifacts 必须脱敏 API key、Authorization header、Cookie 和其它 secrets。

### 2. LLM Call Ledger

必需行为：

- 每次 LLM 调用持久化一行记录。
- 记录 pipeline run、step、provider、model、prompt version、schema version、
  params、token usage、cost、latency、status、error code、request artifact path、
  response artifact path 和 data class。
- 提供 admin/API 读取路径，供 agent audit 使用。

验收标准：

- 成功、provider HTTP error、malformed JSON、budget exceeded 和 timeout-like
  failure 都在确定性测试中被记录。
- Ledger 可以按 data class、date range、provider、model、operation、status
  和 source/article 过滤。
- Raw prompts/responses 只能通过 admin/agent 认证路径访问，不能出现在公开页面。

### 3. Structured Admin Feedback Ledger

必需反馈类型：

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

必需行为：

- Feedback 可关联 `pipeline_run_id`、`article_bundle_id`、`draft_id` 和
  `event_id`，如果这些 id 存在。
- Feedback 记录 old value、corrected value、field name、reason、created by
  和 status。
- Admin UI 提供简单反馈动作。operator 不应被要求查看 trace 内部细节。

验收标准：

- Admin 可以从 draft/event/article 视图提交结构化反馈。
- Feedback 会出现在 article/detail admin 视图中。
- Feedback API 校验 enum values 和 data class。
- 测试证明 feedback 写入不会修改 canonical event state，除非另有明确的
  publish/reject 动作。

### 4. Private Corpus Builder

必需行为：

- 可以从 `pipeline_run_id`、`article_bundle_id` 或 `feedback_id` 导出一个
  private corpus case。
- 导出 raw bundle、HTML/text、image assets、links、mini-program metadata 和
  source metadata。
- expected behavior 只能写入 `case.json`。
- 防止 evaluator labels 泄漏进 model input。

必需泄漏检查：

- `captured-bundle.json` 不能包含：
  - `Expected action`
  - `Rationale`
  - `Review/exclusion reasons`
  - `expectedAction`
  - `expected_event`
  - 其它已知 judge-only markers

验收标准：

- Builder 生成兼容 V5 eval 的 corpus 目录。
- Builder 拒绝或清洗泄漏的 judge labels。
- Builder 默认不把 private assets 写入 Git 跟踪路径。
- 测试使用临时目录和 fixture bundles。

### 5. Prompt / Model Config Registry

必需行为：

- 为 `cheap_triage`、`full_extract`、`editor_pass` 和可选 judge/eval operations
  引入 prompt/model config 记录。
- 支持 stages：
  - `active`
  - `candidate`
  - `archived`
- 记录 provider、model、prompt version、prompt text、schema version、params、
  budget policy、created reason 和 activation metadata。

验收标准：

- Candidate config 可以通过 API/CLI 创建，且不影响 production。
- Active config lookup 必须确定性，并受 data class scope 约束。
- Production active config 切换必须是单独的显式动作，并记录由哪个 eval report
  支撑。
- 测试覆盖 invalid params 和 missing prompt/schema fields。

### 6. Baseline vs Candidate Eval Comparison

必需行为：

- 在选定 corpus 上比较 baseline config 和 candidate config。
- 支持已提交的 public-safe corpus，用于 contract smoke。
- 支持 private raw corpus，用于公平的模型评测。
- 输出 structured report 和 local/Supabase eval artifacts。

必需指标：

```text
case_count
action_accuracy
final_state_accuracy
auto_publish_precision
false_positive_rate
false_negative_rate
needs_review_rate
public_event_recall
non_event_precision
qr_extraction_success_rate
poster_extraction_success_rate
duplicate_accuracy
cost_per_article
cost_per_published_event
latency_p50
latency_p95
```

默认推荐门槛：

```text
false_positive_rate <= 10%
monthly_estimated_token_cost_cny <= 100
known_bad_cases 不回归
auto_publish_precision >= baseline
```

验收标准：

- 只有通过 gates 的 candidate 才能标记为 `recommended`。
- Report 按 case id 和 failure type 标识回归。
- 测试比较两个 fake variants，并断言 recommendation 行为。

### 7. Agent Audit CLI

必需命令：

```bash
pnpm agent:audit -- --env-file .env.local --days 7
pnpm agent:export-case -- --pipeline-run-id <id> --output-dir <private-corpus>
pnpm agent:eval -- --corpus-dir <private-corpus> --baseline active --candidate <config-id>
pnpm agent:report -- --eval-run-id <id>
```

必需行为：

- `agent:audit` 汇总 source volume、publish/review/exclude/failed counts、
  top failure categories、feedback clusters、model cost 和 candidate next
  actions。
- `agent:export-case` 委托给 private corpus builder。
- `agent:eval` 委托给 baseline/candidate eval。
- `agent:report` 输出 Markdown 和 JSON summaries。

验收标准：

- CLI 在测试中可使用 fake/local stores。
- 除非显式允许，CLI 拒绝 production mutation flags。
- Reports 包含足够信息，让一个 Codex session 能判断下一步该修什么。

### 8. Admin Feedback And Quality Summary Surface

必需行为：

- 在 admin draft/event/article 页面添加简单 feedback controls。
- 添加紧凑质量摘要：
  - daily article count
  - published count
  - needs review count
  - excluded count
  - failed count
  - feedback count
  - token cost
  - recent audit report status
- Deep trace view 可以保持为次级页面。

验收标准：

- Admin user 可以一两次点击加可选备注提交反馈。
- 公开页面不得暴露 feedback、prompts、raw model responses 或 trace internals。
- Mobile admin layout 保持可用。

## 数据和存储要求

- Production、eval、test 和 smoke data classes 必须保持显式。
- Private corpus output 默认写入被 Git 忽略的本地路径。
- Supabase Storage 中 raw bundles 和 evidence assets 的路径必须分离。
- Request/response artifacts 持久化前必须脱敏。
- Agent-generated reports 应有稳定 ID，并能按日期和 config pair 查询。

## 测试要求

最终完成前至少运行：

```bash
pnpm test
pnpm typecheck
pnpm pipeline:v5:replay -- --corpus-dir tests/regression-corpus --all --store memory
pnpm pipeline:v5:eval -- --corpus-dir tests/regression-corpus --all --store memory
```

每个 issue 的专项验证应包含：

- 新 schema 的 migration tests。
- LLM ledger 和 artifacts 的 fake provider tests。
- feedback APIs 的 route handler tests。
- corpus builder leakage tests。
- eval comparison tests。
- CLI tests。
- admin portal API/UI tests。

Live smoke 可选，且必须显式启用预算：

```bash
pnpm pipeline:v5:eval -- \
  --corpus-dir <private-corpus> \
  --all \
  --store local \
  --variant live-configured \
  --allow-live \
  --max-cost-cny 10 \
  --env-file .env.local
```

## 交接要求

每个 implementation issue 都必须收到：

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

最终 umbrella handoff 必须总结：

- 已合并 PR。
- schema changes。
- new commands。
- validation results。
- live smoke results，如果有。
- 剩余 production rollout risks。
- operator 如何要求 Codex audit 和改善系统。

## 完成标准

Phase 1 完成标准：

1. Agent 可以检查最近 pipeline runs 和 LLM calls，不需要重新调用模型。
2. Operator feedback 是结构化的，并与 pipeline/event records 关联。
3. Agent 可以把真实 case 导出到 private corpus，且不把 expected labels 泄漏进
   model input。
4. Agent 可以比较 baseline 和 candidate prompt/model configs。
5. Agent 可以生成包含具体 next actions 的 audit report。
6. Admin 暴露简单 feedback 和 quality summary controls。
7. 默认验证不依赖 live WeChat 或 live LLM，并且可以通过。
8. 系统保留 destructive 和 production-active changes 的安全边界。
