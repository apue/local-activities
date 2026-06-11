# Agent-Operable Event Pipeline 设计说明

本文定义下一阶段的产品和工程方向：把活动聚合系统做成 Codex 或其它强力
coding agent 可以自主诊断、自主实验、自主修复的系统。目标不是让 operator
每天分析 admin portal，而是让 operator 以最终用户身份提出感受和要求：

- 这周活动太少。
- 怎么发了奇怪新闻。
- 二维码没有出来。
- 重复活动太多。
- 这个活动摘要不像人写的。
- 最近整体不可用。

系统应让 agent 自己去查数据库、看 trace、生成 eval case、比较 prompt/model、
修改代码或配置、验证公开页面，并把结果交付给 operator。

## 背景

V5 已经建立了 replay、live harness、validator、publish policy、pipeline
ledger 和初步 admin visibility。它解决了“每个节点能不能被独立测试”和
“live provider 能不能受控接入”的问题。

但如果要让 Codex 独立运维产品，还缺少四类能力：

1. **可解释证据**：每次线上或 eval 失败时，agent 不应重新调用模型猜原因，
   而应直接读取该 run 的 extraction、validation、editor、policy 和 raw
   provider response。
2. **反馈 ground truth**：operator 的“这条不对”必须变成结构化反馈，而不是
   散落在聊天记录里。
3. **真实可回放样本**：从真实抓取和真实反馈导出 private corpus，避免用带
   `Expected action` / `Rationale` 的 public-safe fixture 公平评测模型。
4. **实验和发布控制面**：agent 能生成 candidate prompt/model/policy，跑
   baseline vs candidate eval，判断是否更好，再安全地应用。

## 产品目标

本阶段的用户体验目标是：

```text
operator 只看公开目录和少量反馈入口
agent 负责分析问题、提出修复、跑验证、合入或生成配置变更
```

长期希望 operator 可以这样下指令：

```text
最近一周活动太少，你去分析原因并修好。
```

agent 应能完成：

```text
读取生产/评测数据
-> 找出 failure cluster
-> 抽样并生成 private eval cases
-> 调整 prompt/model/policy 或代码
-> 跑 baseline/candidate eval
-> 检查成本和误发风险
-> 开 PR 或生成 config draft
-> 验证公开页面
-> 给 operator 结果摘要
```

## 质量和预算目标

运行约束来自当前产品目标：

- 抓取和发布频率可以是每天一次，不要求实时。
- 可以漏掉一些活动，但不希望误发太多。
- 自动发布结果中，约 10 条里最多 1 条不是活动可以接受。
- 月 token 预算目标不超过人民币 100 元。
- operator 不想分析细节，只希望最终公开页面变好。

因此默认优化目标是：

```text
auto_publish_precision >= 90%
false_positive_rate <= 10%
public_event_recall 不追求极致，但不能显著恶化
monthly_estimated_token_cost_cny <= 100
```

系统不应为了极致召回，把明显新闻、回顾、官方访问、非公众活动硬发布。
系统也不应为了避免所有误发，把大部分真实活动都卡进 review。

## 设计原则

1. **给 agent 的可操作性优先于给人的仪表盘美观**。
   Admin UI 可以展示摘要，但更重要的是有稳定 API、artifact 和 CLI。
2. **所有模型输出都是 untrusted input**。
   后端 validator、dedupe 和 publish policy 仍拥有最终解释权。
3. **每个失败必须能定位到节点**。
   不接受只知道 `needs_review`，不知道是 extractor、validator、editor 还是
   publish policy 的设计。
4. **真实评测不能泄漏答案**。
   Public regression corpus 可用于 contract smoke；严肃模型评测必须使用
   private raw corpus，expected 只能在 case metadata 中。
5. **agent 可自动实验，但生产影响要有安全边界**。
   允许自动生成 candidate、跑 eval、写 eval/test 数据；生产 active config
   和 destructive cleanup 应有明确 policy。
6. **不引入重框架作为第一反应**。
   继续使用 TypeScript、Supabase、Vercel、V5 harness 和轻量 CLI。只有当
   durable workflow 或 agent 框架解决明确问题时再引入。

## 总体架构

目标闭环：

```text
Daily capture
-> Production / eval pipeline run
-> Trace artifacts + LLM calls + usage ledger
-> Public catalog / review queue
-> Operator feedback
-> Feedback-derived private eval cases
-> Baseline vs candidate eval
-> Agent audit report
-> PR or config draft
-> Safe rollout
```

