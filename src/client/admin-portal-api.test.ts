import { describe, expect, it } from "vitest";

import {
  adminApiRequest,
  loadAdminState,
  loginAdmin,
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

  it("loads jobs, drafts, and usage with the cookie session", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url, init = {}) => {
      calls.push(`${init.method ?? "GET"} ${url}`);
      if (url === "/api/admin/collector-jobs") {
        return jsonResponse(200, { ok: true, jobs: [{ jobId: "job-1" }] });
      }
      if (url === "/api/admin/event-drafts?reviewState=needs_review") {
        return jsonResponse(200, { ok: true, drafts: [{ id: "draft-1" }] });
      }
      if (url === "/api/admin/llm-usage") {
        return jsonResponse(200, {
          ok: true,
          usage: { totals: { requestCount: 1 }, byModel: [], recent: [] },
        });
      }
      return jsonResponse(404, { error: "unexpected_request" });
    };

    await expect(
      loadAdminState({ reviewFilter: "needs_review", fetchImpl }),
    ).resolves.toMatchObject({
      jobs: [{ jobId: "job-1" }],
      drafts: [{ id: "draft-1" }],
      usage: { totals: { requestCount: 1 } },
    });
    expect(calls).toEqual([
      "GET /api/admin/collector-jobs",
      "GET /api/admin/event-drafts?reviewState=needs_review",
      "GET /api/admin/llm-usage",
    ]);
  });

  it("keeps HTTP status visible when an upstream error is not JSON", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("not json", { status: 503 });

    await expect(
      adminApiRequest("/api/admin/collector-jobs", { fetchImpl }),
    ).rejects.toThrow("request_failed_503");
  });
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
