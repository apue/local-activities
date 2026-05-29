import { describe, expect, it } from "vitest";

import {
  claimCollectorJob,
  createQueuedCollectorJob,
  heartbeatCollectorJob,
  routeSandboxCollectorJobFailure,
  reportCollectorJob,
  startSandboxCollectorJob,
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
    preferredRunner?: CollectorJobRecord["preferredRunner"];
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
      preferredRunner: input.preferredRunner ?? "vercel_sandbox",
      runnerState:
        input.preferredRunner === "local_collector"
          ? "local_pending"
          : "sandbox_pending",
      fallbackEligible: false,
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
          job.runnerState = "failed";
        } else {
          job.state = "queued";
          job.collectorId = undefined;
          job.localRunId = undefined;
          job.claimedAt = undefined;
          job.leaseExpiresAt = undefined;
          job.runnerState = job.fallbackEligible
            ? "sandbox_failed_fallback_eligible"
            : "local_pending";
          if (!job.fallbackEligible) job.actualRunner = undefined;
        }
      }
    }
  }

  async claimNextQueuedJob(input: {
    collectorId: string;
    claimedAt: string;
    leaseExpiresAt: string;
    runner: CollectorJobRecord["actualRunner"];
  }) {
    const job = this.jobs
      .filter((candidate) => {
        if (candidate.state !== "queued") return false;
        if (input.runner !== "local_collector") return false;
        return (
          candidate.preferredRunner === "local_collector" ||
          candidate.fallbackEligible === true
        );
      })
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))[0];

    if (!job) return null;

    job.state = "claimed";
    job.collectorId = input.collectorId;
    job.claimedAt = input.claimedAt;
    job.leaseExpiresAt = input.leaseExpiresAt;
    job.attemptNumber += 1;
    job.actualRunner = input.runner;
    job.runnerState = job.fallbackEligible
      ? "fallback_claimed"
      : "local_claimed";
    return job;
  }

  async findByJobId(jobId: string) {
    return this.jobs.find((job) => job.jobId === jobId) ?? null;
  }

  async updateSandboxStarted(input: {
    jobId: string;
    sandboxRunId: string;
    startedAt: string;
    collectorId: string;
    localRunId: string;
    leaseExpiresAt: string;
  }) {
    const job = await this.findByJobId(input.jobId);
    if (!job || job.state !== "queued") return null;
    job.state = "running";
    job.actualRunner = "vercel_sandbox";
    job.runnerState = "sandbox_running";
    job.sandboxRunId = input.sandboxRunId;
    job.collectorId = input.collectorId;
    job.localRunId = input.localRunId;
    job.claimedAt = input.startedAt;
    job.leaseExpiresAt = input.leaseExpiresAt;
    job.attemptNumber += 1;
    return job;
  }

  async updateHeartbeat(input: {
    jobId: string;
    collectorId: string;
    localRunId: string;
    stage: "capturing" | "extracting" | "uploading";
    message?: string;
    heartbeatAt: string;
    leaseExpiresAt: string;
    runnerState: CollectorJobRecord["runnerState"];
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
    job.actualRunner = "local_collector";
    job.runnerState = input.runnerState;
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
    job.runnerState = input.status === "failed" ? "failed" : "completed";
    return job;
  }

  async updateSandboxFailure(input: {
    jobId: string;
    reason: CollectorJobRecord["fallbackReason"];
    message: string;
    failedAt: string;
    fallbackEligible: boolean;
    sandboxRunId?: string;
  }) {
    const job = await this.findByJobId(input.jobId);
    if (!job) return null;

    job.actualRunner = "vercel_sandbox";
    job.sandboxRunId = input.sandboxRunId;
    job.fallbackReason = input.reason;
    job.resultMessage = input.message;

    if (input.fallbackEligible) {
      job.state = "queued";
      job.runnerState = "sandbox_failed_fallback_eligible";
      job.fallbackEligible = true;
      job.collectorId = undefined;
      job.localRunId = undefined;
      job.claimedAt = undefined;
      job.leaseExpiresAt = undefined;
    } else {
      job.state = "failed";
      job.runnerState = "failed";
      job.fallbackEligible = false;
      job.finishedAt = input.failedAt;
    }

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
    expect(result.preferredRunner).toBe("vercel_sandbox");
    expect(result.runnerState).toBe("sandbox_pending");
    expect(result.fallbackEligible).toBe(false);
  });

  it("does not let the local collector claim default sandbox jobs", async () => {
    const store = new MemoryCollectorJobStore([
      {
        id: 1,
        jobId: "job-sandbox",
        seedUrl: "https://example.com/sandbox",
        state: "queued",
        requestedAt: "2026-05-28T07:00:00.000Z",
        attemptNumber: 0,
        preferredRunner: "vercel_sandbox",
        runnerState: "sandbox_pending",
        fallbackEligible: false,
      },
    ]);

    const result = await claimCollectorJob(
      { collectorId: "home-1" },
      store,
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(result).toEqual({
      kind: "none",
      retryAfterSeconds: 60,
    });
  });

  it("claims at most one local-eligible queued job and assigns a lease", async () => {
    const store = new MemoryCollectorJobStore([
      {
        id: 1,
        jobId: "job-old",
        seedUrl: "https://example.com/old",
        state: "queued",
        requestedAt: "2026-05-28T07:00:00.000Z",
        attemptNumber: 0,
        preferredRunner: "local_collector",
        runnerState: "local_pending",
        fallbackEligible: false,
      },
      {
        id: 2,
        jobId: "job-new",
        seedUrl: "https://example.com/new",
        state: "queued",
        requestedAt: "2026-05-28T07:30:00.000Z",
        attemptNumber: 0,
        preferredRunner: "local_collector",
        runnerState: "local_pending",
        fallbackEligible: false,
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
        actualRunner: "local_collector",
        runnerState: "local_claimed",
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
        preferredRunner: "local_collector",
        runnerState: "local_running",
        fallbackEligible: false,
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

  it("routes fallback-eligible sandbox failures back to the local collector", async () => {
    const store = new MemoryCollectorJobStore([
      {
        id: 1,
        jobId: "job-sandbox",
        seedUrl: "https://example.com/sandbox",
        state: "running",
        requestedAt: "2026-05-28T07:00:00.000Z",
        attemptNumber: 1,
        preferredRunner: "vercel_sandbox",
        actualRunner: "vercel_sandbox",
        runnerState: "sandbox_running",
        fallbackEligible: false,
        sandboxRunId: "sb-run-1",
      },
    ]);

    const routed = await routeSandboxCollectorJobFailure(
      "job-sandbox",
      {
        reason: "captcha_required",
        message: "QR captcha appeared in hosted browser.",
        sandboxRunId: "sb-run-1",
      },
      store,
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(routed).toMatchObject({
      kind: "updated",
      job: {
        jobId: "job-sandbox",
        state: "queued",
        preferredRunner: "vercel_sandbox",
        actualRunner: "vercel_sandbox",
        runnerState: "sandbox_failed_fallback_eligible",
        fallbackEligible: true,
        fallbackReason: "captcha_required",
      },
    });

    const claimed = await claimCollectorJob(
      { collectorId: "home-1" },
      store,
      new Date("2026-05-28T08:01:00.000Z"),
    );

    expect(claimed).toMatchObject({
      kind: "claimed",
      job: {
        jobId: "job-sandbox",
        actualRunner: "local_collector",
        runnerState: "fallback_claimed",
        fallbackReason: "captcha_required",
        attemptNumber: 2,
      },
    });
  });

  it("marks a sandbox attempt as the actual running job attempt", async () => {
    const store = new MemoryCollectorJobStore([
      {
        id: 1,
        jobId: "job-sandbox",
        seedUrl: "https://example.com/sandbox",
        state: "queued",
        requestedAt: "2026-05-28T07:00:00.000Z",
        attemptNumber: 0,
        preferredRunner: "vercel_sandbox",
        runnerState: "sandbox_pending",
        fallbackEligible: false,
      },
    ]);

    const result = await startSandboxCollectorJob(
      "job-sandbox",
      { sandboxRunId: "sb-run-1" },
      store,
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(result).toMatchObject({
      kind: "updated",
      job: {
        jobId: "job-sandbox",
        state: "running",
        collectorId: "sandbox-job-sandbox",
        localRunId: "sandbox-job-sandbox-1",
        actualRunner: "vercel_sandbox",
        runnerState: "sandbox_running",
        sandboxRunId: "sb-run-1",
        leaseExpiresAt: "2026-05-28T08:10:00.000Z",
        attemptNumber: 1,
      },
    });
  });

  it("accepts final reports from a started sandbox job", async () => {
    const store = new MemoryCollectorJobStore([
      {
        id: 1,
        jobId: "job-sandbox",
        seedUrl: "https://example.com/sandbox",
        state: "queued",
        requestedAt: "2026-05-28T07:00:00.000Z",
        attemptNumber: 0,
        preferredRunner: "vercel_sandbox",
        runnerState: "sandbox_pending",
        fallbackEligible: false,
      },
    ]);

    await startSandboxCollectorJob(
      "job-sandbox",
      { sandboxRunId: "sb-run-1" },
      store,
      new Date("2026-05-28T08:00:00.000Z"),
    );

    const result = await reportCollectorJob(
      "job-sandbox",
      {
        collectorId: "sandbox-job-sandbox",
        localRunId: "sandbox-job-sandbox-1",
        status: "failed",
        sourceRunId: "run-1",
        failureIds: ["failure-1"],
        suggestedDisposition: "failed",
        message: "Sandbox captured a structured failure.",
      },
      store,
      new Date("2026-05-28T08:01:00.000Z"),
    );

    expect(result).toMatchObject({
      kind: "updated",
      job: {
        jobId: "job-sandbox",
        state: "failed",
        collectorId: "sandbox-job-sandbox",
        localRunId: "sandbox-job-sandbox-1",
        failureIds: ["failure-1"],
        sourceRunId: "run-1",
        suggestedDisposition: "failed",
        resultMessage: "Sandbox captured a structured failure.",
        runnerState: "failed",
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
        preferredRunner: "local_collector",
        actualRunner: "local_collector",
        runnerState: "local_claimed",
        fallbackEligible: false,
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
        preferredRunner: "local_collector",
        actualRunner: "local_collector",
        runnerState: "local_running",
        fallbackEligible: false,
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
        preferredRunner: "local_collector",
        actualRunner: "local_collector",
        runnerState: "completed",
        fallbackEligible: false,
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