从 agent 视角，系统应提供这些入口：

- `agent:audit`：读取最近 N 天生产和 eval 数据，聚类失败。
- `agent:export-case`：从 pipeline run 或 feedback 导出 private corpus case。
- `agent:eval`：比较 baseline 和 candidate。
- `agent:propose-config`：生成 prompt/model/policy candidate。
- `agent:report`：输出人类可读但不要求 operator 分析细节的结论。

## 模块 Contract 和依赖方向

Issue 是交付切分，不是代码模块边界。为了避免细 issue 让代码变成零散胶水，
实现必须先遵守 module contract 和依赖方向，再按 issue 交付。

核心规则：

- `contracts` 定义跨模块数据结构和 schema，是其它模块共享的边界。
- `pipeline orchestrator` 只编排节点、传递 run context、记录 step 状态。
- `pipeline nodes` 只做输入到输出的业务转换，不直接写 production 表。
- `llm gateway` 只负责 provider 调用、重试、usage、error shape 和 request /
  response artifact，不决定是否发布。
- `artifact store` 只负责 artifact 读写和脱敏，不解释业务含义。
- `ledger stores` 只负责 pipeline、LLM、feedback、eval report 的持久化。
- `corpus builder` 只从 artifact/ledger/feedback 导出 case，不调用 live LLM。
- `eval runner` 复用同一套 pipeline contract，只替换 provider、store、config 和
  `data_class`。
- `admin/public UI` 只消费 API 和 canonical read models，不复制 publish policy、
  dedupe 或 validator 逻辑。

允许的依赖方向：

```text
contracts
<- stores / providers / pipeline nodes
<- pipeline orchestrator
<- API / CLI / admin UI / public UI
```

禁止方向：

- UI 直接实现 publish policy、dedupe 或 event validator。
- pipeline node 直接调用 Supabase production tables。
- eval runner 复制一份 production pipeline。
- corpus builder 把 expected labels 写进 model input。
- LLM provider adapter 返回不受 schema 校验的业务对象。

Issue 与模块的关系应是“一个 issue 扩展某个 contract 后面的实现”，而不是
“一个 issue 随意改所有层”。例如：

- LLM call ledger issue 只应触及 `llm gateway`、`ledger store` 和相关 tests。
- feedback issue 只应触及 `feedback contract`、`feedback store`、admin API/UI。
- private corpus issue 只读 artifact/ledger/feedback，不重新发明 pipeline。
- eval comparison issue 必须复用 V5 pipeline runner，不能复制 extractor/editor。
- public acceptance issue 只改 public read model/UI，不改变 event publish policy。

## Agent-Readable Observability Layer

为了让 Codex 自己判断“最近一周行为是否符合期待”，系统需要一层面向 agent 的
observability，而不是只给人看的 dashboard。

这层可以理解为：

```text
Project skill = 操作手册、判断流程、权限边界
Audit scripts = CRUD + 聚合 + evidence pack 生成，类似轻量 audit ETL
Codex = 读取事实包、推理、归因、决定修复路径
```

Audit scripts 不应该替 Codex 下最终结论。它们应稳定地产生事实、特征、候选集合
和证据入口，让 Codex 在这些高质量上下文上推理。

默认流程：

```text
agent:audit --days 7
-> audit facts
-> candidate index
-> public acceptance snapshot
-> usage summary
-> short audit brief
-> Codex reasoning
-> evidence drilldown
-> optional corpus export / eval / PR
```

建议输出：

```text
.agent-runs/<run-id>/
  audit-facts.json
  candidate-index.json
  public-snapshot.json
  usage-summary.json
  audit-brief.md
  evidence/
```

`audit-facts.json` 应覆盖：

- source volume、freshness 和 failure。
- article -> candidate -> draft -> event 的 pipeline funnel。
- published / review / excluded / failed counts。
- public homepage、Archive 和 detail visibility snapshot。
- LLM usage、cost、provider/model error。
- feedback 和 review action。

`candidate-index.json` 可以包含值得 Codex 关注的候选，但这些候选不是最终判断：

