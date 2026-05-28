import { describe, expect, it } from "vitest";

import {
  articleSnapshotSchema,
  collectorEnvelopeSchema,
  collectorFailureSchema,
  eventDraftUploadSchema,
  sourceRunReportSchema,
} from "../src/contracts/collector";
import {
  buildFixtureRun,
  createCollectorHeaders,
  formatFixtureSummary,
  runCollectorFixture,
} from "./collector-fixture-run.mjs";

describe("collector fixture runner", () => {
  it("builds a deterministic ready-event fixture without publication state", () => {
    const fixture = buildFixtureRun({
      collectorId: "home-1",
      runId: "fixture-001",
      seedUrl: "https://mp.weixin.qq.com/s/example",
      fixture: "ready-event",
      now: new Date("2026-05-28T09:00:00.000Z"),
    });

    expect(fixture.sourceRun.payload).toMatchObject({
      seedUrl: "https://mp.weixin.qq.com/s/example",
      status: "success",
      draftCount: 1,
    });
    expect(fixture.articleSnapshot?.payload).toMatchObject({
      canonicalUrl: "https://mp.weixin.qq.com/s/example",
      captureMode: "text_complete",
    });
    expect(fixture.eventDraft?.payload).toMatchObject({
      title: "Fixture Cultural Activity",
      timezone: "Asia/Shanghai",
      city: "Beijing",
      signals: ["ready_for_review"],
    });
    expect(fixture.eventDraft?.payload).not.toHaveProperty("status");
    expect(fixture.eventDraft?.payload).not.toHaveProperty("publishedAt");
  });

  it("builds payloads accepted by the shared collector contracts", () => {
    const readyFixture = buildFixtureRun({
      collectorId: "home-1",
      runId: "fixture-ready",
      seedUrl: "https://mp.weixin.qq.com/s/example",
      fixture: "ready-event",
      now: new Date("2026-05-28T09:00:00.000Z"),
    });
    const failureFixture = buildFixtureRun({
      collectorId: "home-1",
      runId: "fixture-failure",
      seedUrl: "https://mp.weixin.qq.com/s/example",
      fixture: "failure",
      now: new Date("2026-05-28T09:00:00.000Z"),
    });

    expect(() =>
      collectorEnvelopeSchema(sourceRunReportSchema).parse(
        readyFixture.sourceRun,
      ),
    ).not.toThrow();
    expect(() =>
      collectorEnvelopeSchema(articleSnapshotSchema).parse(
        readyFixture.articleSnapshot,
      ),
    ).not.toThrow();
    expect(() =>
      collectorEnvelopeSchema(eventDraftUploadSchema).parse(
        readyFixture.eventDraft,
      ),
    ).not.toThrow();
    expect(() =>
      collectorEnvelopeSchema(collectorFailureSchema).parse(
        failureFixture.collectorFailure,
      ),
    ).not.toThrow();
  });

  it("builds collector auth headers without exposing token in summaries", () => {
    const headers = createCollectorHeaders({
      collectorId: "home-1",
      collectorApiKey: "collector-secret-value",
    });
    const summary = formatFixtureSummary({
      kind: "uploaded",
      runId: "fixture-001",
      uploadedIds: {
        sourceRunId: "source-run-1",
        articleSnapshotId: "article-1",
        eventDraftId: "draft-1",
      },
    });

    expect(headers.authorization).toBe("Bearer collector-secret-value");
    expect(headers["x-collector-id"]).toBe("home-1");
    expect(summary).toContain("fixture-001");
    expect(summary).toContain("draft-1");
    expect(summary).not.toContain("collector-secret-value");
  });

  it("uploads a manual ready-event fixture through collector APIs", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    const result = await runCollectorFixture({
      env: {
        COLLECTOR_BASE_URL: "https://activities.example",
        COLLECTOR_API_KEY: "collector-secret",
        COLLECTOR_ID: "home-1",
      },
      fetchImpl,
      now: new Date("2026-05-28T09:00:00.000Z"),
      seedUrl: "https://mp.weixin.qq.com/s/example",
      runId: "fixture-001",
      fixture: "ready-event",
    });

    expect(calls.map((call) => call.url)).toEqual([
      "https://activities.example/api/collector/source-run",
      "https://activities.example/api/collector/article-snapshot",
      "https://activities.example/api/collector/event-draft",
    ]);
    expect(calls[0].init.headers.authorization).toBe("Bearer collector-secret");
    expect(calls[0].body.collectorId).toBe("home-1");
    expect(calls[0].body.runId).toBe("fixture-001");
    expect(result).toEqual({
      kind: "uploaded",
      runId: "fixture-001",
      uploadedIds: {
        sourceRunId: "id-1",
        articleSnapshotId: "id-2",
        eventDraftId: "id-3",
      },
    });
  });

  it("can claim one Vercel job, heartbeat, upload a failure, and report", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      if (url.endsWith("/api/collector/jobs/claim")) {
        return jsonResponse({
          job: {
            jobId: "job-1",
            seedUrl: "https://mp.weixin.qq.com/s/job",
            requestedAt: "2026-05-28T08:59:00.000Z",
            leaseExpiresAt: "2026-05-28T09:10:00.000Z",
            attemptNumber: 1,
          },
        });
      }

      if (url.endsWith("/heartbeat") || url.endsWith("/report")) {
        return jsonResponse({ ok: true });
      }

      return jsonResponse({ ok: true, id: `id-${calls.length}` });
    };

    const result = await runCollectorFixture({
      env: {
        COLLECTOR_BASE_URL: "https://activities.example",
        COLLECTOR_API_KEY: "collector-secret",
        COLLECTOR_ID: "home-1",
      },
      fetchImpl,
      now: new Date("2026-05-28T09:00:00.000Z"),
      claimOnce: true,
      runId: "fixture-claimed",
      fixture: "failure",
    });

    expect(calls.map((call) => call.url)).toEqual([
      "https://activities.example/api/collector/jobs/claim",
      "https://activities.example/api/collector/jobs/job-1/heartbeat",
      "https://activities.example/api/collector/source-run",
      "https://activities.example/api/collector/failure",
      "https://activities.example/api/collector/jobs/job-1/report",
    ]);
    expect(calls.at(-1).body).toMatchObject({
      collectorId: "home-1",
      localRunId: "fixture-claimed",
      status: "failed",
      sourceRunId: "id-3",
      failureIds: ["id-4"],
      suggestedDisposition: "failed",
    });
    expect(result.kind).toBe("uploaded");
  });

  it("stops before uploading when the claimed job does not match the expected job", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return jsonResponse({
        job: {
          jobId: "old-job",
          seedUrl: "https://mp.weixin.qq.com/s/old",
          requestedAt: "2026-05-28T08:59:00.000Z",
          leaseExpiresAt: "2026-05-28T09:10:00.000Z",
          attemptNumber: 1,
        },
      });
    };

    await expect(
      runCollectorFixture({
        env: {
          COLLECTOR_BASE_URL: "https://activities.example",
          COLLECTOR_API_KEY: "collector-secret",
          COLLECTOR_ID: "home-1",
        },
        fetchImpl,
        now: new Date("2026-05-28T09:00:00.000Z"),
        claimOnce: true,
        expectedJobId: "new-job",
        runId: "fixture-claimed",
        fixture: "ready-event",
      }),
    ).rejects.toThrow("claimed_unexpected_job");

    expect(calls.map((call) => call.url)).toEqual([
      "https://activities.example/api/collector/jobs/claim",
    ]);
  });
});

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}
