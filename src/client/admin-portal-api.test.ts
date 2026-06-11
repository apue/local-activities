import { describe, expect, it } from "vitest";

import {
  adminApiRequest,
  createAdminFeedback,
  listAdminFeedback,
  loadAdminState,
  loginAdmin,
  patchAdminDraft,
} from "./admin-portal-api";

describe("admin portal API client", () => {
  it("logs in with a token through the cookie session endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return jsonResponse(200, { ok: true });
    };

    await loginAdmin({ token: "admin-secret", fetchImpl });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "/api/admin/login",
      init: {
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ token: "admin-secret" }),
      },
    });
    expect(calls[0].init.headers).toEqual({
      "content-type": "application/json",
    });
  });

  it("uses same-origin cookie credentials without bearer authorization", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return jsonResponse(200, { ok: true, jobs: [] });
    };

    await adminApiRequest<{ jobs: unknown[] }>("/api/admin/collector-jobs", {
      fetchImpl,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].init.credentials).toBe("same-origin");
    expect(calls[0].init.headers).toEqual({
      "content-type": "application/json",
    });
    expect(JSON.stringify(calls[0].init)).not.toContain("authorization");
    expect(JSON.stringify(calls[0].init)).not.toContain("admin-secret");
  });

  it("loads jobs, drafts, usage, article audit, excluded articles, eval reports, and pipeline traces", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url, init = {}) => {
      calls.push(`${init.method ?? "GET"} ${url}`);
      if (url === "/api/admin/collector-jobs") {
        return jsonResponse(200, { ok: true, jobs: [{ jobId: "job-1" }] });
      }
      if (url === "/api/admin/event-drafts?reviewState=needs_review") {
        return jsonResponse(200, { ok: true, drafts: [{ id: "draft-1" }] });
      }
      if (url === "/api/admin/llm-usage?range=all") {
        return jsonResponse(200, {
          ok: true,
          usage: { totals: { requestCount: 1 }, byModel: [], recent: [] },
        });
      }
      if (url === "/api/admin/excluded-articles") {
        return jsonResponse(200, {
          ok: true,
          excludedArticles: [{ id: "excluded-1" }],
        });
      }
      if (url === "/api/admin/processing-ledger?dataClass=production") {
        return jsonResponse(200, {
          ok: true,
          ledger: [{ id: "ledger-1" }],
        });
      }
      if (url === "/api/admin/evaluation-runs?validity=valid") {
        return jsonResponse(200, {
          ok: true,
          evaluationRuns: [{ runId: "eval-1" }],
        });
      }
      if (url === "/api/admin/pipeline-runs?dataClass=production") {
        return jsonResponse(200, {
          ok: true,
          pipelineRuns: [{ runId: "pipe-1" }],
        });
      }
      return jsonResponse(404, { error: "unexpected_request" });
    };

    await expect(
      loadAdminState({
        reviewFilter: "needs_review",
        usageRange: "all",
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      jobs: [{ jobId: "job-1" }],
      drafts: [{ id: "draft-1" }],
      usage: { totals: { requestCount: 1 } },
      excludedArticles: [{ id: "excluded-1" }],
      ledger: [{ id: "ledger-1" }],
      evaluationRuns: [{ runId: "eval-1" }],
      pipelineRuns: [{ runId: "pipe-1" }],
    });
    expect(calls).toEqual([
      "GET /api/admin/collector-jobs",
      "GET /api/admin/event-drafts?reviewState=needs_review",
      "GET /api/admin/llm-usage?range=all",
      "GET /api/admin/excluded-articles",
      "GET /api/admin/processing-ledger?dataClass=production",
      "GET /api/admin/evaluation-runs?validity=valid",
      "GET /api/admin/pipeline-runs?dataClass=production",
    ]);
  });

  it("sends rejection reasons through the draft action endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return jsonResponse(200, { ok: true, draft: { id: "draft-1" } });
    };

    await adminApiRequest("/api/admin/event-drafts/draft-1/reject", {
      fetchImpl,
      method: "POST",
      body: JSON.stringify({
        reason: "Human rejected as non-public.",
      }),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "/api/admin/event-drafts/draft-1/reject",
      init: {
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          reason: "Human rejected as non-public.",
        }),
      },
    });
  });

  it("keeps HTTP status visible when an upstream error is not JSON", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("not json", { status: 503 });

    await expect(
      adminApiRequest("/api/admin/collector-jobs", { fetchImpl }),
    ).rejects.toThrow("request_failed_503");
  });

  it("surfaces backend error messages before stable error codes", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse(400, {
        ok: false,
        error: "draft_not_publishable",
        message: "Operator override reason required",
      });

    await expect(
      adminApiRequest("/api/admin/event-drafts/draft-1/publish", { fetchImpl }),
    ).rejects.toThrow("Operator override reason required");
  });

  it("patches editable draft fields through the cookie session", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return jsonResponse(200, { ok: true, draft: { id: "draft-1" } });
    };

    await patchAdminDraft({
      draftId: "draft-1",
      patch: {
        scheduleText: "至8月30日，周二至周日 10:00-18:00",
        venueName: "Goethe 798",
      },
      fetchImpl,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "/api/admin/event-drafts/draft-1",
      init: {
        method: "PATCH",
        credentials: "same-origin",
        body: JSON.stringify({
          scheduleText: "至8月30日，周二至周日 10:00-18:00",
          venueName: "Goethe 798",
        }),
      },
    });
    expect(JSON.stringify(calls[0].init)).not.toContain("authorization");
  });

  it("lists structured feedback for selected draft details", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return jsonResponse(200, {
        ok: true,
        feedback: [{ id: "feedback-1", draftId: "draft-1" }],
      });
    };

    await expect(
      listAdminFeedback({
        dataClass: "production",
        draftId: "draft-1",
        articleBundleId: "bundle-1",
        fetchImpl,
      }),
    ).resolves.toEqual({
      ok: true,
      feedback: [{ id: "feedback-1", draftId: "draft-1" }],
    });

    expect(calls).toHaveLength(1);
    const [path, query = ""] = calls[0].url.split("?");
    expect(path).toBe("/api/admin/feedback");
    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({
      data_class: "production",
      article_bundle_id: "bundle-1",
      draft_id: "draft-1",
    });
    expect(calls[0].init.credentials).toBe("same-origin");
    expect(JSON.stringify(calls[0].init)).not.toContain("authorization");
  });

  it("creates structured feedback through the cookie session", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return jsonResponse(200, {
        ok: true,
        feedback: { id: "feedback-1", feedbackType: "missing_qr" },
      });
    };

    await createAdminFeedback({
      feedback: {
        dataClass: "production",
        feedbackType: "missing_qr",
        draftId: "draft-1",
        articleBundleId: "bundle-1",
        oldValue: "missing",
        reason: "QR exists in the source image.",
      },
      fetchImpl,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "/api/admin/feedback",
      init: {
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({
          dataClass: "production",
          feedbackType: "missing_qr",
          draftId: "draft-1",
          articleBundleId: "bundle-1",
          oldValue: "missing",
          reason: "QR exists in the source image.",
        }),
      },
    });
    expect(JSON.stringify(calls[0].init)).not.toContain("authorization");
  });
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