- volume shift：本周活动明显太多或太少。
- funnel drop：某个 pipeline stage 转化率异常。
- duplicate-like cluster：多个 event 可能其实是同一活动。
- update-like misclassification：更新文章可能被当成新活动。
- missing evidence：应有 poster/QR/registration 但公开结果缺失。
- provider error cluster：某个 provider/model/operation 失败集中。
- public visibility gap：DB 已发布但公开页面不可见，或详情页不可访问。
- usage spike：token 或成本异常。
- review backlog：待审核堆积。

每个 candidate 应包含：

```text
candidate_id
candidate_type
severity_hint
signals
affected_source_ids
affected_article_ids
affected_event_ids
artifact_paths
drilldown_command
```

Drilldown scripts 负责生成 evidence pack，例如：

```bash
pnpm agent:inspect-finding -- --finding-id <id>
pnpm agent:inspect-cluster -- --cluster-id <id>
pnpm agent:inspect-event -- --event-id <id>
pnpm agent:inspect-source -- --source-id <id>
```

Evidence pack 应返回相关 DB rows、pipeline steps、LLM artifacts、source bundle、
public URL snapshot、similarity signals 和 usage/error records。

Project-level skill 可以放在 `.agents/skills/local-activities-weekly-audit/`。
Skill 只描述何时运行 audit、如何阅读输出、何时 drill down、何时导出 eval case、
哪些动作需要 approval。Skill 不应复制 SQL、schema 或业务规则。

## 核心模块

### 1. Detailed Pipeline Artifacts

职责：

- 保存每个 pipeline run 的关键中间产物。
- 让 agent 不重新调用模型也能定位失败原因。
- 支持 production、eval、test、smoke data class。

每个 node 至少保存：

- input artifact pointer
- output artifact pointer
- node result
- decision / reason / confidence
- provider / model / prompt version / schema version
- usage / latency / cost
- normalized error shape

Live LLM 节点还应保存：

- sanitized request artifact
- raw response artifact
- normalized response artifact
- attempts
- repair reason
- validator issues

敏感信息要求：

- 不保存 API key、Authorization header、Cookie、登录态。
- source URL 可以保存，但公开页面不能泄漏 localhost、raw WeChat image URL
  或内部 storage signed URL。

### 2. LLM Call Ledger

现有 `llm_usage_ledger` 可以继续承担使用量统计，但 agent 需要更细粒度的
调用审计。可以扩展现表，也可以增加 `llm_calls`。

建议字段：

```text
call_id
pipeline_run_id
pipeline_step_id
article_bundle_id
data_class
operation
provider
model
prompt_version
schema_version
params
status
error_code
input_tokens
output_tokens
total_tokens
cost_micro_cny
latency_ms
request_artifact_path
response_artifact_path
created_at
```

要求：

- 每次 LLM 调用一行。
- 成功、失败、malformed JSON、provider HTTP error 都记录。
- 能按 source、model、prompt、operation、日期聚合成本和失败率。

### 3. Admin / User Feedback Ledger

operator 不需要分析 trace，但必须能表达“这条不对”。反馈必须结构化。

建议反馈类型：

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

建议字段：

```text
feedback_id
pipeline_run_id
article_bundle_id
draft_id
event_id
feedback_type
field_name
old_value
corrected_value
reason
created_by
created_at
status
```

Admin UI 最小入口：

- “这条不对”
- “不是活动”
- “不是公众活动”
- “应该发布”
- “信息错了”
- “重复”
- 自由文本说明

agent 使用这些反馈生成 eval case 和 failure cluster。

### 4. Private Corpus Builder

职责：

- 从真实 `pipeline_run_id`、`article_bundle_id` 或 feedback 导出 private eval case。
- 将 raw bundle、HTML、图片、二维码、链接、小程序 metadata 保存在本地私有目录。
- 将 expected behavior 写入 `case.json`，不混入 model input。

目录形态：

```text
private-corpus/
  manifest.json
  <case-id>/
    case.json
    captured-bundle.json
    assets/
      image-001.jpg
      qr-001.png
```

`case.json` 包含：

```text
expected_action
expected_event_count
must_have_fields
known_failure_type
source_name
source_url
created_from_feedback_id
created_from_pipeline_run_id
```

要求：

- private corpus 默认不提交 Git。
- builder 必须检查 `captured-bundle.json` 不包含 `Expected action`、
  `Rationale`、`Review/exclusion reasons` 等 evaluator leakage。
- evaluator 读取 bundle 作为 model input，读取 case metadata 作为 judge input。

