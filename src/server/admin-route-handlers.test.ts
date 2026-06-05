import { describe, expect, it } from "vitest";

import type {
  AdminEventDraftRecord,
  AdminExcludedArticleRecord,
  AdminLlmUsageSummary,
  AdminStore,
} from "./admin-service";
import {
  handleAdminCreateCollectorJob,
  handleAdminDraftAction,
  handleAdminLogin,
  handleAdminListExcludedArticles,
  handleAdminListCollectorJobs,
  handleAdminListEventDrafts,
  handleAdminListLlmUsage,
  handleAdminPromoteExcludedArticle,
  handleAdminPatchEventDraft,
} from "./admin-route-handlers";
import type { CollectorJobRecord } from "./collector-job-service";

class RouteAdminStore implements AdminStore {
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
        metadata: { environment: "production_collector" },
      },
    ],
  };

  async createCollectorJob(input: {
    seedUrl: string;
    requestedAt: string;
    preferredRunner: CollectorJobRecord["preferredRunner"];
  }): Promise<CollectorJobRecord> {
    return {
      id: 1,
      jobId: "job-1",
      seedUrl: input.seedUrl,
      state: "queued",
      requestedAt: input.requestedAt,
      attemptNumber: 0,
      preferredRunner: input.preferredRunner,
      runnerState: "local_pending",
      fallbackEligible: false,
    };
  }

  async listCollectorJobs(): Promise<CollectorJobRecord[]> {
    return [];
  }

  async listEventDrafts(): Promise<AdminEventDraftRecord[]> {
    return [this.draft];
  }

  async listExcludedArticles(): Promise<AdminExcludedArticleRecord[]> {
    return [this.excludedArticle];
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
    return {
      ...this.llmUsageSummary,
      range: input.range,
    };
  }

  async getEventDraft(draftId: string) {
    return draftId === this.draft.id ? this.draft : null;
  }

  async updateEventDraftReviewState(
    draftId: string,
    reviewState: AdminEventDraftRecord["reviewState"],
  ) {
    if (draftId !== this.draft.id) return null;
    this.draft = { ...this.draft, reviewState };
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
  async listCollectorJobs(): Promise<CollectorJobRecord[]> {
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
    const response = await handleAdminCreateCollectorJob(
      request(
        { seedUrl: "https://mp.weixin.qq.com/s/example" },
        { authorization: "Bearer wrong" },
      ),
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
      new Date("2026-05-28T08:00:00.000Z"),
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

  it("creates queued collector jobs for valid seed URLs", async () => {
    const response = await handleAdminCreateCollectorJob(
      request({ seedUrl: "https://mp.weixin.qq.com/s/example" }),
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      job: {
        jobId: "job-1",
        state: "queued",
        preferredRunner: "local_collector",
        runnerState: "local_pending",
        fallbackEligible: false,
      },
    });
  });

  it("accepts shared text that contains a seed URL", async () => {
    const response = await handleAdminCreateCollectorJob(
      request({
        seedUrl:
          "活动分享：准备好感受泰国农业精品 https://mp.weixin.qq.com/s/r14ZCPdt5E56TFXzUPJ5Dg 。",
      }),
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      job: {
        seedUrl: "https://mp.weixin.qq.com/s/r14ZCPdt5E56TFXzUPJ5Dg",
      },
    });
  });

  it("rejects shared text without any URL", async () => {
    const response = await handleAdminCreateCollectorJob(
      request({ seedUrl: "只有活动介绍，没有链接" }),
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    ok: false,
    error: "invalid_seed_url",
  });
});

  it("accepts explicitly local collector jobs without runner side effects", async () => {
    const response = await handleAdminCreateCollectorJob(
      request({
        seedUrl: "https://mp.weixin.qq.com/s/example",
        preferredRunner: "local_collector",
      }),
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      job: {
        jobId: "job-1",
        preferredRunner: "local_collector",
        runnerState: "local_pending",
      },
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

  it("lists the admin LLM usage summary without prompt or response payloads", async () => {
    const response = await handleAdminListLlmUsage(
      new Request("https://example.com/api/admin/llm-usage?range=7d", {
        headers: { authorization: "Bearer admin-secret" },
      }),
      new RouteAdminStore(),
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
      request(),
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
