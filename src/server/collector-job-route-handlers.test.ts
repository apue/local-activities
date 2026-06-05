import { describe, expect, it } from "vitest";

import type { CollectorJobRecord, CollectorJobStore } from "./collector-job-service";
import {
  handleClaimCollectorJob,
  handleHeartbeatCollectorJob,
  handleReportCollectorJob,
} from "./collector-job-route-handlers";

class RouteMemoryStore implements CollectorJobStore {
  constructor(private readonly job?: CollectorJobRecord) {}

  async createQueuedJob(): Promise<CollectorJobRecord> {
    throw new Error("not used");
  }

  async expireStaleLeases() {}

  async claimNextQueuedJob(input: {
    collectorId: string;
    claimedAt: string;
    leaseExpiresAt: string;
    runner: CollectorJobRecord["actualRunner"];
  }) {
    if (!this.job || this.job.state !== "queued") return null;
    if (
      input.runner === "local_collector" &&
      this.job.preferredRunner !== "local_collector"
    ) {
      return null;
    }
    this.job.state = "claimed";
    this.job.collectorId = input.collectorId;
    this.job.claimedAt = input.claimedAt;
    this.job.leaseExpiresAt = input.leaseExpiresAt;
    this.job.attemptNumber += 1;
    this.job.actualRunner = input.runner;
    this.job.runnerState = "local_claimed";
    return this.job;
  }

  async findByJobId(jobId: string) {
    return this.job?.jobId === jobId ? this.job : null;
  }

  async updateHeartbeat(input: {
    jobId: string;
    collectorId: string;
    localRunId: string;
    stage: "capturing" | "extracting" | "uploading";
    heartbeatAt: string;
    leaseExpiresAt: string;
    runnerState: CollectorJobRecord["runnerState"];
  }) {
    if (!this.job || this.job.jobId !== input.jobId) return null;
    this.job.state = "running";
    this.job.collectorId = input.collectorId;
    this.job.localRunId = input.localRunId;
    this.job.lastHeartbeatAt = input.heartbeatAt;
    this.job.lastHeartbeatStage = input.stage;
    this.job.leaseExpiresAt = input.leaseExpiresAt;
    this.job.actualRunner = "local_collector";
    this.job.runnerState = input.runnerState;
    return this.job;
  }

  async updateReport(input: {
    jobId: string;
    collectorId: string;
    localRunId: string;
    status: "completed" | "partial" | "failed";
    reportedAt: string;
  }) {
    if (!this.job || this.job.jobId !== input.jobId) return null;
    this.job.state = input.status;
    this.job.collectorId = input.collectorId;
    this.job.localRunId = input.localRunId;
    this.job.finishedAt = input.reportedAt;
    this.job.runnerState = input.status === "failed" ? "failed" : "completed";
    return this.job;
  }
}

function post(path: string, body: unknown, headers: HeadersInit = {}) {
  return new Request(`https://example.com${path}`, {
    method: "POST",
    headers: {
      authorization: "Bearer collector-secret",
      "content-type": "application/json",
      "x-collector-id": "home-1",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("collector job route handlers", () => {
  it("rejects unauthenticated claim requests", async () => {
    const response = await handleClaimCollectorJob(
      post(
        "/api/collector/jobs/claim",
        { collectorId: "home-1", capabilities: ["wechat_browser"] },
        { authorization: "Bearer wrong" },
      ),
      new RouteMemoryStore(),
      { COLLECTOR_API_KEY: "collector-secret" },
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "invalid_collector_token",
    });
  });

  it("rejects collector id mismatches between auth header and body", async () => {
    const response = await handleClaimCollectorJob(
      post("/api/collector/jobs/claim", {
        collectorId: "other",
        capabilities: ["wechat_browser"],
      }),
      new RouteMemoryStore(),
      { COLLECTOR_API_KEY: "collector-secret" },
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "collector_id_mismatch",
    });
  });

  it("returns at most one claimed job", async () => {
    const response = await handleClaimCollectorJob(
      post("/api/collector/jobs/claim", {
        collectorId: "home-1",
        capabilities: ["wechat_browser"],
        maxJobs: 1,
      }),
      new RouteMemoryStore({
        id: 1,
        jobId: "job-1",
        seedUrl: "https://example.com/a",
        state: "queued",
        requestedAt: "2026-05-28T07:00:00.000Z",
        attemptNumber: 0,
        preferredRunner: "local_collector",
        runnerState: "local_pending",
        fallbackEligible: false,
      }),
      { COLLECTOR_API_KEY: "collector-secret" },
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      job: {
        jobId: "job-1",
        seedUrl: "https://example.com/a",
        attemptNumber: 1,
        preferredRunner: "local_collector",
        actualRunner: "local_collector",
        runnerState: "local_claimed",
        fallbackEligible: false,
      },
    });
  });

  it("enforces lease ownership for heartbeat routes", async () => {
    const response = await handleHeartbeatCollectorJob(
      post(
        "/api/collector/jobs/job-1/heartbeat",
        {
          collectorId: "home-1",
          localRunId: "local-1",
          stage: "capturing",
        },
        { "x-collector-id": "other" },
      ),
      "job-1",
      new RouteMemoryStore({
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
      }),
      { COLLECTOR_API_KEY: "collector-secret" },
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "collector_id_mismatch",
    });
  });

  it("accepts final reports from the lease owner", async () => {
    const response = await handleReportCollectorJob(
      post("/api/collector/jobs/job-1/report", {
        collectorId: "home-1",
        localRunId: "local-1",
        status: "completed",
        eventDraftIds: ["draft-1"],
      }),
      "job-1",
      new RouteMemoryStore({
        id: 1,
        jobId: "job-1",
        seedUrl: "https://example.com/a",
        state: "running",
        requestedAt: "2026-05-28T07:00:00.000Z",
        claimedAt: "2026-05-28T07:55:00.000Z",
        leaseExpiresAt: "2026-05-28T08:05:00.000Z",
        collectorId: "home-1",
        localRunId: "local-1",
        attemptNumber: 1,
        preferredRunner: "local_collector",
        actualRunner: "local_collector",
        runnerState: "local_running",
        fallbackEligible: false,
      }),
      { COLLECTOR_API_KEY: "collector-secret" },
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      jobId: "job-1",
      status: "completed",
    });
  });
});
