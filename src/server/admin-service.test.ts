import { describe, expect, it } from "vitest";

import type { AdminCollectorJobRecord } from "./admin-collector-jobs";
import {
  AdminDraftPublishBlockedError,
  createAdminFeedback,
  getAdminEventDraftDetail,
  listAdminFeedback,
  listAdminExcludedArticles,
  listAdminEvaluationRuns,
  listAdminLlmUsageSummary,
  listAdminPipelineRuns,
  listAdminPromptModelConfigs,
  listAdminProcessingLedger,
  listAdminEventDrafts,
  markAdminEventDraftNeedsInfo,
  promoteAdminExcludedArticle,
  publishAdminEventDraft,
  rejectAdminEventDraft,
  resolveAdminLlmUsageRange,
  activateAdminPromptModelConfig,
  createAdminPromptModelConfig,
  getAdminActivePromptModelConfig,
  type AdminExcludedArticleRecord,
  type AdminEventDraftRecord,
  type AdminEvaluationRunRecord,
  type AdminFeedbackInput,
  type AdminFeedbackRecord,
  type AdminPipelineRunRecord,
  type AdminPromptModelConfigActivationInput,
  type AdminPromptModelConfigCreateInput,
  type AdminPromptModelConfigRecord,
  type AdminProcessingLedgerRecord,
  type AdminStore,
} from "./admin-service";

class MemoryAdminStore implements AdminStore {
  jobs: AdminCollectorJobRecord[] = [];
  drafts = new Map<string, AdminEventDraftRecord>();
  excludedArticles = new Map<string, AdminExcludedArticleRecord>();
  ledgerRows: AdminProcessingLedgerRecord[] = [];
  evaluationRuns: AdminEvaluationRunRecord[] = [];
  evaluationRunsInput?: Parameters<AdminStore["listEvaluationRuns"]>[0];
  promptModelConfigs: AdminPromptModelConfigRecord[] = [];
  promptModelConfigInput?: Parameters<AdminStore["listPromptModelConfigs"]>[0];
  createdPromptModelConfigInput?: AdminPromptModelConfigCreateInput;
  activePromptModelConfigInput?: Parameters<AdminStore["getActivePromptModelConfig"]>[0];
  activatedPromptModelConfigInput?: AdminPromptModelConfigActivationInput;
  pipelineRuns: AdminPipelineRunRecord[] = [];
  pipelineRunsInput?: Parameters<AdminStore["listPipelineRuns"]>[0];
  feedbackRows: AdminFeedbackRecord[] = [];
  feedbackInput?: Parameters<AdminStore["listFeedback"]>[0];
  createdFeedbackInput?: AdminFeedbackInput;
  llmUsageInput?: Parameters<AdminStore["getLlmUsageSummary"]>[0];
  llmUsageSummary = {
    range: {
      key: "today" as const,
      label: "Today",
      startsAt: "2026-06-03T16:00:00.000Z",
    },
    latestRecordedAt: "2026-06-04T02:05:00.000Z",
    totals: {
      requestCount: 2,
      successCount: 1,
      errorCount: 1,
      inputTokens: 1400,
      outputTokens: 450,
      totalTokens: 1850,
      costMicroCny: 3200,
    },
    byModel: [
      {
        provider: "openai",
        model: "gpt-5-mini",
        operation: "event_extraction",
        workload: "event_extraction",
        environment: "production_collector",
        requestCount: 2,
        totalTokens: 1850,
        costMicroCny: 3200,
      },
    ],
    byEnvironment: [
      {
        environment: "production_collector",
        requestCount: 2,
        successCount: 1,
        errorCount: 1,
        totalTokens: 1850,
        costMicroCny: 3200,
        latestRecordedAt: "2026-06-04T02:05:00.000Z",
      },
    ],
    byRun: [
      {
        runId: "run-1",
        environment: "production_collector",
        requestCount: 2,
        totalTokens: 1850,
        costMicroCny: 3200,
        latestRecordedAt: "2026-06-04T02:05:00.000Z",
      },
    ],
    recent: [],
  };
  publishedEvents: Array<{ draftId: string; title: string }> = [];

  constructor(
    drafts: AdminEventDraftRecord[] = [],
    excludedArticles: AdminExcludedArticleRecord[] = [],
  ) {
    for (const draft of drafts) this.drafts.set(draft.id, cloneDraft(draft));
    for (const article of excludedArticles) {
      this.excludedArticles.set(article.id, article);
    }
  }

