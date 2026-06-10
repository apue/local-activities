# Event Pipeline V5 设计草案

本文是 V5 方向讨论文档，不是最终 implementation plan，也不是 issue
清单。它的目标是把前面讨论过的“低成本漏斗 + agentic Full Extract +
Editor Pass + 每个节点可 replay”整理成一个清晰的产品和工程边界，方便后续
再收敛成 `/goal`。

## 背景

当前 pipeline 已经能围绕 Wechat2RSS、本地/云端处理、Supabase、Vercel 和
evaluation runner 运行，但仍有几个明显问题：

- 直接把完整内容交给高阶多模态模型成本较高，也不利于定位错误。
- 公众号文章里大量内容不是活动，如果每篇都 full extract，会浪费模型调用。
- 纯 extractor 只能抽字段，不能很好地生成用户可读的活动文案。
- 活动质量问题需要可解释、可复盘，而不是只看最终 draft。
- 一旦某一步判断错误，需要能从该节点重新 replay，而不是从头重新爬公众号。
- 项目目标不只是“可靠地抽取活动”，还包括在真实业务场景里探索 agentic
  pipeline、模型自检修复、harness engineering 和持续 eval。

V5 的核心方向是：把 pipeline 拆成一组边界清晰、可独立测试、可独立 replay
的节点；用低成本、可解释的前置节点完成路由和上下文整理；把复杂判断交给
受约束的 agentic Full Extract 和 Editor Pass；用 replay/eval harness 比较
不同模型、prompt、repair loop 和成本表现。

## 目标

- 降低 LLM 成本：大部分明显 negative 的文章不进入 expensive full extract。
- 保持高召回：早期过滤必须保守，避免活动被静默误杀。
- 探索 agent 能力：在 Full Extract 和 Editor Pass 中使用受控的生成、校验、
  反思、修正循环，而不是只做一次性字段抽取。
- 提升用户侧内容质量：发布结果不只是字段抽取，而是可读、顺畅、有标签。
- 提升可调试性：每个节点的输入、输出、错误、成本都可以查看和 replay。
- 提升可评估性：能系统比较 text-only、multimodal、single-pass、repair-loop、
  不同模型和不同 prompt 的效果。
- 保持模块化：每个节点都有明确 contract，可以单独替换实现。
- 保持数据卫生：公开仓库不提交完整微信公众号 HTML 和图片资产。
- 保持后端权威：LLM 和 agent 输出仍是 untrusted input，最终写库和发布由
  backend policy 决定。

## 非目标

- 不引入 LangChain / LangGraph 作为核心依赖。
- 不在第一版训练自有 NLP 模型。
- 不让 Editor Agent 自主写库、直接发布或直接删除生产数据。
- 不绕过微信验证码、登录风控或平台保护。
- 不把 Vercel 作为微信爬虫运行时。
- 不把完整公众号文章镜像或图片资产提交到公开仓库。
- 不把 agent 设计成可以任意使用工具、任意改库、不可复现的自由代理。
- 不追求第一版完全自动发布所有 case。V5 更重要的是把 pipeline 变得可观察、
  可回放、可评估、可迭代。

## 术语表

| 术语 | 中文解释 |
| --- | --- |
| Raw Bundle | 原始抓取包。来自 Wechat2RSS 或其它 capture worker，包含 HTML、文本、图片引用、链接、小程序、来源信息等。 |
| Normalized Content | 清洗后的正文内容。通常包含标题、来源、发布时间、Markdown 正文、链接、图片元数据、小程序等。 |
| Signal Scoring | 信号打分。用规则和正则从正文里找日期、时间、地点、报名、票务、回顾、外地等信号。 |
| Candidate Packet | 候选信息包。把一篇文章压缩成便宜模型可判断的高信息密度文本。 |
| Cheap Triage | 低成本初筛。用小模型判断文章是否可能是活动，是否需要继续处理。 |
| Full Extract | 完整抽取。用较强模型或多模态模型从正文、图片证据、OCR 中抽取活动事实字段。V5 中它可以是受控的 agentic harness。 |
| Validator | 确定性校验器。用代码检查日期是否过期、地点是否缺失、是否外地、字段是否矛盾等。 |
| Editor Pass | 编辑处理节点。生成用户可读文案、标签、分类，并根据校验问题做受约束修正。V5 中它可以是受控的 editorial loop。 |
| Publish Policy | 发布策略。根据抽取、校验、编辑结果决定 publish、review、exclude、needs_info 等。 |
| Ledger | 流水账。记录每篇文章每个节点发生了什么、为什么、花了多少 token、失败在哪里。 |
| Replay | 回放。用已保存的输入重新运行某个节点或某段 pipeline，用来调试和评估。 |
| Harness | 测试和编排外壳。负责给模型准备输入、限制循环次数、运行校验、保存中间产物、统计成本。 |
| Repair Loop | 修复循环。模型先生成结果，Validator 或 Judge 找问题，再让模型带着问题重读原文并修正，循环次数有上限。 |
| Ralph-style Loop | 本文暂用来指“生成 -> 评价/批判 -> 修正 -> 再验证”的受控循环。它不是自由 agent，而是 harness 内部有预算和次数限制的工作流。 |

