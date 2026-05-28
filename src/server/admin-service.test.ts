import { describe, expect, it } from "vitest";

import {
  createAdminCollectorJob,
  getAdminEventDraftDetail,
  listAdminEventDrafts,
  markAdminEventDraftNeedsInfo,
  publishAdminEventDraft,
  rejectAdminEventDraft,
  type AdminEventDraftRecord,
  type AdminStore,
} from "./admin-service";
import type { CollectorJobRecord } from "./collector-job-service";

class MemoryAdminStore implements AdminStore {
  jobs: CollectorJobRecord[] = [];
  drafts = new Map<string, AdminEventDraftRecord>();
  publishedEvents: Array<{ draftId: string; title: string }> = [];

  constructor(drafts: AdminEventDraftRecord[] = []) {
    for (const draft of drafts) this.drafts.set(draft.id, draft);
  }

  async createCollectorJob(input: {
    seedUrl: string;
    requestedAt: string;
  }): Promise<CollectorJobRecord> {
    const job: CollectorJobRecord = {
      id: this.jobs.length + 1,
      jobId: `job-${this.jobs.length + 1}`,
      seedUrl: input.seedUrl,
      state: "queued",
      requestedAt: input.requestedAt,
      attemptNumber: 0,
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
    });
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

  it("stores missing-info and rejection decisions", async () => {
    const store = new MemoryAdminStore([completeDraft]);

    await expect(
      markAdminEventDraftNeedsInfo("draft-1", store),
    ).resolves.toMatchObject({ id: "draft-1", reviewState: "needs_info" });
    await expect(rejectAdminEventDraft("draft-1", store)).resolves.toMatchObject(
      { id: "draft-1", reviewState: "rejected" },
    );
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