  async listCollectorJobs() {
    return this.jobs;
  }

  async listEventDrafts(input: { reviewState?: string }) {
    const drafts = Array.from(this.drafts.values());
    if (!input.reviewState) return drafts;
    return drafts.filter((draft) => draft.reviewState === input.reviewState);
  }

  async getEventDraft(draftId: string) {
    return this.drafts.get(draftId) ?? null;
  }

  async updateEventDraftReviewState(
    draftId: string,
    reviewState: AdminEventDraftRecord["reviewState"],
    options?: { reason?: string },
  ) {
    const draft = this.drafts.get(draftId);
    if (!draft) return null;
    draft.reviewState = reviewState;
    if (options?.reason) draft.operatorOverrideReason = options.reason;
    return draft;
  }

  async updateEventDraftFields(
    draftId: string,
    patch: Partial<AdminEventDraftRecord>,
  ) {
    const draft = this.drafts.get(draftId);
    if (!draft) return null;
    const updated = { ...draft, ...patch };
    this.drafts.set(draftId, updated);
    return updated;
  }

  async listExcludedArticles(input: {
    processingState?: AdminExcludedArticleRecord["processingState"];
  }) {
    const articles = Array.from(this.excludedArticles.values());
    if (!input.processingState) return articles;
    return articles.filter(
      (article) => article.processingState === input.processingState,
    );
  }

  async listProcessingLedger(input: {
    state?: AdminProcessingLedgerRecord["state"];
    dataClass?: AdminProcessingLedgerRecord["dataClass"];
  }) {
    return this.ledgerRows.filter(
      (row) =>
        (!input.state || row.state === input.state) &&
        (!input.dataClass || row.dataClass === input.dataClass),
    );
  }

  async listEvaluationRuns(input: {
    status?: AdminEvaluationRunRecord["status"];
    validity?: AdminEvaluationRunRecord["validity"];
  }) {
    this.evaluationRunsInput = input;
    return this.evaluationRuns.filter(
      (run) =>
        (!input.status || run.status === input.status) &&
        (!input.validity || run.validity === input.validity),
    );
  }

  async listPromptModelConfigs(input: Parameters<AdminStore["listPromptModelConfigs"]>[0]) {
    this.promptModelConfigInput = input;
    return this.promptModelConfigs.filter(
      (config) =>
        (!input.dataClass || config.dataClass === input.dataClass) &&
        (!input.operation || config.operation === input.operation) &&
        (!input.stage || config.stage === input.stage),
    );
  }

  async createPromptModelConfig(input: AdminPromptModelConfigCreateInput) {
    this.createdPromptModelConfigInput = input;
    const config: AdminPromptModelConfigRecord = {
      configId: "pmc-1",
      dataClass: input.dataClass,
      operation: input.operation,
      stage: "candidate",
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion,
      promptText: input.promptText,
      schemaVersion: input.schemaVersion,
      params: input.params ?? {},
      budgetPolicy: input.budgetPolicy ?? {},
      createdReason: input.createdReason,
      createdBy: input.createdBy,
      metadata: input.metadata ?? {},
      createdAt: "2026-06-11T11:00:00.000Z",
      updatedAt: "2026-06-11T11:00:00.000Z",
    };
    this.promptModelConfigs.unshift(config);
    return config;
  }

  async getActivePromptModelConfig(input: Parameters<AdminStore["getActivePromptModelConfig"]>[0]) {
    this.activePromptModelConfigInput = input;
    return this.promptModelConfigs.find(
      (config) =>
        config.dataClass === input.dataClass &&
        config.operation === input.operation &&
        config.stage === "active",
    ) ?? null;
  }

  async activatePromptModelConfig(input: AdminPromptModelConfigActivationInput) {
    this.activatedPromptModelConfigInput = input;
    const config = this.promptModelConfigs.find(
      (candidate) =>
        candidate.configId === input.configId &&
        candidate.dataClass === input.dataClass &&
        candidate.operation === input.operation,
    );
    if (!config) return null;
    for (const candidate of this.promptModelConfigs) {
      if (
        candidate.dataClass === input.dataClass &&
        candidate.operation === input.operation &&
        candidate.stage === "active" &&
        candidate.configId !== input.configId
      ) {
        candidate.stage = "archived";
      }
    }
    config.stage = "active";
    config.activationEvalRunId = input.evalRunId;
    config.activationReason = input.activationReason;
    config.activatedAt = input.activatedAt;
    config.updatedAt = input.activatedAt;
    return config;
  }