## 目标 Pipeline

V5 的目标数据流如下：

```text
Raw Bundle
-> Content Cleaner
-> Signal Scorer
-> Candidate Packet Builder
-> Cheap Triage
-> Full Extract Harness
-> Deterministic Validator
-> Editor Pass Harness
-> Publish Policy
-> Ledger / Drafts / Events / Admin / Public UI
```

每一步都应该有：

- 明确输入 contract。
- 明确输出 contract。
- 明确错误类型。
- 明确是否允许调用外部服务。
- 明确是否允许写生产数据。
- 明确最大循环次数和成本预算，如果该节点包含模型 repair loop。
- replay 能力。

## 节点设计

### 1. Content Cleaner

职责：

- 从 Raw Bundle 中提取正文。
- 优先定位微信公众号正文区域，例如 `#js_content`。
- 清理无关脚本、样式、分享组件、噪声节点。
- 转换为结构化 Markdown。
- 保留链接、图片占位、小程序和来源 metadata。

建议输出：

```json
{
  "title": "...",
  "sourceName": "...",
  "publishedAt": "...",
  "markdown": "...",
  "links": [],
  "images": [],
  "miniPrograms": [],
  "contentStats": {
    "textLength": 1234,
    "imageCount": 3,
    "linkCount": 2
  }
}
```

技术选择：

- Node.js 内用 Cheerio 解析 HTML。
- 微信页面优先用 `#js_content`。
- Readability / jsdom 可作为 fallback，不作为第一优先级。
- Turndown 或等价工具用于 HTML 转 Markdown。

设计要点：

- Cleaner 不判断“是不是活动”。
- Cleaner 不做 LLM 调用。
- Cleaner 不丢弃图片信息，只把图片变成后续节点能理解的 metadata 或占位符。

### 2. Signal Scorer

职责：

- 在 Normalized Content 中提取活动相关信号。
- 给文章打一个可解释的候选分。
- 给 cheap triage 和 admin ledger 提供判断依据。

第一版建议使用规则和正则，不训练 NLP 模型。

典型 positive signals：

- 日期：`2026年6月15日`、`6月15日`、`周六`、`Friday`。
- 时间：`19:00`、`下午3点`、`10:00-18:00`。
- 地点：`地址`、`地点`、`venue`、`北京市`。
- 参与动作：`报名`、`预约`、`扫码`、`购票`、`register`、`RSVP`。
- 票务：`门票`、`早鸟票`、`免费入场`、`限额`。
- 活动词：`讲座`、`放映`、`展览`、`工作坊`、`市集`、`festival`。
- 小程序或外部链接。

典型 negative signals：

- `回顾`、`新闻`、`访问`、`会见`、`声明`、`发布会通稿`。
- 明确外地城市。
- 明确仅限特定内部人群。
- 只有历史介绍、人物介绍、政策信息，没有参与动作。

建议输出：

```json
{
  "score": 7,
  "negativeScore": 1,
  "decision": "likely_event",
  "signals": [
    { "type": "date", "text": "6月15日", "weight": 2 },
    { "type": "registration", "text": "扫码报名", "weight": 3 }
  ],
  "negativeSignals": [],
  "reason": "包含日期、地点和报名动作"
}
```

设计要点：

- Signal Scorer 是高召回节点，不应激进丢弃。
- 明显 negative 可以提前 exclude，但必须写 ledger reason。
- 更常见的输出应是 `possible`，交给 Cheap Triage。

