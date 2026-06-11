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
-> Weekly audit fact packet
-> Evidence drilldown interfaces
-> Project weekly audit skill
-> Agent audit CLI
-> Admin feedback surface
-> Public acceptance surface
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

1. Module contract、依赖方向和 V5 regression gate。
2. 详细 live artifact 持久化。
3. LLM 调用 ledger 和 usage/error audit。
4. 结构化 admin feedback ledger。
5. 基于 pipeline run 和 feedback 的 private corpus builder。
6. Prompt/model config registry。
7. Baseline vs candidate eval comparison。
8. Weekly audit fact packet 和 evidence drilldown interfaces。
9. Project weekly audit skill。
10. Agent audit CLI 和 report generator。
11. Admin feedback 与质量摘要界面。
12. Public acceptance surface。
13. 最终验证和 handoff。

## 模块边界硬约束

实现 agent 必须先遵守 `docs/agent-operable-event-pipeline.zh.md` 中的 module
contract 和依赖方向。Issue 切分不能成为绕过模块边界的理由。

硬性要求：

- 所有跨模块数据结构必须先进入 `contracts` 或同等 schema 层。
- production、eval、test、smoke 必须复用同一套 pipeline 代码，只替换
  provider、store、config 和 `data_class`。
- `pipeline orchestrator` 不得直接拼 prompt、调用 provider 或写 production 表。
- `pipeline nodes` 不得直接写 production Supabase tables。
- `llm gateway` 不得决定 publish/reject，只能返回受 schema 校验的 provider
  result、usage 和 error shape。
- `eval runner` 不得复制 extractor/editor/publish policy 逻辑。
- `admin/public UI` 不得复制 publish policy、dedupe 或 validator 逻辑。
- 每个实现 PR 必须在说明中写明触及的 module contract，以及是否新增或修改
  contract tests。

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

### 7. Weekly Audit Fact Packet And Drilldown Interfaces

必需命令：

```bash
pnpm agent:audit -- --env-file .env.local --days 7 --output-dir .agent-runs/<run-id>
pnpm agent:inspect-finding -- --finding-id <id> --output-dir .agent-runs/<run-id>/evidence
pnpm agent:inspect-cluster -- --cluster-id <id> --output-dir .agent-runs/<run-id>/evidence
pnpm agent:inspect-event -- --event-id <id> --output-dir .agent-runs/<run-id>/evidence
pnpm agent:inspect-source -- --source-id <id> --output-dir .agent-runs/<run-id>/evidence
```

必需行为：

- `agent:audit` 生成 agent-readable audit packet，而不是替 Codex 下最终诊断。
- 默认只读 production/eval/test/smoke 数据，不执行 production mutation。
- 输出目录至少包含：
  - `audit-facts.json`
  - `candidate-index.json`
  - `public-snapshot.json`
  - `usage-summary.json`
  - `audit-brief.md`
- `audit-facts.json` 覆盖 source health、pipeline funnel、published/review/excluded/
  failed counts、public visibility、usage/cost、provider errors、feedback。
- `candidate-index.json` 只记录值得 Codex 推理的候选，不记录不可追溯的最终结论。
- 每个 candidate 包含 `candidate_id`、`candidate_type`、`severity_hint`、`signals`、
  affected ids、artifact paths 和 drilldown command。
- Drilldown commands 生成 evidence pack，包含相关 DB rows、pipeline steps、LLM
  artifacts、source bundle、public URL snapshot、similarity signals 和 usage/error
  records。

建议 candidate types：

```text
volume_shift
funnel_drop
possible_duplicate_cluster
possible_update_misclassified_as_new
missing_evidence_assets
provider_error_cluster
public_visibility_gap
usage_spike
review_backlog
```

验收标准：

- Codex 可以只通过 audit packet 判断下一步应该 drill down 哪些候选。
- Drilldown evidence pack 能让 Codex 归因到 source/capture、extractor、editor、
  dedupe、publish policy、public UI 或 provider/model。
- 候选生成逻辑不把 `severity_hint` 当成最终根因。
- 测试使用 fake/local stores，断言输出 schema、candidate links 和 evidence paths。
- 默认命令不写 production 数据。

### 8. Project Weekly Audit Skill

必需行为：

- 新增或更新 project-level skill，例如：
  `.agents/skills/local-activities-weekly-audit/SKILL.md`。
- Skill 描述何时触发 weekly audit，例如用户说“最近一周表现如何”“活动太少”
  “误发很多”“你自己查一下系统哪里不正常”。
- Skill 引导 Codex 读取本文档、运行 `agent:audit`、阅读 audit packet、选择
  drilldown、必要时导出 private corpus 和运行 eval。
- Skill 明确权限边界：
  - 允许只读 audit、drilldown、case export、non-production eval、开 issue/PR。
  - 不允许默认清 production、切 active config、批量 publish/reject、超预算 live
    eval 或修改 secrets。
- Skill 不复制 SQL、schema、prompt 或业务规则；这些必须留在 repo contracts、
  scripts 和文档中。

验收标准：

- Codex 在没有聊天历史的情况下，能根据 skill 和 repo docs 完成一次只读 weekly
  audit。
- Skill 正确引用 audit scripts 和相关 docs。
- Skill 保持精简，不把详细 schema 或 SQL 粘进 `SKILL.md`。

### 9. Agent Audit Report Generator

必需命令：