  async listPipelineRuns(input: Parameters<AdminStore["listPipelineRuns"]>[0]) {
    this.pipelineRunsInput = input;
    return this.pipelineRuns.filter(
      (run) =>
        (!input.status || run.status === input.status) &&
        (!input.dataClass || run.dataClass === input.dataClass),
    );
  }

  async getLlmUsageSummary(input: Parameters<AdminStore["getLlmUsageSummary"]>[0]) {
    this.llmUsageInput = input;
    return {
      ...this.llmUsageSummary,
      range: input.range,
    };
  }

  async listFeedback(input: Parameters<AdminStore["listFeedback"]>[0]) {
    this.feedbackInput = input;
    return this.feedbackRows.filter(
      (row) =>
        (!input.dataClass || row.dataClass === input.dataClass) &&
        (!input.draftId || row.draftId === input.draftId) &&
        (!input.eventId || row.eventId === input.eventId) &&
        (!input.articleBundleId ||
          row.articleBundleId === input.articleBundleId) &&
        (!input.pipelineRunId || row.pipelineRunId === input.pipelineRunId) &&
        (!input.status || row.status === input.status),
    );
  }

  async createFeedback(input: AdminFeedbackInput) {
    this.createdFeedbackInput = input;
    const feedback: AdminFeedbackRecord = {
      id: "feedback-1",
      dataClass: input.dataClass,
      feedbackType: input.feedbackType,
      pipelineRunId: input.pipelineRunId,
      articleBundleId: input.articleBundleId,
      draftId: input.draftId,
      eventId: input.eventId,
      fieldName: input.fieldName,
      oldValue: input.oldValue,
      correctedValue: input.correctedValue,
      reason: input.reason,
      createdBy: input.createdBy,
      status: "open",
      metadata: input.metadata ?? {},
      createdAt: "2026-06-11T10:00:00.000Z",
      updatedAt: "2026-06-11T10:00:00.000Z",
    };
    this.feedbackRows.unshift(feedback);
    return feedback;
  }

  async promoteExcludedArticle(excludedArticleId: string, promotedAt: string) {
    const article = this.excludedArticles.get(excludedArticleId);
    if (!article) return null;
    article.processingState = "promoted_to_extraction";
    article.promotedAt = promotedAt;
    return article;
  }

  async publishEventDraft(input: {
    draft: AdminEventDraftRecord;
    publishedAt: string;
  }) {
    this.publishedEvents.push({
      draftId: input.draft.id,
      title: input.draft.title ?? "",
    });
    return {
      id: `event-${this.publishedEvents.length}`,
      title: input.draft.title ?? "",
      status: "published" as const,
      publishedAt: input.publishedAt,
    };
  }
}

function cloneDraft(draft: AdminEventDraftRecord): AdminEventDraftRecord {
  return {
    ...draft,
    evidenceAssetIds: [...draft.evidenceAssetIds],
    fieldEvidence: { ...draft.fieldEvidence },
    hardBlockers: draft.hardBlockers?.map((blocker) => ({ ...blocker })),
    softBlockers: draft.softBlockers?.map((blocker) => ({ ...blocker })),
    publicSignals: draft.publicSignals ? [...draft.publicSignals] : undefined,
    exclusionSignals: draft.exclusionSignals
      ? [...draft.exclusionSignals]
      : undefined,
    occurrenceStartsAt: draft.occurrenceStartsAt
      ? [...draft.occurrenceStartsAt]
      : undefined,
  };
}

const completeDraft: AdminEventDraftRecord = {
  id: "draft-1",
  articleUrl: "https://mp.weixin.qq.com/s/example",
  title: "Italian Design Weekend",
  organizer: "Italian Cultural Institute",
  startsAt: "2026-06-06T06:00:00.000Z",
  endsAt: "2026-06-06T08:00:00.000Z",
  timezone: "Asia/Shanghai",
  city: "Beijing",
  venueName: "Italian Cultural Institute",
  reservationStatus: "required",
  registrationUrl: "https://example.com/register",
  summary: "A complete public activity.",
  confidence: 0.91,
  reviewState: "ready_for_review",
  evidenceAssetIds: [],
  fieldEvidence: {},
};