### 3. Candidate Packet Builder

职责：

- 把 Normalized Content 压缩成低成本模型适合判断的输入。
- 避免机械截取“前 800 字 + 后 800 字”导致漏掉中间关键信息。

Candidate Packet 应包含：

- 标题。
- 来源账号。
- 发布时间。
- 首段或摘要。
- 所有 signal 命中的上下文窗口。
- 所有日期/时间附近的上下文窗口。
- 所有地点/地址附近的上下文窗口。
- 所有报名/票务/二维码/小程序附近的上下文窗口。
- 链接列表和小程序信息。
- 图片 alt/caption/nearby text。
- 末尾报名或联系方式区域。

建议输出：

```json
{
  "packetText": "...",
  "includedSections": [
    "title",
    "first_paragraphs",
    "date_windows",
    "registration_windows",
    "links",
    "mini_programs"
  ],
  "sourceSignalIds": [],
  "estimatedTokens": 1200
}
```

设计要点：

- Candidate Packet 是压缩层，不做最终判断。
- Packet 生成应 deterministic，可单测。
- Packet 应有长度上限，避免 cheap triage 失去成本优势。

### 4. Cheap Triage

职责：

- 用低成本模型判断文章是否值得进入 Full Extract。
- 输入 Candidate Packet，不输入完整 HTML。

建议输出：

```json
{
  "decision": "candidate",
  "confidence": 0.86,
  "needsVision": false,
  "reason": "包含明确时间、地点和报名方式",
  "riskFlags": []
}
```

可能 decision：

- `candidate`：进入 Full Extract。
- `non_event`：排除，但写 ledger。
- `uncertain`：进入 Full Extract 或 admin review，取决于成本策略。
- `needs_vision`：文本不足，但图片可能包含活动信息，优先进入多模态 Full
  Extract Harness。

设计要点：

- Cheap Triage 不直接发布。
- Cheap Triage 的 false negative 是最大风险，所以阈值应保守。
- 所有 non_event 决策必须可审计，可抽样复查。
- `needs_vision` 不是人工审核结论，而是后续模型路由信号。

### 5. Full Extract Harness

职责：

- 从 Normalized Content、完整 Markdown、图片证据、OCR 文本或可消费图片资产中
  抽取活动事实。
- 处理单活动、多活动、长期展览、重复场次、报名方式、费用、主办方等。
- 对 image-heavy、long poster、unresolved QR 这类 case 路由到更强模型或多模态
  模型。
- 在 Validator 发现问题时，允许模型重读相关原文片段或图片证据并进行受控修正。

建议输出：

```json
{
  "decision": "event",
  "events": [
    {
      "title": "...",
      "startsAt": "...",
      "endsAt": "...",
      "venue": "...",
      "address": "...",
      "organizer": "...",
      "registrationAction": "...",
      "registrationUrl": "...",
      "evidence": [],
      "provenance": {}
    }
  ],
  "confidence": 0.91,
  "reason": "...",
  "attempts": [
    {
      "attempt": 1,
      "model": "...",
      "mode": "text_or_multimodal",
      "validatorIssues": [],
      "cost": {}
    }
  ]
}
```

设计要点：

- Full Extract 应尽量忠于原文。
- 它负责事实抽取和必要的事实修正，不负责润色成用户最终文案。
- 核心字段应尽量带 provenance，例如原文片段或证据位置。
- 它可以是 agentic loop，但必须是 bounded loop：
  - 有最大尝试次数。
  - 有成本预算。
  - 每次尝试都有输入、输出、校验结果和模型用量 artifact。
  - 不直接写库。
  - 不直接发布。
- `needs_vision` 不等于人工审核。它优先表示：需要把该文章路由到多模态
  Full Extract 或 OCR/vision fallback。

推荐内部流程：

```text
Prepare extraction input
-> Attempt 1: text-only or multimodal structured extraction
-> Deterministic Validator
-> if issues are repairable:
     build repair prompt with source windows + issues
     Attempt 2: repair extraction result
     validate again
-> final ExtractionResult
```

示例：

- 正文说“请扫描下方二维码报名”，但二维码图片没有被解析出来：
  - Signal / Packet 标记 `registration_qr_not_resolved`。
  - Full Extract Harness 使用图片证据或 OCR/vision 尝试解决。
  - 如果仍无法解决，输出 `registrationAction = qr_required_unresolved`，交给
    Publish Policy 决定是否 review。
