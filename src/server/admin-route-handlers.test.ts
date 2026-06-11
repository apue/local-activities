import { describe, expect, it } from "vitest";

import type { AdminCollectorJobRecord } from "./admin-collector-jobs";
import type {
  AdminEventDraftRecord,
  AdminEvaluationRunRecord,
  AdminExcludedArticleRecord,
  AdminFeedbackInput,
  AdminFeedbackRecord,
  AdminLlmUsageSummary,
  AdminPipelineRunRecord,
  AdminPromptModelConfigActivationInput,
  AdminPromptModelConfigCreateInput,
  AdminPromptModelConfigRecord,
  AdminProcessingLedgerRecord,
  AdminStore,
} from "./admin-service";
import {
  handleAdminDraftAction,
  handleAdminActivatePromptModelConfig,
  handleAdminCreateFeedback,
  handleAdminCreatePromptModelConfig,
  handleAdminGetActivePromptModelConfig,
  handleAdminListFeedback,
  handleAdminListEvaluationRuns,
  handleAdminLogin,
  handleAdminListExcludedArticles,
  handleAdminListCollectorJobs,
  handleAdminListEventDrafts,
  handleAdminListLlmUsage,
  handleAdminListPipelineRuns,
  handleAdminListPromptModelConfigs,
  handleAdminListProcessingLedger,
  handleAdminPromoteExcludedArticle,
  handleAdminPatchEventDraft,
} from "./admin-route-handlers";