### 5. Prompt / Model Config Registry

为了让 agent 可以实验 prompt/model，配置不应只散落在代码常量中。

建议数据模型：

```text
config_id
name
stage: active | candidate | archived
operation: cheap_triage | full_extract | editor_pass | judge
provider
model
prompt_version
prompt_text
schema_version
params
budget_policy
created_by
created_reason
created_at
activated_at
```

第一版可以用 repo 内 JSON/YAML 配置或数据库表。若要支持无需部署即可切换，
应放 Supabase 表并由 Edge Function / pipeline runtime 读取 active config。

安全要求：

- candidate config 可以由 agent 自动创建。
- production active config 切换要受 policy 控制。
- 每次 eval report 必须记录 baseline 和 candidate config id。

### 6. Baseline vs Candidate Evaluation

职责：

- 比较当前 active config 和 agent 生成的 candidate config。
- 输出质量、成本、延迟和回归风险。

指标：

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
latency_p50 / latency_p95
```

默认 gate：

```text
false_positive_rate <= 10%
monthly_estimated_token_cost_cny <= 100
known_bad_cases 不回归
auto_publish_precision 不低于 baseline
```

如果 candidate 更便宜但质量明显下降，不应推荐。
如果 candidate 更贵但显著降低误发，可进入 review。

### 7. Weekly Audit CLI And Report Generator

Agent 不应只能通过 admin UI 分析系统。需要 CLI 或 script 入口。

建议命令：

```bash
pnpm agent:audit -- --env-file .env.local --days 7 --output-dir .agent-runs/<run-id>
pnpm agent:inspect-finding -- --finding-id <id> --output-dir .agent-runs/<run-id>/evidence
pnpm agent:inspect-cluster -- --cluster-id <id> --output-dir .agent-runs/<run-id>/evidence
pnpm agent:inspect-event -- --event-id <id> --output-dir .agent-runs/<run-id>/evidence
pnpm agent:inspect-source -- --source-id <id> --output-dir .agent-runs/<run-id>/evidence
pnpm agent:export-case -- --pipeline-run-id <id> --output-dir <private-corpus>
pnpm agent:eval -- --corpus-dir <private-corpus> --baseline active --candidate <config-id>
pnpm agent:report -- --eval-run-id <id>
```

`agent:audit` 输出 agent-readable fact packet 和 candidate index。Drilldown
命令输出 evidence pack。`agent:report` 输出结构化 JSON + 简短 Markdown report，
方便 agent 和人都能读。

### 8. Admin Surface

Admin UI 不应要求 operator 分析复杂 trace。它只需要提供：

- 公开结果预览。
- 少量 review queue。
- 结构化反馈按钮。
- 每日质量摘要。
- 成本摘要。
- 最近 agent audit 结论。

深层 trace 和 eval report 可以隐藏在 drill-down 页面，主要给 Codex 使用。

### 9. Public Acceptance Surface

Operator 最终希望以普通用户身份判断产品是否可用。因此公开页面也必须成为
agent-operable loop 的验收面，而不能只展示“未来还没结束的活动”。

公开页面应区分三个视角：

- 首页主视角：面向用户决策，展示 upcoming / ongoing activities。
- 活动详情页：只要是 `production + published + public renderable`，即使活动已
  结束也应可访问，不能因为过期直接 404。
- 最近收录 / 全部活动 / Archive 视角：展示所有已发布活动，包括已结束活动，
  让 operator 可以回看上周或上一轮 pipeline 的实际公开结果。

重复和周期活动的展示原则：

- 用户列表展示的是可参加的 occurrence，不是简单的数据库 event row。
- 详情页表达 event series，包括所有已知 occurrences、recurrence rule 或长期
  展期。
- 连续两个周末的同一活动，优先展示为一个 series，并在详情页列出场次。
- 每周固定活动首页只展示下一次 occurrence，详情页展示 recurrence。
- 长期展览不应每天展开成重复卡片，应展示为 ongoing / date range。
- Archive 可按 `published_at` 或活动时间回看所有 published events，用于产品
  验收和反馈。

这部分不改变 publish policy。它只改变 public read model 和 UI，让已经发布的
结果可以被用户和 agent 回看。

## 权限和自动化边界

为了实现“尽量交给 Codex”，默认允许 agent 做：

- 只读 audit。
- 写 eval/test/smoke 数据。
- 写 private corpus 本地文件。
- 创建 candidate prompt/model config。
- 运行 live eval，只要显式预算不超过 operator 设定。
- 修改代码并开 PR。
- 合入通过 checks 的低风险代码 PR，如果 operator 给出 standing approval。

仍需 policy 控制的动作：

- 删除不可恢复数据。
- 大规模清理 production 数据。
- 切换 production active config。
- 批量 publish / reject 真实活动。
- 单次或单日 live eval 超预算。
- 修改 secrets。
- 绕过验证码、登录风控或平台保护。

如果 operator 明确设置 standing approval，可将部分动作自动化，但必须记录：

```text
who/agent
what changed
why
which eval report justified it
rollback path
```

## 数据流示例

### 场景 A：误发新闻

```text
operator 点击 “这条不是活动”
-> admin_feedback(not_event)
-> agent:audit 聚类 false_positive
-> agent:export-case 生成 private negative case
-> agent 修改 full_extract prompt 或 publish policy
-> agent:eval baseline vs candidate
-> candidate false_positive 降低且 recall 未明显下降
-> PR / config draft
```

### 场景 B：活动太少

```text
operator 说 “这周活动太少”
-> agent:audit 检查 source volume、triage exclude、needs_review、failed
-> 发现 cheap_triage 过严或 source 失败
-> 从 excluded 中抽样导出 case
-> 调低 triage 阈值或修 source health
-> eval 检查误发是否仍 <= 10%
-> 应用修复
```

### 场景 C：二维码缺失

```text
operator 点击 “漏二维码”
-> feedback(missing_qr)
-> 导出 raw bundle + image assets
-> eval vision-heavy subset
-> 比较 Qwen VL / GLM V / OCR pre-pass
-> 选择更稳且成本可控方案
```

## 测试策略

默认 CI：

- 不调用 live WeChat。
- 不调用 live LLM。
- 不写 production Supabase。
- 使用 fake provider、fixture bundle、temporary private corpus。

必要测试：

- module contract tests。
- schema migration test。
- artifact writer/reader test。
- LLM call ledger redaction test。
- feedback API test。
- private corpus builder leakage test。
- baseline/candidate eval comparison test。
- agent audit packet fixture test。
- evidence drilldown fixture test。
- project weekly audit skill smoke test。
- admin feedback UI API test。
- public acceptance surface test。

V5 regression gate：

- V5 replay 不回归。
- V5 eval 不回归。
- publish policy blocker 行为不回归，除非 goal 明确要求改变。
- public event rendering contract 不回归；若产品行为改变，必须有新测试覆盖。
- production、eval、test、smoke 复用同一 pipeline 代码，只替换 provider、store、
  config 和 `data_class`。

Live smoke：

- 需要 `--allow-live` 和预算。
- 只跑小 corpus。
- 写 eval/test data 或本地 artifacts。
- 不作为 CI 必需项。

## 与现有 V5 的关系

本设计不替代 V5，而是在 V5 的可回放节点和 ledger 基础上增加 agent control
plane。V5 继续提供：

- node contracts
- replay runner
- live harness
- validator
- publish policy
- pipeline ledger

本阶段增加：

- 更完整的 live artifacts。
- structured feedback。
- private corpus builder。
- prompt/model config registry。
- baseline/candidate eval report。
- weekly audit fact packet。
- evidence drilldown scripts。
- agent audit CLI。
- project weekly audit skill。

## 非目标

- 不让 LLM 直接写生产表。
- 不让 Codex 绕过微信或其它平台保护。
- 不把 private corpus 提交到公开 repo。
- 不要求 operator 长期人工标注大量数据。
- 不引入复杂 agent framework 作为第一版依赖。
- 不承诺完全自动发现所有 false negative；只能通过抽样、反馈和 source audit
  持续改善。

## 第一阶段成功标准

第一阶段完成后，operator 应能说：

```text
最近效果不好，你去查原因并修。
```

agent 应能在不依赖聊天历史的情况下：

1. 读取最近运行记录和反馈。
2. 找出主要失败类别。
3. 导出或选择代表性 eval cases。
4. 生成 prompt/model/policy candidate。
5. 跑 baseline vs candidate。
6. 判断是否满足质量和预算目标。
7. 开 PR 或生成 config draft。
8. 给 operator 一个最终效果摘要。
