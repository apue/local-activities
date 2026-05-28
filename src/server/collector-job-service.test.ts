import { describe, expect, it } from "vitest";

import {
  claimCollectorJob,
  createQueuedCollectorJob,
  heartbeatCollectorJob,
  reportCollectorJob,
  type CollectorJobRecord,
  type CollectorJobStore,
} from "./collector-job-service";

class MemoryCollectorJobStore implements CollectorJobStore {
  private nextId = 1;

  constructor(private readonly jobs: CollectorJobRecord[] = []) {}

  async createQueuedJob(input: {
    seedUrl: string;
    sourceId?: string;
    requestedMode?: CollectorJobRecord["requestedMode"];
    requestedAt: string;
  }) {
    const job: CollectorJobRecord = {
      id: this.nextId++,
      jobId: `job-${this.nextId}`,
      seedUrl: input.seedUrl,
      sourceId: input.sourceId,
      state: "queued",
      requestedAt: input.requestedAt,
      attemptNumber: 0,
      requestedMode: input.requestedMode,
    };
    this.jobs.push(job);
    return job;
  }

  async expireStaleLeases(now: string, maxAttempts: number) {
    const nowMs = Date.parse(now);
    for (const job of this.jobs) {
      if (
        (job.state === "claimed" || job.state === "running") &&
        job.leaseExpiresAt &&
        Date.parse(job.leaseExpiresAt) <= nowMs
      ) {
        if (job.attemptNumber >= maxAttempts) {
          job.state = "expired";
        } else {
          job.state = "queued";
          job.collectorId = undefined;
          job.localRunId = undefined;
          job.claimedAt = undefined;
          job.leaseExpiresAt = undefined;
        }
      }
    }
  }

  async claimNextQueuedJob(input: {
    collectorId: string;
    claimedAt: string;
    leaseExpiresAt: string;
  }) {
    const job = this.jobs
      .filter((candidate) => candidate.state === "queued")
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))[0];

    if (!job) return null;

    job.state = "claimed";
    job.collectorId = input.collectorId;
    job.claimedAt = input.claimedAt;
    job.leaseExpiresAt = input.leaseExpiresAt;
    job.attemptNumber += 1;
    return job;
  }

  async findByJobId(jobId: string) {
    return this.jobs.find((job) => job.jobId === jobId) ?? null;
  }

  async updateHeartbeat(input: {
    jobId: string;
    collectorId: string;
    localRunId: string;
    stage: "capturing" | "extracting" | "uploading";
    message?: string;
    heartbeatAt: string;
    leaseExpiresAt: string;
  }) {
    const job = await this.findByJobId(input.jobId);
    if (!job) return null;

    job.state = "running";
    job.collectorId = input.collectorId;
    job.localRunId = input.localRunId;
    job.lastHeartbeatAt = input.heartbeatAt;
    job.lastHeartbeatStage = input.stage;
    job.leaseExpiresAt = input.leaseExpiresAt;
    job.resultMessage = input.message;
    return job;
  }

  async updateReport(input: {
    jobId: string;
    collectorId: string;
    localRunId: string;
    status: "completed" | "partial" | "failed";
    sourceRunId?: string;
    articleSnapshotIds?: string[];
    eventDraftIds?: string[];
    evidenceAssetIds?: string[];
    failureIds?: string[];
    suggestedDisposition?: CollectorJobRecord["suggestedDisposition"];
    message?: string;
    reportedAt: string;
  }) {
    const job = await this.findByJobId(input.jobId);
    if (!job) return null;

    job.state = input.status;
    job.collectorId = input.collectorId;
    job.localRunId = input.localRunId;
    job.sourceRunId = input.sourceRunId;
    job.articleSnapshotIds = input.articleSnapshotIds;
    job.eventDraftIds = input.eventDraftIds;
    job.evidenceAssetIds = input.evidenceAssetIds;
    job.failureIds = input.failureIds;
    job.suggestedDisposition = input.suggestedDisposition;
    job.resultMessage = input.message;
    job.finishedAt = input.reportedAt;
    return job;
  }
}

