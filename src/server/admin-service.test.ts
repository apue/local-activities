import { describe, expect, it } from "vitest";

import {
  createAdminCollectorJob,
  getAdminEventDraftDetail,
  listAdminExcludedArticles,
  listAdminEventDrafts,
  markAdminEventDraftNeedsInfo,
  promoteAdminExcludedArticle,
  publishAdminEventDraft,
  rejectAdminEventDraft,
  type AdminExcludedArticleRecord,
  type AdminEventDraftRecord,
  type AdminStore,
} from "./admin-service";
import type { CollectorJobRecord } from "./collector-job-service";

class MemoryAdminStore implements AdminStore {
  jobs: CollectorJobRecord[] = [];
  drafts = new Map<string, AdminEventDraftRecord>();
  excludedArticles = new Map<string, AdminExcludedArticleRecord>();
  publishedEvents: Array<{ draftId: string; title: string }> = [];

  constructor(
    drafts: AdminEventDraftRecord[] = [],
    excludedArticles: AdminExcludedArticleRecord[] = [],
  ) {
    for (const draft of drafts) this.drafts.set(draft.id, draft);
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
      runnerState:
        input.preferredRunner === "local_collector"
          ? "local_pending"
          : "sandbox_pending",
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

  async listExcludedArticles(input: {
    processingState?: AdminExcludedArticleRecord["processingState"];
  }) {
    const articles = Array.from(this.excludedArticles.values());
    if (!input.processingState) return articles;
    return articles.filter(
      (article) => article.processingState === input.processingState,
    );
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

const completeDraft: AdminEventDraftRecord = {
  id: "draft-1",
  articleUrl: "https://mp.weixin.qq.com/s/example",
  title: "Italian Design Weekend",
  organizer: "Italian Cultural Institute",
  startsAt: "2026-06-06T06:00:00.000Z",
  timezone: "Asia/Shanghai",
  city: "Beijing",
  venueName: "Italian Cultural Institute",
  reservationStatus: "required",
  registrationUrl: "https://example.com/register",
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
      preferredRunner: "vercel_sandbox",
      runnerState: "sandbox_pending",
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
      expect.objectContaining({ id: "draft-2", reviewState: "needs_info" }),
    ]);
  });

  it("returns draft detail with review context", async () => {
    const store = new MemoryAdminStore([completeDraft]);

    await expect(getAdminEventDraftDetail("draft-1", store)).resolves.toEqual(
      completeDraft,
    );
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
    });
  });

  it("stores missing-info and rejection decisions", async () => {
    const store = new MemoryAdminStore([completeDraft]);

    await expect(
      markAdminEventDraftNeedsInfo("draft-1", store),
    ).resolves.toMatchObject({ id: "draft-1", reviewState: "needs_info" });
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
      ),
    ).resolves.toMatchObject({
      status: "published",
    });
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
    ).rejects.toThrow("draft_not_publishable");
  });
});