const excludedArticle: AdminExcludedArticleRecord = {
  id: "excluded-1",
  articleUrl: "https://mp.weixin.qq.com/s/official-visit",
  triageDecision: "official_visit",
  triageAction: "exclude",
  confidence: 0.94,
  publicSignals: [],
  exclusionSignals: ["Official visit"],
  exclusionReason: "Not open to ordinary attendees.",
  evidenceAssetIds: ["asset-1"],
  promptVersion: "event-triage-2026-06-03",
  schemaVersion: "event-triage-schema-v1",
  provider: "recorded",
  model: "fixture-model",
  processingState: "excluded",
  createdAt: "2026-06-03T08:00:00.000Z",
};

describe("admin service", () => {
  it("lists event drafts by review state", async () => {
    const store = new MemoryAdminStore([
      completeDraft,
      { ...completeDraft, id: "draft-2", reviewState: "needs_info" },
    ]);

    await expect(
      listAdminEventDrafts({ reviewState: "needs_info" }, store),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "draft-2",
        reviewState: "needs_info",
        publishDecision: expect.objectContaining({
          canPublish: true,
          hardBlockers: [],
        }),
      }),
    ]);
  });

  it("lists, creates, looks up, and explicitly activates scoped prompt/model configs", async () => {
    const store = new MemoryAdminStore();
    store.promptModelConfigs = [
      {
        configId: "pmc-active",
        dataClass: "production",
        operation: "full_extract",
        stage: "active",
        provider: "dashscope",
        model: "qwen3-vl-plus",
        promptVersion: "full-extract.v1",
        promptText: "Extract events.",
        schemaVersion: "v5-extraction-result.v1",
        params: { temperature: 0 },
        budgetPolicy: { maxCostMicroCny: 1000 },
        createdReason: "initial active",
        createdBy: "admin",
        activationEvalRunId: "eval-1",
        activationReason: "baseline passed",
        activatedAt: "2026-06-10T08:00:00.000Z",
        metadata: {},
        createdAt: "2026-06-10T08:00:00.000Z",
        updatedAt: "2026-06-10T08:00:00.000Z",
      },
    ];

    await expect(
      listAdminPromptModelConfigs(
        { operation: "full_extract", stage: "active" },
        store,
      ),
    ).resolves.toHaveLength(1);
    expect(store.promptModelConfigInput).toEqual({
      dataClass: "production",
      operation: "full_extract",
      stage: "active",
    });

    await expect(
      createAdminPromptModelConfig(
        {
          dataClass: "production",
          operation: "full_extract",
          provider: "siliconflow",
          model: "Qwen/Qwen3.6-27B",
          promptVersion: "full-extract.candidate.v2",
          promptText: "Extract Beijing public events.",
          schemaVersion: "v5-extraction-result.v1",
          params: { temperature: 0 },
          budgetPolicy: { maxCostMicroCny: 5000 },
          createdReason: "compare cheaper model",
          createdBy: "admin",
        },
        store,
      ),
    ).resolves.toMatchObject({
      configId: "pmc-1",
      stage: "candidate",
      provider: "siliconflow",
    });
    expect(store.createdPromptModelConfigInput?.createdReason).toBe(
      "compare cheaper model",
    );

    await expect(
      getAdminActivePromptModelConfig(
        { dataClass: "production", operation: "full_extract" },
        store,
      ),
    ).resolves.toMatchObject({ configId: "pmc-active" });

    await expect(
      activateAdminPromptModelConfig(
        {
          configId: "pmc-1",
          dataClass: "production",
          operation: "full_extract",
          evalRunId: "eval-2",
          activationReason: "candidate met false-positive and budget gates",
        },
        store,
        new Date("2026-06-11T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      configId: "pmc-1",
      stage: "active",
      activationEvalRunId: "eval-2",
      activationReason: "candidate met false-positive and budget gates",
    });
    expect(store.activatedPromptModelConfigInput).toMatchObject({
      activatedAt: "2026-06-11T12:00:00.000Z",
    });
    expect(
      store.promptModelConfigs.find((config) => config.configId === "pmc-active")
        ?.stage,
    ).toBe("archived");
  });

  it("returns the read-only LLM usage summary from the admin store", async () => {
    const store = new MemoryAdminStore();

    await expect(
      listAdminLlmUsageSummary(
        { range: "today" },
        store,
        new Date("2026-06-04T03:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      range: {
        key: "today",
        label: "Today",
        startsAt: "2026-06-03T16:00:00.000Z",
      },
      latestRecordedAt: "2026-06-04T02:05:00.000Z",
      totals: store.llmUsageSummary.totals,
    });
    expect(store.llmUsageInput).toMatchObject({
      startsAt: "2026-06-03T16:00:00.000Z",
    });
  });

  it("records structured feedback without mutating draft review or publication state", async () => {
    const store = new MemoryAdminStore([completeDraft]);

    const feedback = await createAdminFeedback(
      {
        dataClass: "production",
        feedbackType: "wrong_time",
        draftId: "draft-1",
        articleBundleId: "bundle-1",
        fieldName: "startsAt",
        oldValue: "2026-06-06T06:00:00.000Z",
        correctedValue: "2026-06-06T07:00:00.000Z",
        reason: "Human checked the source poster.",
        createdBy: "operator@example.com",
      },
      store,
    );

    expect(feedback).toMatchObject({
      id: "feedback-1",
      feedbackType: "wrong_time",
      draftId: "draft-1",
      status: "open",
    });
    expect(store.createdFeedbackInput).toMatchObject({
      dataClass: "production",
      feedbackType: "wrong_time",
      draftId: "draft-1",
      fieldName: "startsAt",
    });
    expect(store.drafts.get("draft-1")?.reviewState).toBe("ready_for_review");
    expect(store.publishedEvents).toEqual([]);
  });

  it("lists feedback with production defaults and explicit filters", async () => {
    const store = new MemoryAdminStore();
    store.feedbackRows = [
      {
        id: "feedback-1",
        dataClass: "production",
        feedbackType: "missing_qr",
        articleBundleId: "bundle-1",
        draftId: "draft-1",
        fieldName: "registrationQrAssetId",
        reason: "QR exists in the article image.",
        createdBy: "operator@example.com",
        status: "open",
        metadata: {},
        createdAt: "2026-06-11T10:00:00.000Z",
        updatedAt: "2026-06-11T10:00:00.000Z",
      },
      {
        id: "feedback-2",
        dataClass: "eval",
        feedbackType: "not_event",
        evalRunId: "eval-run-1",
        caseId: "case-news-1",
        articleBundleId: "bundle-2",
        createdBy: "operator@example.com",
        status: "resolved",
        metadata: {},
        createdAt: "2026-06-11T10:05:00.000Z",
        updatedAt: "2026-06-11T10:05:00.000Z",
      },
    ];

    await expect(
      listAdminFeedback({ draftId: "draft-1" }, store),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "feedback-1",
        feedbackType: "missing_qr",
      }),
    ]);
    expect(store.feedbackInput).toEqual({
      dataClass: "production",
      draftId: "draft-1",
    });

    await expect(
      listAdminFeedback(
        {
          dataClass: "eval",
          evalRunId: "eval-run-1",
          caseId: "case-news-1",
          status: "resolved",
        },
        store,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "feedback-2",
        dataClass: "eval",
        evalRunId: "eval-run-1",
        caseId: "case-news-1",
      }),
    ]);
    expect(store.feedbackInput).toMatchObject({
      dataClass: "eval",
      evalRunId: "eval-run-1",
      caseId: "case-news-1",
      status: "resolved",
    });
  });

  it("returns pipeline runs scoped to production by default", async () => {
    const store = new MemoryAdminStore();
    store.pipelineRuns = [
      {
        runId: "pipe-1",
        dataClass: "production",
        sourceKind: "article_bundle",
        sourceId: "bundle-1",
        articleBundleId: "bundle-1",
        caseId: "case-1",
        status: "completed",
        decision: "needs_review",
        reason: "Missing QR evidence.",
        startedAt: "2026-06-10T04:00:00.000Z",
        finishedAt: "2026-06-10T04:00:03.000Z",
        metadata: {},
        steps: [
          {
            stepId: "step-1",
            runId: "pipe-1",
            stepOrder: 1,
            nodeName: "full_extract",
            nodeVersion: "v5",
            status: "completed",
            decision: "public_activity",
            reason: "Public attendance signal found.",
            provider: "dashscope",
            model: "qwen3-vl-plus",
            promptVersion: "full-extract-v5",
            schemaVersion: "event-extract-v5",
            usageId: "usage-1",
            inputArtifactIds: ["artifact-input"],
            outputArtifactIds: ["artifact-output"],
            validationIssues: [],
            errorDetails: {},
            startedAt: "2026-06-10T04:00:00.000Z",
            finishedAt: "2026-06-10T04:00:02.000Z",
            latencyMs: 2000,
            attempts: [
              {
                attemptId: "attempt-1",
                runId: "pipe-1",
                stepId: "step-1",
                attemptNumber: 1,
                provider: "dashscope",
                model: "qwen3-vl-plus",
                promptVersion: "full-extract-v5",
                schemaVersion: "event-extract-v5",
                usage: { totalTokens: 1200, costMicroCny: 3200 },
                validatorIssues: [],
                reason: "Parsed on first attempt.",
                startedAt: "2026-06-10T04:00:00.000Z",
                finishedAt: "2026-06-10T04:00:02.000Z",
                latencyMs: 2000,
              },
            ],
          },
        ],
        artifacts: [
          {
            artifactId: "artifact-output",
            runId: "pipe-1",
            stepId: "step-1",
            dataClass: "production",
            path: "runs/pipe-1/full_extract.json",
            kind: "extraction",
            hash: "sha256:abc",
            bucket: "eval-artifacts",
            metadata: {},
            createdAt: "2026-06-10T04:00:02.000Z",
          },
        ],
        createdAt: "2026-06-10T04:00:00.000Z",
      },
    ];

    await expect(listAdminPipelineRuns({}, store)).resolves.toMatchObject([
      {
        runId: "pipe-1",
        dataClass: "production",
        steps: [
          {
            stepOrder: 1,
            nodeName: "full_extract",
            attempts: [
              {
                usage: { totalTokens: 1200, costMicroCny: 3200 },
              },
            ],
          },
        ],
        artifacts: [{ path: "runs/pipe-1/full_extract.json" }],
      },
    ]);
    expect(store.pipelineRunsInput).toEqual({ dataClass: "production" });
  });

  it("resolves admin LLM usage ranges using the Asia/Shanghai day boundary", () => {
    expect(
      resolveAdminLlmUsageRange(
        "today",
        new Date("2026-06-04T03:00:00.000Z"),
      ),
    ).toEqual({
      key: "today",
      label: "Today",
      startsAt: "2026-06-03T16:00:00.000Z",
    });
    expect(
      resolveAdminLlmUsageRange("7d", new Date("2026-06-04T03:00:00.000Z")),
    ).toEqual({
      key: "7d",
      label: "Last 7 days",
      startsAt: "2026-05-28T03:00:00.000Z",
    });
    expect(
      resolveAdminLlmUsageRange("all", new Date("2026-06-04T03:00:00.000Z")),
    ).toEqual({
      key: "all",
      label: "All",
    });
  });

  it("returns draft detail with review context", async () => {
    const store = new MemoryAdminStore([completeDraft]);

    await expect(getAdminEventDraftDetail("draft-1", store)).resolves.toEqual({
      ...completeDraft,
      publishDecision: expect.objectContaining({
        canPublish: true,
        hardBlockers: [],
        softBlockers: [],
      }),
    });
  });

  it("returns event analysis review context on draft detail", async () => {
    const draft: AdminEventDraftRecord = {
      ...completeDraft,
      triageDecision: "possible_public_activity",
      triageAction: "review",
      publicEligibility: "unclear",
      eventKind: "long_running",
      scheduleKind: "long_running",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=TU,WE,TH,FR,SA,SU",
      occurrenceStartsAt: ["2026-06-04T02:00:00.000Z"],
      hardBlockers: [],
      softBlockers: [{ code: "low_confidence", message: "Review confidence" }],
      resolutionDecision: "new_event",
    };
    const store = new MemoryAdminStore([draft]);

    await expect(getAdminEventDraftDetail("draft-1", store)).resolves.toMatchObject({
      triageDecision: "possible_public_activity",
      scheduleKind: "long_running",
      softBlockers: [{ code: "low_confidence", message: "Review confidence" }],
      resolutionDecision: "new_event",
      publishDecision: {
        canPublish: false,
        canPublishWithOverride: true,
        requiresOperatorOverride: true,
        softBlockers: [{ code: "low_confidence", message: "Review confidence" }],
      },
    });
  });

  it("stores missing-info and rejection decisions", async () => {
    const store = new MemoryAdminStore([completeDraft]);

    await expect(
      markAdminEventDraftNeedsInfo("draft-1", store),
    ).resolves.toMatchObject({
      id: "draft-1",
      reviewState: "needs_info",
      publishDecision: expect.objectContaining({ canPublish: true }),
    });
    await expect(
      rejectAdminEventDraft("draft-1", store, {
        reason: "No public attendance signal.",
      }),
    ).resolves.toMatchObject({
      id: "draft-1",
      reviewState: "rejected",
      operatorOverrideReason: "No public attendance signal.",
    });
  });

  it("stores rejection reasons as operator feedback", async () => {
    const store = new MemoryAdminStore([completeDraft]);

    await expect(
      rejectAdminEventDraft("draft-1", store, {
        reason: "Embassy internal event, not publicly attendable.",
      }),
    ).resolves.toMatchObject({
      id: "draft-1",
      reviewState: "rejected",
      operatorOverrideReason: "Embassy internal event, not publicly attendable.",
    });
  });

  it("lists excluded articles and promotes false negatives to extraction", async () => {
    const store = new MemoryAdminStore([], [excludedArticle]);

    await expect(
      listAdminExcludedArticles({ processingState: "excluded" }, store),
    ).resolves.toEqual([excludedArticle]);
    await expect(
      promoteAdminExcludedArticle(
        "excluded-1",
        store,
        new Date("2026-06-03T09:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      id: "excluded-1",
      processingState: "promoted_to_extraction",
      promotedAt: "2026-06-03T09:00:00.000Z",
    });
  });

  it("throws when promoting a missing excluded article", async () => {
    await expect(
      promoteAdminExcludedArticle("missing", new MemoryAdminStore()),
    ).rejects.toThrow("excluded_article_not_found");
  });

  it("lists processing ledger rows for article audit", async () => {
    const store = new MemoryAdminStore();
    store.ledgerRows = [
      {
        id: "ledger-1",
        sourceUrl: "https://mp.weixin.qq.com/s/activity",
        state: "published",
        decision: "public_activity",
        reason: "Auto-published complete public event.",
        confidence: 0.98,
        provider: "dashscope",
        model: "qwen3-vl-plus",
        dataClass: "production",
        metadata: {},
        createdAt: "2026-06-08T01:00:00.000Z",
      },
      {
        id: "ledger-2",
        sourceUrl: "https://mp.weixin.qq.com/s/news",
        state: "excluded",
        decision: "non_public_news",
        reason: "No public attendance signal.",
        confidence: 0.92,
        dataClass: "production",
        metadata: {},
        createdAt: "2026-06-08T02:00:00.000Z",
      },
    ];

    await expect(
      listAdminProcessingLedger({ state: "excluded" }, store),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "ledger-2",
        state: "excluded",
        reason: "No public attendance signal.",
      }),
    ]);
  });

  it("lists evaluation reports with case results", async () => {
    const store = new MemoryAdminStore();
    store.evaluationRuns = [
      {
        runId: "eval-1",
        provider: "dashscope",
        model: "qwen3-vl-plus",
        promptVersion: "event-analysis-2026-06-08",
        schemaVersion: "event-analysis-schema-v1",
        parameters: { temperature: 0 },
        corpusVersion: "regression-2026-06",
        status: "completed",
        validity: "valid",
        startedAt: "2026-06-08T01:00:00.000Z",
        completedAt: "2026-06-08T01:02:00.000Z",
        caseCount: 2,
        passCount: 1,
        failCount: 1,
        summary: { notes: "one QR miss" },
        caseResults: [
          {
            id: "result-1",
            runId: "eval-1",
            caseId: "qr-registration",
            expectedAction: "publish",
            actualAction: "needs_review",
            passed: false,
            scores: { poster: 1, qr: 0 },
            errors: [{ code: "missing_qr" }],
            createdAt: "2026-06-08T01:02:00.000Z",
          },
        ],
        createdAt: "2026-06-08T01:00:00.000Z",
      },
    ];

    await expect(
      listAdminEvaluationRuns({ status: "completed" }, store),
    ).resolves.toEqual([
      expect.objectContaining({
        runId: "eval-1",
        status: "completed",
        failCount: 1,
        caseResults: [
          expect.objectContaining({
            caseId: "qr-registration",
            passed: false,
          }),
        ],
      }),
    ]);
    expect(store.evaluationRunsInput).toMatchObject({
      status: "completed",
      validity: "valid",
    });
  });

  it("allows evaluation reports to be queried by explicit validity", async () => {
    const store = new MemoryAdminStore();
    store.evaluationRuns = [
      {
        runId: "eval-invalidated",
        provider: "siliconflow",
        model: "qwen",
        promptVersion: "pre-288",
        schemaVersion: "analysis-output-v1",
        parameters: {},
        corpusVersion: "regression-2026-06",
        status: "failed",
        validity: "invalidated",
        invalidatedReason: "pre_288_live_eval_used_legacy_text_metadata_path",
        invalidatedAt: "2026-06-09T07:00:00.000Z",
        startedAt: "2026-06-09T03:00:00.000Z",
        caseCount: 1,
        passCount: 0,
        failCount: 1,
        summary: {},
        caseResults: [],
        createdAt: "2026-06-09T03:00:00.000Z",
      },
    ];

    await expect(
      listAdminEvaluationRuns({ validity: "invalidated" }, store),
    ).resolves.toEqual([
      expect.objectContaining({
        runId: "eval-invalidated",
        validity: "invalidated",
        invalidatedReason: "pre_288_live_eval_used_legacy_text_metadata_path",
      }),
    ]);
  });

  it("publishes complete drafts into canonical events", async () => {
    const store = new MemoryAdminStore([completeDraft]);

    const result = await publishAdminEventDraft(
      "draft-1",
      store,
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(result).toEqual({
      id: "event-1",
      title: "Italian Design Weekend",
      status: "published",
      publishedAt: "2026-05-28T08:00:00.000Z",
    });
    expect(store.publishedEvents).toEqual([
      { draftId: "draft-1", title: "Italian Design Weekend" },
    ]);
  });

  it("publishes drafts with minimum public venue fields and organizer", async () => {
    const store = new MemoryAdminStore([
      {
        ...completeDraft,
        id: "draft-minimum",
        venueName: undefined,
        venueAddress: "北京市朝阳区朝阳公园",
        reservationStatus: undefined,
      },
    ]);

    await expect(
      publishAdminEventDraft(
        "draft-minimum",
        store,
        new Date("2026-05-28T08:00:00.000Z"),
        { operatorOverrideReason: "Human reviewed minimal venue details." },
      ),
    ).resolves.toMatchObject({
      status: "published",
    });
  });

  it("requires an override reason before publishing soft-blocked drafts", async () => {
    const store = new MemoryAdminStore([
      {
        ...completeDraft,
        id: "draft-soft",
        endsAt: undefined,
        confidence: 0.62,
      },
    ]);

    await expect(
      publishAdminEventDraft(
        "draft-soft",
        store,
        new Date("2026-05-28T08:00:00.000Z"),
      ),
    ).rejects.toMatchObject({
      message: "draft_not_publishable",
      publishDecision: expect.objectContaining({
        requiresOperatorOverride: true,
        disabledReason: "Operator override reason required",
      }),
    });
    await expect(
      publishAdminEventDraft(
        "draft-soft",
        store,
        new Date("2026-05-28T08:00:00.000Z"),
        { operatorOverrideReason: "Human verified schedule from poster." },
      ),
    ).resolves.toMatchObject({ status: "published" });
  });

  it("rejects publishing drafts that lack public required fields", async () => {
    const store = new MemoryAdminStore([
      {
        ...completeDraft,
        id: "draft-missing-time",
        startsAt: undefined,
        reviewState: "needs_info",
      },
    ]);

    await expect(
      publishAdminEventDraft(
        "draft-missing-time",
        store,
        new Date("2026-05-28T08:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(AdminDraftPublishBlockedError);
  });

  it("hard-blocks possible duplicate drafts even with override reason", async () => {
    const store = new MemoryAdminStore([
      {
        ...completeDraft,
        id: "draft-duplicate",
        reviewState: "possible_duplicate",
        resolutionDecision: "same_event",
      },
    ]);

    await expect(
      publishAdminEventDraft(
        "draft-duplicate",
        store,
        new Date("2026-05-28T08:00:00.000Z"),
        { operatorOverrideReason: "This is actually a new event." },
      ),
    ).rejects.toMatchObject({
      message: "draft_not_publishable",
      publishDecision: expect.objectContaining({
        canPublishWithOverride: false,
        hardBlockers: [
          expect.objectContaining({ code: "possible_duplicate_review_state" }),
          expect.objectContaining({ code: "duplicate_event_unresolved" }),
        ],
      }),
    });
  });
});