class RouteAdminStore implements AdminStore {
  llmUsageInput?: Parameters<AdminStore["getLlmUsageSummary"]>[0];
  draft: AdminEventDraftRecord = {
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
    confidence: 0.9,
    reviewState: "ready_for_review",
    evidenceAssetIds: [],
    fieldEvidence: {},
  };
  excludedArticle: AdminExcludedArticleRecord = {
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
  };
  ledger: AdminProcessingLedgerRecord = {
    id: "ledger-1",
    articleBundleId: "bundle-1",
    sourceUrl: "https://mp.weixin.qq.com/s/activity",
    state: "published",
    decision: "public_activity",
    reason: "Auto-published complete event.",
    confidence: 0.97,
    provider: "dashscope",
    model: "qwen3-vl-plus",
    dataClass: "production",
    draftId: "draft-1",
    canonicalEventId: "event-1",
    metadata: {},
    createdAt: "2026-06-04T02:01:00.000Z",
  };
  evaluationRun: AdminEvaluationRunRecord = {
    runId: "eval-1",
    provider: "dashscope",
    model: "qwen3-vl-plus",
    promptVersion: "event-analysis-2026-06-08",
    schemaVersion: "event-analysis-schema-v1",
    parameters: { temperature: 0 },
    corpusVersion: "regression-2026-06",
    status: "completed",
    validity: "valid",
    startedAt: "2026-06-04T02:00:00.000Z",
    completedAt: "2026-06-04T02:03:00.000Z",
    caseCount: 1,
    passCount: 1,
    failCount: 0,
    summary: { passRate: 1 },
    caseResults: [
      {
        id: "result-1",
        runId: "eval-1",
        caseId: "basic-public-event",
        expectedAction: "publish",
        actualAction: "publish",
        passed: true,
        scores: { event: 1 },
        errors: [],
        createdAt: "2026-06-04T02:03:00.000Z",
      },
    ],
    createdAt: "2026-06-04T02:00:00.000Z",
  };
  evaluationRunsInput?: Parameters<AdminStore["listEvaluationRuns"]>[0];
  promptModelConfigs: AdminPromptModelConfigRecord[] = [
    {
      configId: "pmc-active",
      dataClass: "production",
      operation: "full_extract",
      stage: "active",
      provider: "dashscope",
      model: "qwen3-vl-plus",
      promptVersion: "full-extract.v1",
      promptText: "Extract Beijing public activities.",
      schemaVersion: "v5-extraction-result.v1",
      params: { temperature: 0 },
      budgetPolicy: { maxCostMicroCny: 1000 },
      createdReason: "initial baseline",
      createdBy: "admin",
      activationEvalRunId: "eval-1",
      activationReason: "baseline accepted",
      activatedAt: "2026-06-10T08:00:00.000Z",
      metadata: {},
      createdAt: "2026-06-10T08:00:00.000Z",
      updatedAt: "2026-06-10T08:00:00.000Z",
    },
  ];
  promptModelConfigInput?: Parameters<AdminStore["listPromptModelConfigs"]>[0];
  createdPromptModelConfigInput?: AdminPromptModelConfigCreateInput;
  activePromptModelConfigInput?: Parameters<AdminStore["getActivePromptModelConfig"]>[0];
  activatedPromptModelConfigInput?: AdminPromptModelConfigActivationInput;
  pipelineRunsInput?: Parameters<AdminStore["listPipelineRuns"]>[0];
  feedbackRows: AdminFeedbackRecord[] = [
    {
      id: "feedback-1",
      dataClass: "production",
      feedbackType: "missing_qr",
      articleBundleId: "bundle-1",
      draftId: "draft-1",
      fieldName: "registrationQrAssetId",
      reason: "The QR code is visible in the source poster.",
      createdBy: "operator@example.com",
      status: "open",
      metadata: {},
      createdAt: "2026-06-11T10:00:00.000Z",
      updatedAt: "2026-06-11T10:00:00.000Z",
    },
  ];
  feedbackInput?: Parameters<AdminStore["listFeedback"]>[0];
  createdFeedbackInput?: AdminFeedbackInput;
  pipelineRun: AdminPipelineRunRecord = {
    runId: "pipe-1",
    dataClass: "production",
    sourceKind: "article_bundle",
    sourceId: "bundle-1",
    articleBundleId: "bundle-1",
    caseId: "case-1",
    status: "completed",
    decision: "needs_review",
    reason: "Missing registration QR.",
    startedAt: "2026-06-10T04:00:00.000Z",
    finishedAt: "2026-06-10T04:00:04.000Z",
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
        reason: "Event fields extracted.",
        provider: "dashscope",
        model: "qwen3-vl-plus",
        promptVersion: "full-extract-v5",
        schemaVersion: "event-extract-v5",
        usageId: "usage-1",
        inputArtifactIds: ["artifact-input"],
        outputArtifactIds: ["artifact-output"],
        validationIssues: [{ code: "missing_registration_qr" }],
        errorDetails: {},
        startedAt: "2026-06-10T04:00:00.000Z",
        finishedAt: "2026-06-10T04:00:03.000Z",
        latencyMs: 3000,
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
            usage: { totalTokens: 1450, costMicroCny: 4200 },
            validatorIssues: [{ code: "missing_registration_qr" }],
            reason: "Validator asked for review.",
            startedAt: "2026-06-10T04:00:00.000Z",
            finishedAt: "2026-06-10T04:00:03.000Z",
            latencyMs: 3000,
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
        bucket: "eval-artifacts",
        metadata: {},
        createdAt: "2026-06-10T04:00:03.000Z",
      },
    ],
    createdAt: "2026-06-10T04:00:00.000Z",
  };
  llmUsageSummary: AdminLlmUsageSummary = {
    range: {
      key: "today",
      label: "Today",
      startsAt: "2026-06-03T16:00:00.000Z",
    },
    latestRecordedAt: "2026-06-04T02:00:00.000Z",
    totals: {
      requestCount: 1,
      successCount: 1,
      errorCount: 0,
      inputTokens: 900,
      outputTokens: 250,
      totalTokens: 1150,
      costMicroCny: 2100,
    },
    byModel: [
      {
        provider: "openai",
        model: "gpt-5-mini",
        operation: "event_extraction",
        workload: "event_extraction",
        environment: "production_collector",
        requestCount: 1,
        totalTokens: 1150,
        costMicroCny: 2100,
      },
    ],
    byEnvironment: [
      {
        environment: "production_collector",
        requestCount: 1,
        successCount: 1,
        errorCount: 0,
        totalTokens: 1150,
        costMicroCny: 2100,
        latestRecordedAt: "2026-06-04T02:00:00.000Z",
      },
    ],
    byRun: [
      {
        runId: "run-1",
        environment: "production_collector",
        requestCount: 1,
        totalTokens: 1150,
        costMicroCny: 2100,
        latestRecordedAt: "2026-06-04T02:00:00.000Z",
      },
    ],
    recent: [
      {
        id: "usage-1",
        recordedAt: "2026-06-04T02:00:00.000Z",
        operation: "event_extraction",
        provider: "openai",
        model: "gpt-5-mini",
        status: "succeeded",
        inputTokens: 900,
        outputTokens: 250,
        totalTokens: 1150,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
        costMicroCny: 2100,
        params: {},
        metadata: { environment: "production_collector" },
      },
    ],
  };

  async listCollectorJobs(): Promise<AdminCollectorJobRecord[]> {
    return [];
  }

  async listEventDrafts(): Promise<AdminEventDraftRecord[]> {
    return [this.draft];
  }

  async listExcludedArticles(): Promise<AdminExcludedArticleRecord[]> {
    return [this.excludedArticle];
  }

  async listProcessingLedger(): Promise<AdminProcessingLedgerRecord[]> {
    return [this.ledger];
  }

  async listEvaluationRuns(
    input: Parameters<AdminStore["listEvaluationRuns"]>[0],
  ): Promise<AdminEvaluationRunRecord[]> {
    this.evaluationRunsInput = input;
    return [this.evaluationRun];
  }

  async listPromptModelConfigs(
    input: Parameters<AdminStore["listPromptModelConfigs"]>[0],
  ): Promise<AdminPromptModelConfigRecord[]> {
    this.promptModelConfigInput = input;
    return this.promptModelConfigs.filter(
      (config) =>
        (!input.dataClass || config.dataClass === input.dataClass) &&
        (!input.operation || config.operation === input.operation) &&
        (!input.stage || config.stage === input.stage),
    );
  }

  async createPromptModelConfig(
    input: AdminPromptModelConfigCreateInput,
  ): Promise<AdminPromptModelConfigRecord> {
    this.createdPromptModelConfigInput = input;
    const config: AdminPromptModelConfigRecord = {
      configId: "pmc-candidate",
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
      createdAt: "2026-06-11T12:00:00.000Z",
      updatedAt: "2026-06-11T12:00:00.000Z",
    };
    this.promptModelConfigs.unshift(config);
    return config;
  }

  async getActivePromptModelConfig(
    input: Parameters<AdminStore["getActivePromptModelConfig"]>[0],
  ): Promise<AdminPromptModelConfigRecord | null> {
    this.activePromptModelConfigInput = input;
    return this.promptModelConfigs.find(
      (config) =>
        config.dataClass === input.dataClass &&
        config.operation === input.operation &&
        config.stage === "active",
    ) ?? null;
  }

  async activatePromptModelConfig(
    input: AdminPromptModelConfigActivationInput,
  ): Promise<AdminPromptModelConfigRecord | null> {
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
    return config;
  }

  async listPipelineRuns(
    input: Parameters<AdminStore["listPipelineRuns"]>[0],
  ): Promise<AdminPipelineRunRecord[]> {
    this.pipelineRunsInput = input;
    return [this.pipelineRun];
  }

  async promoteExcludedArticle(
    excludedArticleId: string,
    promotedAt: string,
  ): Promise<AdminExcludedArticleRecord | null> {
    if (excludedArticleId !== this.excludedArticle.id) return null;
    this.excludedArticle = {
      ...this.excludedArticle,
      processingState: "promoted_to_extraction",
      promotedAt,
    };
    return this.excludedArticle;
  }

  async getLlmUsageSummary(
    input: Parameters<AdminStore["getLlmUsageSummary"]>[0],
  ): Promise<AdminLlmUsageSummary> {
    this.llmUsageInput = input;
    return {
      ...this.llmUsageSummary,
      range: input.range,
    };
  }

  async listFeedback(
    input: Parameters<AdminStore["listFeedback"]>[0],
  ): Promise<AdminFeedbackRecord[]> {
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

  async createFeedback(
    input: AdminFeedbackInput,
  ): Promise<AdminFeedbackRecord> {
    this.createdFeedbackInput = input;
    const feedback: AdminFeedbackRecord = {
      id: "feedback-2",
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
      createdAt: "2026-06-11T10:10:00.000Z",
      updatedAt: "2026-06-11T10:10:00.000Z",
    };
    this.feedbackRows.unshift(feedback);
    return feedback;
  }

  async getEventDraft(draftId: string) {
    return draftId === this.draft.id ? this.draft : null;
  }

  async updateEventDraftReviewState(
    draftId: string,
    reviewState: AdminEventDraftRecord["reviewState"],
    options?: { reason?: string },
  ) {
    if (draftId !== this.draft.id) return null;
    this.draft = {
      ...this.draft,
      reviewState,
      operatorOverrideReason: options?.reason ?? this.draft.operatorOverrideReason,
    };
    return this.draft;
  }

  async updateEventDraftFields(
    draftId: string,
    patch: Partial<AdminEventDraftRecord>,
  ) {
    if (draftId !== this.draft.id) return null;
    this.draft = { ...this.draft, ...patch };
    return this.draft;
  }

  async publishEventDraft() {
    return {
      id: "event-1",
      title: "Italian Design Weekend",
      status: "published" as const,
      publishedAt: "2026-05-28T08:00:00.000Z",
    };
  }
}

