import { describe, expect, it } from "vitest";

import type { AdminEventDraftRecord, AdminStore } from "./admin-service";
import {
  handleAdminCreateCollectorJob,
  handleAdminDraftAction,
  handleAdminListCollectorJobs,
  handleAdminListEventDrafts,
} from "./admin-route-handlers";
import type { CollectorJobRecord } from "./collector-job-service";

class RouteAdminStore implements AdminStore {
  draft: AdminEventDraftRecord = {
    id: "draft-1",
    articleUrl: "https://mp.weixin.qq.com/s/example",
    title: "Italian Design Weekend",
    organizer: "Italian Cultural Institute",
    startsAt: "2026-06-06T06:00:00.000Z",
    timezone: "Asia/Shanghai",
    city: "Beijing",
    venueName: "Italian Cultural Institute",
    reservationStatus: "required",
    confidence: 0.9,
    reviewState: "ready_for_review",
    evidenceAssetIds: [],
    fieldEvidence: {},
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
      runnerState:
        input.preferredRunner === "local_collector"
          ? "local_pending"
          : "sandbox_pending",
      fallbackEligible: false,
    };
  }

  async listCollectorJobs(): Promise<CollectorJobRecord[]> {
    return [];
  }

  async listEventDrafts(): Promise<AdminEventDraftRecord[]> {
    return [this.draft];
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

  it("creates queued collector jobs for valid seed URLs", async () => {
    const startedJobs: CollectorJobRecord[] = [];
    const response = await handleAdminCreateCollectorJob(
      request({ seedUrl: "https://mp.weixin.qq.com/s/example" }),
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
      new Date("2026-05-28T08:00:00.000Z"),
      async (job) => {
        startedJobs.push(job);
        return { status: "started" as const, sandboxId: "sb_123" };
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      job: {
        jobId: "job-1",
        state: "queued",
        preferredRunner: "vercel_sandbox",
        runnerState: "sandbox_pending",
        fallbackEligible: false,
      },
      sandboxStart: {
        status: "started",
        sandboxId: "sb_123",
      },
    });
    expect(startedJobs).toHaveLength(1);
    expect(startedJobs[0]).toMatchObject({
      jobId: "job-1",
      preferredRunner: "vercel_sandbox",
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

  it("does not start Sandbox for explicitly local collector jobs", async () => {
    const startedJobs: CollectorJobRecord[] = [];
    const response = await handleAdminCreateCollectorJob(
      request({
        seedUrl: "https://mp.weixin.qq.com/s/example",
        preferredRunner: "local_collector",
      }),
      new RouteAdminStore(),
      { ADMIN_ACCESS_TOKEN: "admin-secret" },
      new Date("2026-05-28T08:00:00.000Z"),
      async (job) => {
        startedJobs.push(job);
        return { status: "started" as const, sandboxId: "sb_123" };
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      job: {
        jobId: "job-1",
        preferredRunner: "local_collector",
        runnerState: "local_pending",
      },
      sandboxStart: {
        status: "skipped",
        reason: "local_collector_preferred",
      },
    });
    expect(startedJobs).toHaveLength(0);
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
      drafts: [expect.objectContaining({ id: "draft-1" })],
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
});