- 文章是长图：
  - Signal / Packet 标记 `image_heavy_article`。
  - Full Extract Harness 走 multimodal/OCR 路径，而不是直接 needs_review。

### 6. Deterministic Validator

职责：

- 用代码检查结构化结果是否自洽。
- 把明显问题变成机器可读的 validation issues。

典型检查：

- 活动时间是否已经过去。
- 是否缺少开始时间。
- 是否缺少地点或线上参与方式。
- 是否是北京范围外。
- 是否明显是活动回顾。
- 是否仅限内部或特定职业/国籍/邀请人群。
- 多活动文章是否拆分合理。
- 报名方式是否可解释。

建议输出：

```json
{
  "status": "valid",
  "issues": [
    {
      "code": "event_already_ended",
      "severity": "hard",
      "message": "活动结束时间早于当前日期"
    }
  ]
}
```

设计要点：

- Validator 不调用 LLM。
- Validator 不自行改写字段。
- Validator 的输出可以触发 Editor Pass 重新审视。

### 7. Editor Pass Harness

职责：

- 把事实字段转成用户可读的活动内容。
- 做深度分类和标签化。
- 根据 Validator issues 做受约束修正或建议。
- 给 publish/review/exclude 提供编辑理由。
- 通过 rubric 或 judge pass 检查文案是否忠于原文、是否足够易读、是否适合
  public catalog。

Editor Pass 输入：

- Normalized Content。
- Extraction Result。
- Validation Issues。
- 固定 taxonomy。
- 当前产品范围。

建议输出：

```json
{
  "editorDecision": "publish",
  "displayTitle": "...",
  "summary": "...",
  "tags": ["film", "culture_exchange"],
  "audience": "general_public",
  "qualityIssues": [],
  "corrections": [],
  "reason": "...",
  "attempts": [
    {
      "attempt": 1,
      "rubricResult": {},
      "revisions": []
    }
  ]
}
```

设计要点：

- Editor Pass 是 bounded editorial loop，不是自由自主 agent。
- Editor Pass 不直接写库。
- 标签必须从固定 taxonomy 中选择，不能随意发明。
- Editor 可以建议修正，但最终仍要再次经过 Validator 或 Publish Policy。
- Editor 可以重写标题、摘要、标签和注意事项，但不能创造没有 provenance 的事实。
- Editor 的质量判断应当可评估，例如：
  - 忠实度：是否忠于原文和 extraction result。
  - 可读性：用户是否能快速理解活动内容。
  - 完整性：时间、地点、报名、费用、受众是否表达清楚。
  - 产品适配：是否适合北京本地活动 catalog。

推荐内部流程：

```text
Draft display content
-> Judge/editor rubric check
-> if quality issues are repairable:
     revise display content once
-> final EditorResult
```

Editor Pass 的目标不是替代 Publish Policy，而是把 extractor 的事实结果加工成
更像“编辑部产物”的内容，并给后端策略提供更好的解释依据。

### 8. Publish Policy

职责：

- 根据前面所有节点结果决定最终状态。

可能状态：

- `published`
- `needs_review`
- `needs_info`
- `excluded`
- `duplicate`
- `failed`

设计要点：

- Publish Policy 是后端确定性逻辑，不是 LLM 自己决定。
- 高置信 publish 可以允许，但必须满足 validator、editor、dedupe 和证据要求。
- 每个 excluded / review / failed 都写 ledger。

## Replay 设计

V5 的关键能力是每个节点都能 replay。

Replay 不只是调试工具，也是 harness engineering 的核心。它应该支持比较不同
模型、prompt、schema、repair loop 和路由策略。每次 replay 都应保存中间
artifact，这样我们可以判断一次改动究竟改善了哪一步，还是只是把错误转移到了
后续节点。

目标命令形态可以是：

```bash
pnpm pipeline:replay -- --stage clean --article-id <id>
pnpm pipeline:replay -- --stage signal --article-id <id>
pnpm pipeline:replay -- --stage packet --article-id <id>
pnpm pipeline:replay -- --stage triage --article-id <id>
pnpm pipeline:replay -- --stage extract --article-id <id>
pnpm pipeline:replay -- --stage editor --article-id <id>
```

也可以支持从本地 corpus replay：