class FailingListAdminStore extends RouteAdminStore {
  async listCollectorJobs(): Promise<AdminCollectorJobRecord[]> {
    throw new Error("admin_job_list_failed");
  }

  async listEventDrafts(): Promise<AdminEventDraftRecord[]> {
    throw new Error("admin_draft_list_failed");
  }

  async listExcludedArticles(): Promise<AdminExcludedArticleRecord[]> {
    throw new Error("admin_excluded_article_list_failed");
  }

  async getLlmUsageSummary(): Promise<AdminLlmUsageSummary> {
    throw new Error("admin_llm_usage_list_failed");
  }

  async listPipelineRuns(): Promise<AdminPipelineRunRecord[]> {
    throw new Error("admin_pipeline_run_list_failed");
  }

  async listPromptModelConfigs(): Promise<AdminPromptModelConfigRecord[]> {
    throw new Error("admin_prompt_model_config_list_failed");
  }
}

function request(body?: unknown, headers: HeadersInit = {}) {
  return new Request("https://example.com/api/admin/collector-jobs", {
    method: body ? "POST" : "GET",
    headers: {
      authorization: "Bearer admin-secret",
      "content-type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("admin route handlers", () => {
  it("rejects missing admin credentials", async () => {
    const response = await handleAdminListCollectorJobs(
      request(undefined, { authorization: "Bearer wrong" }),
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "invalid_admin_token",
    });
  });

  it("sets an http-only admin session cookie after token login", async () => {
    const response = await handleAdminLogin(
      new Request("https://example.com/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ token: "admin-secret" }),
      }),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(
      "admin_session=admin-secret",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("does not set an admin session cookie after invalid token login", async () => {
    const response = await handleAdminLogin(
      new Request("https://example.com/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ token: "wrong-secret" }),
      }),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("lists admin state with a valid session cookie and no bearer header", async () => {
    const response = await handleAdminListCollectorJobs(
      new Request("https://example.com/api/admin/collector-jobs", {
        headers: { cookie: "admin_session=admin-secret" },
      }),
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      jobs: [],
    });
  });

  it("lists drafts for admin review", async () => {
    const response = await handleAdminListEventDrafts(
      request(),
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      drafts: [
        expect.objectContaining({
          id: "draft-1",
          publishDecision: expect.objectContaining({
            canPublish: true,
            hardBlockers: [],
            softBlockers: [],
          }),
        }),
      ],
    });
  });

  it("lists excluded articles for admin audit", async () => {
    const response = await handleAdminListExcludedArticles(
      new Request(
        "https://example.com/api/admin/excluded-articles?processingState=excluded",
        {
          headers: { authorization: "Bearer admin-secret" },
        },
      ),
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      excludedArticles: [
        expect.objectContaining({
          id: "excluded-1",
          triageDecision: "official_visit",
          processingState: "excluded",
        }),
      ],
    });
  });

  it("rejects invalid excluded article filters", async () => {
    const response = await handleAdminListExcludedArticles(
      new Request(
        "https://example.com/api/admin/excluded-articles?processingState=published",
        {
          headers: { authorization: "Bearer admin-secret" },
        },
      ),
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "invalid_request",
    });
  });

  it("lists processing ledger rows for admin article audit", async () => {
    const response = await handleAdminListProcessingLedger(
      new Request(
        "https://example.com/api/admin/processing-ledger?state=published&dataClass=production",
        {
          headers: { authorization: "Bearer admin-secret" },
        },
      ),
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      ledger: [
        expect.objectContaining({
          id: "ledger-1",
          sourceUrl: "https://mp.weixin.qq.com/s/activity",
          state: "published",
          decision: "public_activity",
          reason: "Auto-published complete event.",
        }),
      ],
    });
  });

  it("lists evaluation runs with case results for admin reports", async () => {
    const store = new RouteAdminStore();
    const response = await handleAdminListEvaluationRuns(
      new Request(
        "https://example.com/api/admin/evaluation-runs?status=completed",
        {
          headers: { authorization: "Bearer admin-secret" },
        },
      ),
      store,
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      evaluationRuns: [
        expect.objectContaining({
          runId: "eval-1",
          status: "completed",
          caseResults: [
            expect.objectContaining({
              caseId: "basic-public-event",
              passed: true,
            }),
          ],
        }),
      ],
    });
    expect(store.evaluationRunsInput).toMatchObject({
      status: "completed",
      validity: "valid",
    });
  });

  it("lists prompt/model configs with data-class, operation, and stage filters", async () => {
    const store = new RouteAdminStore();
    const response = await handleAdminListPromptModelConfigs(
      new Request(
        "https://example.com/api/admin/prompt-model-configs?data_class=production&operation=full_extract&stage=active",
        {
          headers: { authorization: "Bearer admin-secret" },
        },
      ),
      store,
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      configs: [
        {
          configId: "pmc-active",
          dataClass: "production",
          operation: "full_extract",
          stage: "active",
          provider: "dashscope",
          model: "qwen3-vl-plus",
        },
      ],
    });
    expect(store.promptModelConfigInput).toEqual({
      dataClass: "production",
      operation: "full_extract",
      stage: "active",
    });
  });

  it("gets the deterministic active prompt/model config for one scoped operation", async () => {
    const store = new RouteAdminStore();
    const response = await handleAdminGetActivePromptModelConfig(
      new Request(
        "https://example.com/api/admin/prompt-model-configs/active?dataClass=production&operation=full_extract",
        {
          headers: { authorization: "Bearer admin-secret" },
        },
      ),
      store,
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      config: {
        configId: "pmc-active",
        stage: "active",
        activationEvalRunId: "eval-1",
      },
    });
    expect(store.activePromptModelConfigInput).toEqual({
      dataClass: "production",
      operation: "full_extract",
    });
  });

  it("creates prompt/model configs only as non-production-impacting candidates", async () => {
    const store = new RouteAdminStore();
    const response = await handleAdminCreatePromptModelConfig(
      new Request("https://example.com/api/admin/prompt-model-configs", {
        method: "POST",
        headers: { authorization: "Bearer admin-secret" },
        body: JSON.stringify({
          dataClass: "production",
          operation: "full_extract",
          provider: "siliconflow",
          model: "Qwen/Qwen3.6-27B",
          promptVersion: "full-extract.candidate.v2",
          promptText: "Extract Beijing public activities from bundle input.",
          schemaVersion: "v5-extraction-result.v1",
          params: { temperature: 0, maxTokens: 3000 },
          budgetPolicy: { maxCostMicroCny: 5000 },
          createdReason: "Evaluate cheaper candidate against private corpus.",
          createdBy: "spoofed@example.com",
        }),
      }),
      store,
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      config: {
        configId: "pmc-candidate",
        stage: "candidate",
        provider: "siliconflow",
        createdBy: "admin",
      },
    });
    expect(store.createdPromptModelConfigInput).toMatchObject({
      dataClass: "production",
      operation: "full_extract",
      createdBy: "admin",
    });
  });

  it("rejects prompt/model configs with invalid params or missing required prompt fields", async () => {
    const invalidParams = await handleAdminCreatePromptModelConfig(
      new Request("https://example.com/api/admin/prompt-model-configs", {
        method: "POST",
        headers: { authorization: "Bearer admin-secret" },
        body: JSON.stringify({
          dataClass: "production",
          operation: "full_extract",
          provider: "siliconflow",
          model: "Qwen/Qwen3.6-27B",
          promptVersion: "full-extract.candidate.v2",
          promptText: "Extract Beijing public activities.",
          schemaVersion: "v5-extraction-result.v1",
          params: ["temperature", 0],
          createdReason: "Evaluate cheaper candidate.",
        }),
      }),
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );
    expect(invalidParams.status).toBe(400);

    const secretParams = await handleAdminCreatePromptModelConfig(
      new Request("https://example.com/api/admin/prompt-model-configs", {
        method: "POST",
        headers: { authorization: "Bearer admin-secret" },
        body: JSON.stringify({
          dataClass: "production",
          operation: "full_extract",
          provider: "siliconflow",
          model: "Qwen/Qwen3.6-27B",
          promptVersion: "full-extract.candidate.v2",
          promptText: "Extract Beijing public activities.",
          schemaVersion: "v5-extraction-result.v1",
          params: { temperature: 0, apiKey: "must-not-store" },
          createdReason: "Evaluate cheaper candidate.",
        }),
      }),
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );
    expect(secretParams.status).toBe(400);

    const missingPromptText = await handleAdminCreatePromptModelConfig(
      new Request("https://example.com/api/admin/prompt-model-configs", {
        method: "POST",
        headers: { authorization: "Bearer admin-secret" },
        body: JSON.stringify({
          dataClass: "production",
          operation: "full_extract",
          provider: "siliconflow",
          model: "Qwen/Qwen3.6-27B",
          promptVersion: "full-extract.candidate.v2",
          schemaVersion: "v5-extraction-result.v1",
          createdReason: "Evaluate cheaper candidate.",
        }),
      }),
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );
    expect(missingPromptText.status).toBe(400);

    const missingSchemaVersion = await handleAdminCreatePromptModelConfig(
      new Request("https://example.com/api/admin/prompt-model-configs", {
        method: "POST",
        headers: { authorization: "Bearer admin-secret" },
        body: JSON.stringify({
          dataClass: "production",
          operation: "full_extract",
          provider: "siliconflow",
          model: "Qwen/Qwen3.6-27B",
          promptVersion: "full-extract.candidate.v2",
          promptText: "Extract Beijing public activities.",
          createdReason: "Evaluate cheaper candidate.",
        }),
      }),
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );
    expect(missingSchemaVersion.status).toBe(400);
  });

  it("requires explicit eval justification when activating a prompt/model config", async () => {
    const store = new RouteAdminStore();
    await store.createPromptModelConfig({
      dataClass: "production",
      operation: "full_extract",
      provider: "siliconflow",
      model: "Qwen/Qwen3.6-27B",
      promptVersion: "full-extract.candidate.v2",
      promptText: "Extract Beijing public activities.",
      schemaVersion: "v5-extraction-result.v1",
      createdReason: "candidate eval",
      createdBy: "admin",
    });

    const rejected = await handleAdminActivatePromptModelConfig(
      new Request(
        "https://example.com/api/admin/prompt-model-configs/pmc-candidate/activate",
        {
          method: "POST",
          headers: { authorization: "Bearer admin-secret" },
          body: JSON.stringify({
            dataClass: "production",
            operation: "full_extract",
          }),
        },
      ),
      "pmc-candidate",
      store,
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );
    expect(rejected.status).toBe(400);

    const response = await handleAdminActivatePromptModelConfig(
      new Request(
        "https://example.com/api/admin/prompt-model-configs/pmc-candidate/activate",
        {
          method: "POST",
          headers: { authorization: "Bearer admin-secret" },
          body: JSON.stringify({
            dataClass: "production",
            operation: "full_extract",
            evalRunId: "eval-2",
            activationReason: "Candidate met false-positive and budget gates.",
          }),
        },
      ),
      "pmc-candidate",
      store,
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
      new Date("2026-06-11T12:30:00.000Z"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      config: {
        configId: "pmc-candidate",
        stage: "active",
        activationEvalRunId: "eval-2",
        activationReason: "Candidate met false-positive and budget gates.",
      },
    });
    expect(store.activatedPromptModelConfigInput).toMatchObject({
      configId: "pmc-candidate",
      dataClass: "production",
      operation: "full_extract",
      evalRunId: "eval-2",
      activatedAt: "2026-06-11T12:30:00.000Z",
    });
  });

  it("lists V5 pipeline runs with nested trace records for admin visibility", async () => {
    const store = new RouteAdminStore();
    const response = await handleAdminListPipelineRuns(
      new Request(
        "https://example.com/api/admin/pipeline-runs?dataClass=production&status=completed",
        {
          headers: { authorization: "Bearer admin-secret" },
        },
      ),
      store,
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      pipelineRuns: [
        {
          runId: "pipe-1",
          status: "completed",
          decision: "needs_review",
          steps: [
            {
              stepOrder: 1,
              nodeName: "full_extract",
              provider: "dashscope",
              model: "qwen3-vl-plus",
              promptVersion: "full-extract-v5",
              schemaVersion: "event-extract-v5",
              validationIssues: [{ code: "missing_registration_qr" }],
              attempts: [
                {
                  usage: { totalTokens: 1450, costMicroCny: 4200 },
                  latencyMs: 3000,
                },
              ],
            },
          ],
          artifacts: [{ path: "runs/pipe-1/full_extract.json" }],
        },
      ],
    });
    expect(store.pipelineRunsInput).toEqual({
      dataClass: "production",
      status: "completed",
    });
  });

  it("rejects invalid pipeline run filters", async () => {
    const response = await handleAdminListPipelineRuns(
      new Request("https://example.com/api/admin/pipeline-runs?dataClass=dev", {
        headers: { authorization: "Bearer admin-secret" },
      }),
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "invalid_request",
    });
  });

  it("lists structured admin feedback by draft and article identifiers", async () => {
    const store = new RouteAdminStore();
    const response = await handleAdminListFeedback(
      new Request(
        "https://example.com/api/admin/feedback?draft_id=draft-1&article_bundle_id=bundle-1",
        {
          headers: { authorization: "Bearer admin-secret" },
        },
      ),
      store,
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      feedback: [
        expect.objectContaining({
          id: "feedback-1",
          feedbackType: "missing_qr",
          draftId: "draft-1",
          articleBundleId: "bundle-1",
        }),
      ],
    });
    expect(store.feedbackInput).toEqual({
      dataClass: "production",
      draftId: "draft-1",
      articleBundleId: "bundle-1",
    });
  });

  it("creates structured feedback without invoking draft actions", async () => {
    const store = new RouteAdminStore();
    const response = await handleAdminCreateFeedback(
      new Request("https://example.com/api/admin/feedback", {
        method: "POST",
        headers: { authorization: "Bearer admin-secret" },
        body: JSON.stringify({
          dataClass: "production",
          feedbackType: "wrong_location",
          pipelineRunId: "pipe-1",
          articleBundleId: "bundle-1",
          draftId: "draft-1",
          eventId: "event-1",
          fieldName: "venueName",
          oldValue: "Old venue",
          correctedValue: "New venue",
          reason: "Operator checked the source page.",
          createdBy: "spoofed@example.com",
        }),
      }),
      store,
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      feedback: {
        id: "feedback-2",
        feedbackType: "wrong_location",
        fieldName: "venueName",
        status: "open",
      },
    });
    expect(store.createdFeedbackInput).toMatchObject({
      dataClass: "production",
      feedbackType: "wrong_location",
      pipelineRunId: "pipe-1",
      articleBundleId: "bundle-1",
      draftId: "draft-1",
      eventId: "event-1",
      fieldName: "venueName",
      createdBy: "admin",
    });
    expect(store.draft.reviewState).toBe("ready_for_review");
  });

  it("rejects invalid feedback enum values and data classes", async () => {
    const invalidType = await handleAdminCreateFeedback(
      new Request("https://example.com/api/admin/feedback", {
        method: "POST",
        headers: { authorization: "Bearer admin-secret" },
        body: JSON.stringify({
          dataClass: "production",
          feedbackType: "maybe_event",
          reason: "Not a supported feedback label.",
          createdBy: "operator@example.com",
        }),
      }),
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );
    expect(invalidType.status).toBe(400);

    const invalidDataClass = await handleAdminListFeedback(
      new Request("https://example.com/api/admin/feedback?data_class=dev", {
        headers: { authorization: "Bearer admin-secret" },
      }),
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );
    expect(invalidDataClass.status).toBe(400);

    const unanchored = await handleAdminCreateFeedback(
      new Request("https://example.com/api/admin/feedback", {
        method: "POST",
        headers: { authorization: "Bearer admin-secret" },
        body: JSON.stringify({
          dataClass: "production",
          feedbackType: "other",
          reason: "This feedback is not linked to any record.",
        }),
      }),
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );
    expect(unanchored.status).toBe(400);
  });

  it("passes explicit evaluation run validity filters to the admin store", async () => {
    const store = new RouteAdminStore();
    const response = await handleAdminListEvaluationRuns(
      new Request(
        "https://example.com/api/admin/evaluation-runs?validity=invalidated",
        {
          headers: { authorization: "Bearer admin-secret" },
        },
      ),
      store,
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(response.status).toBe(200);
    expect(store.evaluationRunsInput).toMatchObject({
      validity: "invalidated",
    });
  });

  it("rejects invalid evaluation run validity filters", async () => {
    const response = await handleAdminListEvaluationRuns(
      new Request("https://example.com/api/admin/evaluation-runs?validity=old", {
        headers: { authorization: "Bearer admin-secret" },
      }),
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "invalid_request",
    });
  });

  it("requires a reason when rejecting drafts", async () => {
    const response = await handleAdminDraftAction(
      new Request("https://example.com/api/admin/event-drafts/draft-1/reject", {
        method: "POST",
        headers: { authorization: "Bearer admin-secret" },
        body: JSON.stringify({}),
      }),
      "draft-1",
      "reject",
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "invalid_request",
    });
  });

  it("lists the admin LLM usage summary without prompt or response payloads", async () => {
    const store = new RouteAdminStore();
    const response = await handleAdminListLlmUsage(
      new Request("https://example.com/api/admin/llm-usage?range=7d&data_class=eval&provider=dashscope&model=qwen3-vl-plus&operation=full_extract&status=failed&source_id=source-1&article_bundle_id=bundle-1", {
        headers: { authorization: "Bearer admin-secret" },
      }),
      store,
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
      new Date("2026-06-04T03:00:00.000Z"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      usage: {
        range: {
          key: "7d",
          label: "Last 7 days",
          startsAt: "2026-05-28T03:00:00.000Z",
        },
        latestRecordedAt: "2026-06-04T02:00:00.000Z",
        totals: {
          requestCount: 1,
          totalTokens: 1150,
          costMicroCny: 2100,
        },
        byModel: [
          {
            provider: "openai",
            model: "gpt-5-mini",
            operation: "event_extraction",
            workload: "event_extraction",
            environment: "production_collector",
          },
        ],
        byEnvironment: [
          {
            environment: "production_collector",
            requestCount: 1,
            totalTokens: 1150,
          },
        ],
        byRun: [
          {
            runId: "run-1",
            environment: "production_collector",
            requestCount: 1,
            totalTokens: 1150,
          },
        ],
      },
    });
    expect(store.llmUsageInput).toMatchObject({
      filters: {
        dataClass: "eval",
        provider: "dashscope",
        model: "qwen3-vl-plus",
        operation: "full_extract",
        status: "failed",
        sourceId: "source-1",
        articleBundleId: "bundle-1",
      },
    });
  });

  it("rejects invalid admin LLM usage ranges", async () => {
    const response = await handleAdminListLlmUsage(
      new Request("https://example.com/api/admin/llm-usage?range=yesterday", {
        headers: { authorization: "Bearer admin-secret" },
      }),
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "invalid_request",
    });
  });

  it("promotes excluded articles back to extraction state", async () => {
    const response = await handleAdminPromoteExcludedArticle(
      request(),
      "excluded-1",
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
      new Date("2026-06-03T09:00:00.000Z"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      excludedArticle: {
        id: "excluded-1",
        processingState: "promoted_to_extraction",
        promotedAt: "2026-06-03T09:00:00.000Z",
      },
    });
  });

  it("patches editable draft fields for long-running or recurring events", async () => {
    const response = await handleAdminPatchEventDraft(
      new Request("https://example.com/api/admin/event-drafts/draft-1", {
        method: "PATCH",
        headers: { authorization: "Bearer admin-secret" },
        body: JSON.stringify({
          scheduleKind: "long_running",
          scheduleText: "至8月30日，周二至周日 10:00-18:00",
          endsAt: "2026-08-30T11:00:00.000Z",
        }),
      }),
      "draft-1",
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      draft: {
        scheduleKind: "long_running",
        endsAt: "2026-08-30T11:00:00.000Z",
      },
    });
  });

  it("returns JSON errors when job listing fails", async () => {
    const response = await handleAdminListCollectorJobs(
      request(),
      new FailingListAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "admin_job_list_failed",
    });
  });

  it("returns JSON errors when draft listing fails", async () => {
    const response = await handleAdminListEventDrafts(
      request(),
      new FailingListAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "admin_draft_list_failed",
    });
  });

  it("publishes a complete draft through backend policy", async () => {
    const response = await handleAdminDraftAction(
      request(),
      "draft-1",
      "publish",
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      event: {
        id: "event-1",
        title: "Italian Design Weekend",
        status: "published",
        publishedAt: "2026-05-28T08:00:00.000Z",
      },
    });
  });

  it("publishes soft-blocked drafts only when an override reason is submitted", async () => {
    const store = new RouteAdminStore();
    store.draft = {
      ...store.draft,
      endsAt: undefined,
      confidence: 0.62,
    };

    const blocked = await handleAdminDraftAction(
      request(),
      "draft-1",
      "publish",
      store,
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
      new Date("2026-05-28T08:00:00.000Z"),
    );
    expect(blocked.status).toBe(400);
    await expect(blocked.json()).resolves.toEqual({
      ok: false,
      error: "draft_not_publishable",
      message: "Operator override reason required",
      publishDecision: expect.objectContaining({
        canPublish: false,
        canPublishWithOverride: true,
        requiresOperatorOverride: true,
        softBlockers: [
          expect.objectContaining({ code: "low_confidence" }),
          expect.objectContaining({ code: "missing_end_time" }),
        ],
      }),
    });

    const response = await handleAdminDraftAction(
      new Request("https://example.com/api/admin/event-drafts/draft-1/publish", {
        method: "POST",
        headers: { authorization: "Bearer admin-secret" },
        body: JSON.stringify({
          operatorOverrideReason: "Human verified the missing end time.",
        }),
      }),
      "draft-1",
      "publish",
      store,
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(response.status).toBe(200);
  });

  it("updates review state for needs-info and reject draft actions", async () => {
    const store = new RouteAdminStore();

    const needsInfo = await handleAdminDraftAction(
      request(),
      "draft-1",
      "needs-info",
      store,
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
      new Date("2026-05-28T08:00:00.000Z"),
    );
    expect(needsInfo.status).toBe(200);
    await expect(needsInfo.json()).resolves.toMatchObject({
      ok: true,
      draft: {
        id: "draft-1",
        reviewState: "needs_info",
        publishDecision: expect.objectContaining({ canPublish: true }),
      },
    });

    const rejected = await handleAdminDraftAction(
      new Request("https://example.com/api/admin/event-drafts/draft-1/reject", {
        method: "POST",
        headers: { authorization: "Bearer admin-secret" },
        body: JSON.stringify({
          reason: "Human rejected this as non-public.",
        }),
      }),
      "draft-1",
      "reject",
      store,
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
      new Date("2026-05-28T08:00:00.000Z"),
    );
    expect(rejected.status).toBe(200);
    await expect(rejected.json()).resolves.toMatchObject({
      ok: true,
      draft: {
        id: "draft-1",
        reviewState: "rejected",
        operatorOverrideReason: "Human rejected this as non-public.",
        publishDecision: expect.objectContaining({
          canPublish: false,
          hardBlockers: [
            expect.objectContaining({ code: "closed_review_state" }),
          ],
        }),
      },
    });
  });
});
