import { describe, expect, it } from "vitest";

import {
  claimJobRequestSchema,
  claimJobResponseSchema,
  heartbeatRequestSchema,
  jobReportRequestSchema,
} from "./collector-job";

describe("collector job contracts", () => {
  it("accepts a single-job claim request with collector capabilities", () => {
    const result = claimJobRequestSchema.parse({
      collectorId: "home-192-168-0-16",
      capabilities: ["agent_api", "wechat_browser", "image_capture"],
      maxJobs: 1,
    });

    expect(result.maxJobs).toBe(1);
  });

  it("rejects batch claiming for the MVP", () => {
    expect(() =>
      claimJobRequestSchema.parse({
        collectorId: "home-192-168-0-16",
        capabilities: ["wechat_browser"],
        maxJobs: 2,
      }),
    ).toThrow();
  });

  it("accepts local collector claim responses", () => {
    const result = claimJobResponseSchema.parse({
      job: {
        jobId: "job-1",
        seedUrl: "https://example.com/a",
        requestedAt: "2026-05-28T08:00:00.000Z",
        leaseExpiresAt: "2026-05-28T08:10:00.000Z",
        attemptNumber: 2,
        preferredRunner: "local_collector",
        actualRunner: "local_collector",
        runnerState: "local_claimed",
        fallbackEligible: false,
      },
    });

    expect(result.job?.runnerState).toBe("local_claimed");
    expect(() =>
      claimJobResponseSchema.parse({
        job: {
          jobId: "job-1",
          seedUrl: "https://example.com/a",
          requestedAt: "2026-05-28T08:00:00.000Z",
          leaseExpiresAt: "2026-05-28T08:10:00.000Z",
          attemptNumber: 1,
          preferredRunner: "vercel_sandbox",
          runnerState: "sandbox_pending",
          fallbackEligible: false,
        },
      }),
    ).toThrow();
  });

  it("accepts heartbeat progress without leaking raw page dumps", () => {
    const result = heartbeatRequestSchema.parse({
      collectorId: "home-192-168-0-16",
      localRunId: "local-run-001",
      stage: "extracting",
      message: "vision extraction running",
      extendLeaseSeconds: 120,
    });

    expect(result.stage).toBe("extracting");
  });

  it("rejects final job reports with unsupported statuses", () => {
    expect(() =>
      jobReportRequestSchema.parse({
        collectorId: "home-192-168-0-16",
        localRunId: "local-run-001",
        status: "published",
      }),
    ).toThrow();
  });

  it("accepts diagnostic suggested disposition but not publish instructions", () => {
    const result = jobReportRequestSchema.parse({
      collectorId: "home-192-168-0-16",
      localRunId: "local-run-001",
      status: "partial",
      eventDraftIds: ["draft-1"],
      suggestedDisposition: "needs_review",
    });

    expect(result.suggestedDisposition).toBe("needs_review");
    expect(() =>
      jobReportRequestSchema.parse({
        collectorId: "home-192-168-0-16",
        localRunId: "local-run-001",
        status: "completed",
        suggestedDisposition: "publish_now",
      }),
    ).toThrow();
  });
});