```bash
pnpm pipeline:replay -- --corpus-dir <path> --case <case-id> --stage signal
```

Replay 原则：

- 默认不调用 live WeChat。
- 默认不调用 live LLM。
- 默认不写 production。
- 所有 LLM 节点都必须有 mock provider，用于 CI、deterministic replay 和 contract
  测试。
- 所有 LLM 节点也应支持 live provider，用于显式开启的 local eval、smoke 或
  production 路径。
- 每个节点的输入输出都可以保存为 artifact。
- 可以从某个节点开始 replay，不必从头爬取。
- replay 输出必须包含 contract validation 结果。
- 对包含模型调用的节点，replay 必须记录模型、prompt version、schema version、
  token usage、cost、latency、attempts 和 repair reason。
- live replay 必须显式开启，并带预算上限。

建议 artifact 结构：

```text
artifacts/<run-id>/<article-id>/
  raw-bundle.json
  normalized-content.json
  signal-score.json
  candidate-packet.json
  triage-result.json
  extraction-result.json
  extraction-attempts.json
  validation-result.json
  editor-result.json
  editor-attempts.json
  publish-decision.json
```

生产环境里同样概念可以落到 Supabase：

- `pipeline_runs`
- `pipeline_steps`
- `pipeline_artifacts`
- `llm_usage_ledger`

具体表结构后续实现前再定。

## Evaluation 设计

V5 的 evaluation 目标不是只看“最终有没有通过”，还要能回答：

- 哪个节点开始出错？
- 小模型 triage 是否误杀了活动？
- Full Extract single-pass 和 repair-loop 哪个更好？
- text-only 和 multimodal 在长图/二维码 case 上差多少？
- Editor Pass 是否提升了用户可读性，是否引入了事实夸大？
- 每种策略的成本和延迟是多少？

建议评价维度：

- 召回：真实活动是否进入 Full Extract。
- 精确：非活动是否被排除。
- 字段准确性：时间、地点、报名、费用、主办方是否正确。
- 多活动拆分：multi-event article 是否拆成正确数量。
- 公众可参与判断：是否排除内部/非公众/外地/回顾。
- 视觉能力：海报、二维码、长图是否被正确利用。
- 编辑质量：标题、摘要、标签是否忠实、易读、可用。
- 成本：每篇文章、每个节点、每个成功发布 event 的 token 成本。

其中字段准确性和分类判断可以用 reference-based scoring；编辑质量更适合
pairwise 或 rubric-based LLM-as-judge。所有 LLM-as-judge 结果都应保留理由，
不能只保留分数。

## 数据和 Corpus

需要区分三类数据：

### 公开 regression corpus

位置仍然可以是 `tests/regression-corpus`。

用途：

- contract 测试。
- deterministic replay。
- mock eval。

限制：

- 不提交完整微信公众号 HTML。
- 不提交图片、二维码、海报资产。
- 不作为 live vision 质量评测集。

### 私有 raw corpus

用途：

- 测试 Content Cleaner。
- 测试图片/长图/二维码/海报处理。
- 测试 live vision model。

限制：

- 留在本地或私有 storage。
- 不进入公开仓库。

### 生产数据

用途：

- 真实 pipeline 运行。
- admin 审核。
- public catalog。

要求：

- 使用 `data_class` 隔离 production、eval、test、smoke。
- 所有 early exclude 也要写 ledger。
- 不允许测试数据污染 public catalog。

## Admin Portal 需要看到什么

V5 后，admin portal 不应该只看到最终 draft，而应该能看到 pipeline 状态：

- 原文来源和抓取状态。
- Cleaner 输出摘要。
- Signal Score 和命中的 signals。
- Candidate Packet。
- Cheap Triage 结果。
- Full Extract 结果。
- Validator issues。
- Editor Pass 输出。
- Publish Policy 决策。
- token usage 和模型信息。
- replay 某一步的入口。

第一版 admin 可以先做只读展示；涉及重新运行、改写、发布、删除的操作需要更严格权限和测试。

## 技术栈建议

