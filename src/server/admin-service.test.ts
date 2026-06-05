import { describe, expect, it } from "vitest";

import {
  AdminDraftPublishBlockedError,
  createAdminCollectorJob,
  getAdminEventDraftDetail,
  listAdminExcludedArticles,
  listAdminLlmUsageSummary,
  listAdminEventDrafts,
  markAdminEventDraftNeedsInfo,
  promoteAdminExcludedArticle,
  publishAdminEventDraft,
  rejectAdminEventDraft,
  resolveAdminLlmUsageRange,
  type AdminExcludedArticleRecord,
  type AdminEventDraftRecord,
  type AdminStore,
} from "./admin-service";
import type { CollectorJobRecord } from "./collector-job-service";

class MemoryAdminStore implements AdminStore {
  jobs: CollectorJobRecord[] = [];
  drafts = new Map<string, AdminEventDraftRecord>();
  excludedArticles = new Map<string, AdminExcludedArticleRecord>();
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

  async createCollectorJob(input: {
    seedUrl: string;
    requestedAt: string;
    preferredRunner: CollectorJobRecord["preferredRunner"];
  }): Promise<CollectorJobRecord> {
    const job: CollectorJobRecord = {
      id: this.jobs.length + 1,
      jobId: `job-${this.jobs.length + 1}`,
      seedUrl: input.seedUrl,
      state: "queued",
      requestedAt: input.requestedAt,
      attemptNumber: 0,
      preferredRunner: input.preferredRunner,
      runnerState: "local_pending",
      fallbackEligible: false,
    };
    this.jobs.push(job);
    return job;
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
  ) {
    const draft = this.drafts.get(draftId);
    if (!draft) return null;
    draft.reviewState = reviewState;
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

  async getLlmUsageSummary(input: Parameters<AdminStore["getLlmUsageSummary"]>[0]) {
    this.llmUsageInput = input;
    return {
      ...this.llmUsageSummary,
      range: input.range,
    };
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
  it("creates queued collector jobs from valid seed URLs", async () => {
    const store = new MemoryAdminStore();

    const result = await createAdminCollectorJob(
      { seedUrl: "https://mp.weixin.qq.com/s/example" },
      store,
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(result).toMatchObject({
      jobId: "job-1",
      state: "queued",
      seedUrl: "https://mp.weixin.qq.com/s/example",
      preferredRunner: "local_collector",
      runnerState: "local_pending",
      fallbackEligible: false,
    });
  });

  it("extracts seed URLs from shared text before creating jobs", async () => {
    const store = new MemoryAdminStore();

    const result = await createAdminCollectorJob(
      {
        seedUrl:
          "复制这段小红书分享文案打开 App 查看 https://xhslink.com/a/abc123 ，周末活动见",
      },
      store,
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(result.seedUrl).toBe("https://xhslink.com/a/abc123");
  });

  it("rejects invalid seed URLs", async () => {
    await expect(
      createAdminCollectorJob(
        { seedUrl: "not-a-url" },
        new MemoryAdminStore(),
        new Date("2026-05-28T08:00:00.000Z"),
      ),
    ).rejects.toThrow("invalid_seed_url");
  });

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

  it("returns Event Pipeline V2 review context on draft detail", async () => {
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
    await expect(rejectAdminEventDraft("draft-1", store)).resolves.toMatchObject(
      { id: "draft-1", reviewState: "rejected" },
    );
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

  it("publishes drafts with only minimum public fields", async () => {
    const store = new MemoryAdminStore([
      {
        ...completeDraft,
        id: "draft-minimum",
        organizer: undefined,
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
          expect.objectContaining({ code: "unresolved_resolution" }),
        ],
      }),
    });
  });
});
