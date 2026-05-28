import { describe, expect, it } from "vitest";

import type { CollectorJobRecord, CollectorJobStore } from "./collector-job-service";
import { handleSandboxFailureReport } from "./sandbox-runner-route-handlers";

class SandboxRouteStore implements CollectorJobStore {
  constructor(private readonly job: CollectorJobRecord) {}

  async createQueuedJob(): Promise<CollectorJobRecord> {
    throw new Error("not used");
  }

  async expireStaleLeases() {}

  async claimNextQueuedJob(): Promise<CollectorJobRecord | null> {
    throw new Error("not used");
  }

  async findByJobId(jobId: string) {
    return this.job.jobId === jobId ? this.job : null;
  }

  async updateSandboxStarted(): Promise<CollectorJobRecord | null> {
    throw new Error("not used");
  }

  async updateHeartbeat(): Promise<CollectorJobRecord | null> {
    throw new Error("not used");
  }

  async updateReport(): Promise<CollectorJobRecord | null> {
    throw new Error("not used");
  }

  async updateSandboxFailure(input: {
    jobId: string;
    reason: CollectorJobRecord["fallbackReason"];
    message: string;
    failedAt: string;
    fallbackEligible: boolean;
    sandboxRunId?: string;
  }) {
    if (this.job.jobId !== input.jobId) return null;
    this.job.actualRunner = "vercel_sandbox";
    this.job.fallbackReason = input.reason;
    this.job.resultMessage = input.message;
    this.job.sandboxRunId = input.sandboxRunId;
    this.job.fallbackEligible = input.fallbackEligible;
    this.job.runnerState = input.fallbackEligible
      ? "sandbox_failed_fallback_eligible"
      : "failed";
    this.job.state = input.fallbackEligible ? "queued" : "failed";
    this.job.finishedAt = input.fallbackEligible ? undefined : input.failedAt;
    return this.job;
  }
}

function request(body: unknown, token = "internal-secret") {
  return new Request(
    "https://example.com/api/internal/collector/jobs/job-1/sandbox-failure",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

describe("sandbox runner route handlers", () => {
  it("requires the internal API token", async () => {
    const response = await handleSandboxFailureReport(
      request({ reason: "captcha_required", message: "captcha" }, "wrong"),
      "job-1",
      new SandboxRouteStore(sandboxJob()),
      { INTERNAL_API_SECRET: "internal-secret" },
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "invalid_internal_token",
    });
  });

  it("records fallback-eligible sandbox failures for local collector claim", async () => {
    const response = await handleSandboxFailureReport(
      request({
        reason: "sandbox_runtime_timeout",
        message: "Sandbox exceeded runtime budget.",
        sandboxRunId: "sb-run-1",
      }),
      "job-1",
      new SandboxRouteStore(sandboxJob()),
      { INTERNAL_API_SECRET: "internal-secret" },
      new Date("2026-05-28T08:00:00.000Z"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      job: {
        jobId: "job-1",
        state: "queued",
        runnerState: "sandbox_failed_fallback_eligible",
        fallbackEligible: true,
        fallbackReason: "sandbox_runtime_timeout",
      },
    });
  });
});

function sandboxJob(): CollectorJobRecord {
  return {
    id: 1,
    jobId: "job-1",
    seedUrl: "https://example.com/a",
    state: "running",
    requestedAt: "2026-05-28T07:00:00.000Z",
    attemptNumber: 1,
    preferredRunner: "vercel_sandbox",
    actualRunner: "vercel_sandbox",
    runnerState: "sandbox_running",
    fallbackEligible: false,
  };
}
