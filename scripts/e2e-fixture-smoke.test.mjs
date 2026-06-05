import { describe, expect, it } from "vitest";

import {
  buildAdminHeaders,
  formatSmokeSummary,
  runE2eFixtureSmoke,
} from "./e2e-fixture-smoke.mjs";

describe("e2e fixture smoke", () => {
  it("refuses hosted fixture publish smoke without explicit write approval", async () => {
    await expect(
      runE2eFixtureSmoke({
        env: {
          ...validEnv(),
          APP_BASE_URL: "https://branch-local-activities.vercel.app",
        },
        seedUrl: "https://mp.weixin.qq.com/s/e2e-fixture",
      }),
    ).rejects.toThrow("e2e_fixture_smoke_requires_allow_hosted_write");
  });

  it("creates a job, uploads a claimed fixture, publishes it, and verifies public detail", async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, init, body });

      if (url.endsWith("/api/admin/collector-jobs")) {
        return jsonResponse({ ok: true, job: { jobId: "job-1" } });
      }
      if (url.endsWith("/api/collector/jobs/claim")) {
        return jsonResponse({
          job: {
            jobId: "job-1",
            seedUrl: "https://mp.weixin.qq.com/s/e2e-fixture",
            requestedAt: "2026-05-28T09:59:00.000Z",
            leaseExpiresAt: "2026-05-28T10:10:00.000Z",
            attemptNumber: 1,
          },
        });
      }
      if (url.endsWith("/heartbeat") || url.endsWith("/report")) {
        return jsonResponse({ ok: true });
      }
      if (url.endsWith("/api/collector/source-run")) {
        return jsonResponse({ ok: true, id: "source-run-1" });
      }
      if (url.endsWith("/api/collector/article-snapshot")) {
        return jsonResponse({ ok: true, id: "article-1" });
      }
      if (url.endsWith("/api/collector/event-draft")) {
        return jsonResponse({ ok: true, id: "draft-1" });
      }
      if (url.endsWith("/api/admin/event-drafts/draft-1/publish")) {
        return jsonResponse({
          ok: true,
          event: {
            id: "event-1",
            title: "Fixture Cultural Activity",
            status: "published",
            publishedAt: "2026-05-28T10:00:00.000Z",
          },
        });
      }
      if (url.endsWith("/events/event-1")) {
        return textResponse("<html><h1>Fixture Cultural Activity</h1></html>");
      }

      throw new Error(`unexpected_url:${url}`);
    };

    const result = await runE2eFixtureSmoke({
      env: {
        APP_BASE_URL: "https://local-activities.example",
        ADMIN_ACCESS_TOKEN: "admin-secret",
        COLLECTOR_API_KEY: "collector-secret",
        COLLECTOR_ID: "home-1",
      },
      fetchImpl,
      now: new Date("2026-05-28T10:00:00.000Z"),
      seedUrl: "https://mp.weixin.qq.com/s/e2e-fixture",
      runId: "fixture-e2e",
      allowHostedWrite: true,
      allowPublicFixtureData: true,
    });

    expect(calls.map((call) => call.url)).toEqual([
      "https://local-activities.example/api/admin/collector-jobs",
      "https://local-activities.example/api/collector/jobs/claim",
      "https://local-activities.example/api/collector/jobs/job-1/heartbeat",
      "https://local-activities.example/api/collector/source-run",
      "https://local-activities.example/api/collector/article-snapshot",
      "https://local-activities.example/api/collector/event-draft",
      "https://local-activities.example/api/collector/jobs/job-1/report",
      "https://local-activities.example/api/admin/event-drafts/draft-1/publish",
      "https://local-activities.example/events/event-1",
    ]);
    expect(calls[0].body).toEqual({
      seedUrl: "https://mp.weixin.qq.com/s/e2e-fixture",
      preferredRunner: "local_collector",
    });
    expect(calls[0].init.headers.authorization).toBe("Bearer admin-secret");
    expect(calls[1].init.headers.authorization).toBe("Bearer collector-secret");
    expect(result).toEqual({
      kind: "passed",
      jobId: "job-1",
      runId: "fixture-e2e",
      draftId: "draft-1",
      eventId: "event-1",
      publicUrl: "https://local-activities.example/events/event-1",
      target: {
        baseUrl: "https://local-activities.example",
        hostname: "local-activities.example",
        kind: "test",
      },
      writeMode: "publish_fixture_event",
    });
  });

  it("formats summaries without admin or collector token values", () => {
    const summary = formatSmokeSummary({
      kind: "passed",
      jobId: "job-1",
      runId: "fixture-e2e",
      draftId: "draft-1",
      eventId: "event-1",
      publicUrl: "https://local-activities.example/events/event-1",
      target: {
        baseUrl: "https://local-activities.example",
        hostname: "local-activities.example",
        kind: "test",
      },
      writeMode: "publish_fixture_event",
    });

    expect(summary).toContain("event-1");
    expect(summary).toContain("writeMode=publish_fixture_event");
    expect(summary).toContain("https://local-activities.example/events/event-1");
    expect(summary).not.toContain("admin-secret");
    expect(summary).not.toContain("collector-secret");
  });

  it("builds admin auth headers", () => {
    expect(buildAdminHeaders("admin-token")).toEqual({
      authorization: "Bearer admin-token",
      "content-type": "application/json",
    });
  });
});

function validEnv() {
  return {
    APP_BASE_URL: "https://local-activities.example",
    ADMIN_ACCESS_TOKEN: "admin-secret",
    COLLECTOR_API_KEY: "collector-secret",
    COLLECTOR_ID: "home-1",
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

function textResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return JSON.parse(body);
    },
    async text() {
      return body;
    },
  };
}