```bash
pnpm agent:export-case -- --pipeline-run-id <id> --output-dir <private-corpus>
pnpm agent:eval -- --corpus-dir <private-corpus> --baseline active --candidate <config-id>
pnpm agent:report -- --eval-run-id <id>
```

必需行为：

- `agent:export-case` 委托给 private corpus builder。
- `agent:eval` 委托给 baseline/candidate eval。
- `agent:report` 把 audit/eval/finding artifacts 汇总成 Markdown 和 JSON summaries。

验收标准：

- CLI 在测试中可使用 fake/local stores。
- 除非显式允许，CLI 拒绝 production mutation flags。
- Reports 包含足够信息，让一个 Codex session 能判断下一步该修什么。

### 10. Admin Feedback And Quality Summary Surface

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

### 11. Public Acceptance Surface

当前问题：

公开首页如果只展示 upcoming events，operator 就无法以普通用户身份回看上一轮
pipeline 是否误发、漏图、重复或摘要质量差。详情页如果对已结束 event 直接
404，也会让历史公开结果无法验收。

必需行为：

- 首页主视角继续优先服务用户决策，展示 upcoming / ongoing activities。
- 新增或调整一个公开可访问的最近收录 / 全部活动 / Archive 视角，展示所有
  `production + published + public renderable` events，包括已结束活动。
- event detail 只要满足 `production + published + public renderable` 就可访问，
  不应因为活动已结束而 404。
- 列表需要能表达 event series 和 occurrences：
  - 单次活动显示单个时间。
  - 连续两个周末的同一活动优先显示为一个 series，详情页列出场次。
  - 每周固定活动首页显示下一次 occurrence，详情页显示 recurrence。
  - 长期展览显示 date range / ongoing，不按天展开为重复卡片。
- 这部分只能改 public read model、formatting 和 UI，不改变 publish policy。

验收标准：

- 已结束但 published 的 public event 在详情页可访问。
- Archive/全部活动视角能看到已结束 published events。
- 首页不会被历史活动淹没，仍然优先展示 upcoming / ongoing。
- recurring、multi-day、long-running events 在列表和详情中有清晰可读的时间表达。
- 测试覆盖 upcoming、ended、recurring、multi-day、long-running 和 duplicate-like
  series 的 public rendering 行为。

## 数据和存储要求

- Production、eval、test 和 smoke data classes 必须保持显式。
- Private corpus output 默认写入被 Git 忽略的本地路径。
- Supabase Storage 中 raw bundles 和 evidence assets 的路径必须分离。
- Request/response artifacts 持久化前必须脱敏。
- Agent-generated reports 应有稳定 ID，并能按日期和 config pair 查询。

## 测试要求

V5 regression gate 是硬门槛。Phase 1 是在 V5 contract 上扩展，不是回退或另起一套
pipeline。任何实现 issue 在合并前都必须证明：

- V5 replay 行为不回归。
- V5 eval 行为不回归。
- publish policy blocker 行为不回归，除非本 goal pack 明确要求改变。
- public event rendering contract 不回归；如果产品行为改变，必须有新测试覆盖。
- 新模块通过 contract 接入，不复制 production pipeline 逻辑。

最终完成前至少运行：

```bash
pnpm test
pnpm typecheck
pnpm pipeline:v5:replay -- --corpus-dir tests/regression-corpus --all --store memory
pnpm pipeline:v5:eval -- --corpus-dir tests/regression-corpus --all --store memory
```

每个 issue 的专项验证应包含：

- module contract tests，覆盖新增或修改的跨模块 schema。
- 新 schema 的 migration tests。
- LLM ledger 和 artifacts 的 fake provider tests。
- feedback APIs 的 route handler tests。
- corpus builder leakage tests。
- eval comparison tests。
- audit packet schema tests，覆盖 `audit-facts.json`、`candidate-index.json`、
  `public-snapshot.json` 和 `usage-summary.json`。
- evidence drilldown tests，覆盖 finding、cluster、event 和 source inspection。
- CLI tests。
- project weekly audit skill smoke test，验证 skill 引用正确命令和权限边界。
- admin portal API/UI tests。
- public acceptance surface tests，覆盖首页、详情页和 Archive/全部活动视角。

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

1. 新增能力遵守 module contract 和依赖方向，没有复制 production pipeline 逻辑。
2. V5 regression gate 通过，已有 replay、eval、publish policy 和 public
   rendering contract 不回归。
3. Agent 可以检查最近 pipeline runs 和 LLM calls，不需要重新调用模型。
4. Operator feedback 是结构化的，并与 pipeline/event records 关联。
5. Agent 可以把真实 case 导出到 private corpus，且不把 expected labels 泄漏进
   model input。
6. Agent 可以比较 baseline 和 candidate prompt/model configs。
7. `agent:audit` 可以生成 weekly audit fact packet 和 candidate index，供 Codex
   自己判断异常是否成立。
8. Drilldown commands 可以生成 evidence pack，供 Codex 归因和决定修复路径。
9. Project weekly audit skill 可以在无聊天历史情况下指导 Codex 完成一次只读审计。
10. Agent 可以生成包含具体 next actions 的 audit report。
11. Admin 暴露简单 feedback 和 quality summary controls。
12. 公开页面支持用户决策和历史回看：upcoming/ongoing 不被历史活动淹没，已结束
   published events 仍可通过详情页和 Archive/全部活动视角验收。
13. 默认验证不依赖 live WeChat 或 live LLM，并且可以通过。
14. 系统保留 destructive 和 production-active changes 的安全边界。