| 模块 | 建议 |
| --- | --- |
| 语言 | TypeScript |
| Runtime | Supabase Edge Functions + Node 本地 runner |
| HTML 解析 | Cheerio |
| 正文 fallback | Readability + jsdom |
| HTML 转 Markdown | Turndown |
| Contract validation | Zod |
| Signal Scorer | 自研规则和正则 |
| Candidate Packet | 自研 builder |
| Cheap Triage | 低成本文本模型节点；CI 使用 mock provider，本地 eval / smoke / production 使用可配置 live provider |
| Full Extract Harness | 结构化输出模型 + 可选 multimodal/OCR + bounded repair loop |
| Editor Pass Harness | 结构化输出模型 + rubric/judge + bounded revision loop |
| Replay | 自研 runner + artifact 存储 |
| Evaluation | reference scoring + rubric scoring + pairwise comparison |
| 测试 | Vitest + corpus replay |
| Storage | Supabase Storage |
| DB | Supabase Postgres |
| 前端 | Vercel / Next.js admin + public UI |

## 阶段性落地建议

为了减少跑偏，建议分两阶段。

### Phase 1：默认不依赖 live LLM 的 pipeline 和 harness 基建

- Content Cleaner contract。
- Signal Scorer。
- Candidate Packet Builder。
- Replay Harness。
- Cheap Triage provider abstraction。
- Cheap Triage mock provider，用于 CI 和 deterministic replay。
- Cheap Triage live provider 接口，用于显式开启的本地低成本模型 eval。
- Mock Full Extract Harness，包括 attempts artifact。
- Mock Editor Pass Harness，包括 rubric artifact。
- 文档和测试。

验收重点：

- 至少能从现有 corpus 跑通
  `clean -> signal -> packet -> mock triage -> mock extract -> mock editor`。
- 每个节点都有独立测试。
- 每个节点都有 artifact。
- 能看到每个 mock harness 的 attempts trace。
- 能用显式 `allow-live` 和预算参数运行 Cheap Triage 的真实低成本 provider smoke
  或 local eval。
- CI 和默认 replay 不调用 live LLM。
- 不写 production。

这里的“不依赖 live LLM”指默认 CI 和默认 replay 路径。Cheap Triage 作为漏斗
关键节点，Phase 1 就应具备真实低成本模型验证路径；只是 live 路径必须显式开启，
并且不作为 CI 依赖。

### Phase 2：接入真实模型、agentic loop 和 admin visibility

- Cheap Triage 基于 Phase 1 的 live provider 结果调阈值、成本和路由策略。
- Full Extract Harness 接高阶文本/多模态模型。
- Full Extract Harness 支持 validator-triggered repair loop。
- Editor Pass Harness 接编辑模型和 rubric/judge。
- Validator 和 Publish Policy 完善。
- Pipeline step 数据入库。
- Admin portal 展示每一步。
- 受控 replay 操作。

验收重点：

- 能用私有 raw corpus 做 live eval。
- 能看到每篇文章每一步为什么被保留、排除或待审。
- 能比较 single-pass、repair-loop、text-only、multimodal 等策略。
- 能统计每个节点成本和失败率。

## 需要后续确认的边界

这些不是当前文档必须解决的问题，但在写 `/goal` 前需要确认：

- Signal Scorer 的 direct exclude 阈值有多保守。
- Cheap Triage 用哪个低成本模型。
- Full Extract 和 Editor Pass 是否使用同一个模型。
- Full Extract 的 repair loop 第一版最大尝试次数。
- Editor Pass 的 rubric 第一版包含哪些维度。
- Editor Pass 的 taxonomy 第一版包含哪些 tag。
- Replay artifact 是优先落本地文件，还是优先落 Supabase。
- Admin portal 第一版是否只读，还是允许手动 replay。
- 私有 raw corpus 放在哪里，如何避免被误提交。

## 总结

V5 的核心不是多加几个模型调用，也不是把项目做成传统 ETL。它的目标是把
pipeline 从“单次黑盒抽取”升级为“可观察、可回放、可替换、可评估的 agentic
编辑流水线”。

前置节点负责路由、降成本和上下文整理；Full Extract Harness 负责忠实抽取、
多模态理解和受控修正；Validator 负责确定性质量检查；Editor Pass Harness
负责把事实变成用户可读内容并进行编辑质量判断；Publish Policy 负责最终状态
决策。每个节点都必须留下可 replay 的输入输出和 attempts trace，这样未来模型、
prompt、规则、repair loop 或页面结构变化时，我们可以定位具体是哪一步出了
问题，并系统比较不同 agentic 策略的收益和成本。