describe("collector job service", () => {
  it("creates queued jobs from admin or backend helpers", async () => {
    const store = new MemoryCollectorJobStore();

    const result = await createQueuedCollectorJob(
      {
        seedUrl: "https://mp.weixin.qq.com/s/example",
        requestedMode: "auto",
      },
      store,
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(result.state).toBe("queued");
    expect(result.seedUrl).toBe("https://mp.weixin.qq.com/s/example");
  });

  it("claims at most one queued job and assigns a lease", async () => {
    const store = new MemoryCollectorJobStore([
      {
        id: 1,
        jobId: "job-old",
        seedUrl: "https://example.com/old",
        state: "queued",
        requestedAt: "2026-05-28T07:00:00.000Z",
        attemptNumber: 0,
      },
      {
        id: 2,
        jobId: "job-new",
        seedUrl: "https://example.com/new",
        state: "queued",
        requestedAt: "2026-05-28T07:30:00.000Z",
        attemptNumber: 0,
      },
    ]);

    const result = await claimCollectorJob(
      { collectorId: "home-1" },
      store,
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(result).toMatchObject({
      kind: "claimed",
      job: {
        jobId: "job-old",
        seedUrl: "https://example.com/old",
        attemptNumber: 1,
      },
    });
    expect(result.kind === "claimed" && result.job.leaseExpiresAt).toBeTruthy();
  });

  it("returns no-job with retry cadence when the queue is empty", async () => {
    const result = await claimCollectorJob(
      { collectorId: "home-1" },
      new MemoryCollectorJobStore(),
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(result).toEqual({
      kind: "none",
      retryAfterSeconds: 60,
    });
  });

  it("makes a stale lease claimable again before claiming", async () => {
    const store = new MemoryCollectorJobStore([
      {
        id: 1,
        jobId: "job-stale",
        seedUrl: "https://example.com/stale",
        state: "running",
        requestedAt: "2026-05-28T07:00:00.000Z",
        claimedAt: "2026-05-28T07:01:00.000Z",
        leaseExpiresAt: "2026-05-28T07:11:00.000Z",
        collectorId: "offline-collector",
        attemptNumber: 1,
      },
    ]);

    const result = await claimCollectorJob(
      { collectorId: "home-1" },
      store,
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(result).toMatchObject({
      kind: "claimed",
      job: {
        jobId: "job-stale",
        attemptNumber: 2,
      },
    });
  });

  it("accepts heartbeat only from the collector that owns an active lease", async () => {
    const store = new MemoryCollectorJobStore([
      {
        id: 1,
        jobId: "job-1",
        seedUrl: "https://example.com/a",
        state: "claimed",
        requestedAt: "2026-05-28T07:00:00.000Z",
        claimedAt: "2026-05-28T07:55:00.000Z",
        leaseExpiresAt: "2026-05-28T08:05:00.000Z",
        collectorId: "home-1",
        attemptNumber: 1,
      },
    ]);

    await expect(
      heartbeatCollectorJob(
        "job-1",
        {
          collectorId: "other",
          localRunId: "local-1",
          stage: "capturing",
        },
        store,
        new Date("2026-05-28T08:00:00.000Z"),
      ),
    ).resolves.toEqual({
      kind: "forbidden",
      error: "collector_lease_mismatch",
    });

    const result = await heartbeatCollectorJob(
      "job-1",
      {
        collectorId: "home-1",
        localRunId: "local-1",
        stage: "extracting",
        extendLeaseSeconds: 120,
      },
      store,
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(result).toMatchObject({
      kind: "updated",
      job: {
        jobId: "job-1",
        state: "running",
        localRunId: "local-1",
        lastHeartbeatStage: "extracting",
        leaseExpiresAt: "2026-05-28T08:02:00.000Z",
      },
    });
  });

  it("rejects report after the lease expires", async () => {
    const store = new MemoryCollectorJobStore([
      {
        id: 1,
        jobId: "job-1",
        seedUrl: "https://example.com/a",
        state: "running",
        requestedAt: "2026-05-28T07:00:00.000Z",
        claimedAt: "2026-05-28T07:30:00.000Z",
        leaseExpiresAt: "2026-05-28T07:40:00.000Z",
        collectorId: "home-1",
        localRunId: "local-1",
        attemptNumber: 1,
      },
    ]);

    const result = await reportCollectorJob(
      "job-1",
      {
        collectorId: "home-1",
        localRunId: "local-1",
        status: "completed",
      },
      store,
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(result).toEqual({
      kind: "expired",
      error: "collector_lease_expired",
    });
  });

  it("treats repeated terminal reports from the same run as idempotent", async () => {
    const store = new MemoryCollectorJobStore([
      {
        id: 1,
        jobId: "job-1",
        seedUrl: "https://example.com/a",
        state: "completed",
        requestedAt: "2026-05-28T07:00:00.000Z",
        claimedAt: "2026-05-28T07:30:00.000Z",
        leaseExpiresAt: "2026-05-28T08:30:00.000Z",
        collectorId: "home-1",
        localRunId: "local-1",
        attemptNumber: 1,
        finishedAt: "2026-05-28T07:40:00.000Z",
      },
    ]);

    const result = await reportCollectorJob(
      "job-1",
      {
        collectorId: "home-1",
        localRunId: "local-1",
        status: "completed",
      },
      store,
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(result).toMatchObject({
      kind: "updated",
      job: {
        jobId: "job-1",
        state: "completed",
        localRunId: "local-1",
      },
    });
  });
});
