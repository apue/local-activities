import { describe, expect, it } from "vitest";

import {
  classifyAgentJobOutcome,
  formatAgentJobSmokeSummary,
  runAgentJobSmoke,
} from "./agent-job-smoke.mjs";

describe("agent job smoke", () => {
  it("creates a sandbox job, polls it, and verifies auto-published public event", async () => {
    const requests = [];
    const dbChecks = [];
    const jobRunning = buildJob({ state: "running", runnerState: "sandbox_running" });
    const jobCompleted = buildJob({
      state: "completed",
      runnerState: "completed",
      actualRunner: "vercel_sandbox",
      eventDraftIds: ["401"],
      sourceRunId: "101",
      articleSnapshotIds: ["201"],
      evidenceAssetIds: ["301"],
      suggestedDisposition: "ready_for_review",
    });

    const requestImpl = async (request) => {
      requests.push(request);
      if (
        request.method === "POST" &&
        request.path === "/api/admin/collector-jobs"
      ) {
        return jsonResult(200, {
          ok: true,
          job: jobRunning,
          sandboxStart: { status: "started", sandboxId: "sb_1" },
        });
      }

      if (
        request.method === "GET" &&
        request.path === "/api/admin/collector-jobs"
      ) {
        return jsonResult(200, { ok: true, jobs: [jobCompleted] });
      }

      if (request.method === "GET" && request.path === "/") {
        return textResult(200, "Thai Festival Beijing 2026");
      }

      if (request.method === "GET" && request.path === "/events/event-1") {
        return textResult(
          200,
          "Thai Festival Beijing 2026 北京市朝阳区朝阳公园 https://mp.weixin.qq.com/s/agent-smoke",
        );
      }

      throw new Error(`unexpected_request:${request.method}:${request.path}`);
    };
    const dbClient = {
      async findById(table, id) {
        dbChecks.push({ table, id });
        return { id };
      },
      async listDraftsByIds(ids) {
        dbChecks.push({ table: "event_drafts", ids });
        return [
          {
            id: 401,
            draft_id: "draft-public-1",
            article_url: "https://mp.weixin.qq.com/s/agent-smoke",
            review_state: "approved",
          },
        ];
      },
      async listPublishedEventsBySourceUrls(sourceUrls) {
        dbChecks.push({ table: "canonical_events", sourceUrls });
        return [
          {
            event_id: "event-1",
            title: "Thai Festival Beijing 2026",
            source_url: "https://mp.weixin.qq.com/s/agent-smoke",
            venue_name: null,
            venue_address: "北京市朝阳区朝阳公园",
            starts_at: "2026-05-30T02:30:00.000Z",
          },
        ];
      },
    };

    const result = await runAgentJobSmoke({
      env: {
        APP_BASE_URL: "https://local-activities.example",
        ADMIN_ACCESS_TOKEN: "admin-secret",
        SUPABASE_SECRET_KEY: "supabase-secret",
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      },
      seedUrl: "https://mp.weixin.qq.com/s/agent-smoke",
      requestImpl,
      dbClient,
      waitMs: async () => {},
      maxPolls: 2,
    });

    expect(requests.map((request) => [request.method, request.path])).toEqual([
      ["POST", "/api/admin/collector-jobs"],
      ["GET", "/api/admin/collector-jobs"],
      ["GET", "/"],
      ["GET", "/events/event-1"],
    ]);
    expect(requests[0].body).toEqual({
      seedUrl: "https://mp.weixin.qq.com/s/agent-smoke",
      preferredRunner: "vercel_sandbox",
    });
    expect(
      requests.some((request) => request.path.includes("/publish")),
    ).toBe(false);
    expect(dbChecks).toEqual([
      { table: "source_runs", id: "101" },
      { table: "article_snapshots", id: "201" },
      { table: "evidence_assets", id: "301" },
      { table: "event_drafts", ids: ["401"] },
      {
        table: "canonical_events",
        sourceUrls: ["https://mp.weixin.qq.com/s/agent-smoke"],
      },
    ]);
    expect(result).toMatchObject({
      kind: "passed",
      jobId: "job-1",
      outcome: "event_published",
      draftIds: ["401"],
      reviewStates: ["approved"],
      eventIds: ["event-1"],
      publicUrls: ["https://local-activities.example/events/event-1"],
    });
  });

  it("accepts structured failures as explainable smoke outcomes", async () => {
    const result = classifyAgentJobOutcome({
      state: "failed",
      runnerState: "failed",
      suggestedDisposition: "failed",
      failureIds: ["failure-1"],
      resultMessage: "captcha_required",
      fallbackEligible: false,
    });

    expect(result).toEqual({
      outcome: "structured_failure",
      terminal: true,
      passed: true,
    });
  });

  it("fails when polling never reaches an explainable outcome", async () => {
    const requestImpl = async (request) => {
      if (request.method === "POST") {
        return jsonResult(200, { ok: true, job: buildJob() });
      }
      return jsonResult(200, { ok: true, jobs: [buildJob()] });
    };

    await expect(
      runAgentJobSmoke({
        env: {
          APP_BASE_URL: "https://local-activities.example",
          ADMIN_ACCESS_TOKEN: "admin-secret",
        },
        seedUrl: "https://mp.weixin.qq.com/s/agent-smoke",
        requestImpl,
        dbClient: emptyDbClient(),
        waitMs: async () => {},
        maxPolls: 2,
      }),
    ).rejects.toThrow("agent_job_smoke_timeout:job-1");
  });

  it("formats summaries without secret values", () => {
    const summary = formatAgentJobSmokeSummary({
      kind: "passed",
      jobId: "job-1",
      outcome: "draft_ready_for_review",
      state: "completed",
      runnerState: "completed",
      actualRunner: "vercel_sandbox",
      fallbackEligible: false,
      draftIds: ["401"],
      reviewStates: ["ready_for_review"],
      eventIds: ["event-1"],
      publicUrls: ["https://local-activities.example/events/event-1"],
      failureIds: [],
      elapsedSeconds: 12,
    });

    expect(summary).toContain("Agent job smoke passed");
    expect(summary).toContain("jobId=job-1");
    expect(summary).toContain("drafts=401");
    expect(summary).toContain("events=event-1");
    expect(summary).not.toContain("admin-secret");
    expect(summary).not.toContain("supabase-secret");
  });
});

function buildJob(patch = {}) {
  return {
    id: 1,
    jobId: "job-1",
    seedUrl: "https://mp.weixin.qq.com/s/agent-smoke",
    state: "queued",
    requestedAt: "2026-05-29T02:00:00.000Z",
    attemptNumber: 0,
    preferredRunner: "vercel_sandbox",
    runnerState: "sandbox_pending",
    fallbackEligible: false,
    ...patch,
  };
}

function jsonResult(status, json) {
  return { status, json, text: JSON.stringify(json) };
}

function textResult(status, text) {
  return { status, text };
}

function emptyDbClient() {
  return {
    async findById() {
      return null;
    },
    async listDraftsByIds() {
      return [];
    },
    async listPublishedEventsBySourceUrls() {
      return [];
    },
  };
}
