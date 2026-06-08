import { describe, expect, it } from "vitest";

import {
  buildAdminReadonlySmokeRequests,
  formatAdminReadonlySmokeSummary,
  runAdminReadonlySmoke,
} from "./admin-readonly-smoke.mjs";

describe("admin readonly smoke", () => {
  it("checks public pages, admin list APIs, and invalid-token auth without writes", async () => {
    const calls = [];
    const requestImpl = async (request) => {
      calls.push(request);

      if (request.path === "/" || request.path === "/admin") {
        return textResult(200, "<html>ok</html>");
      }

      if (
        request.path === "/api/admin/login" &&
        request.method === "POST" &&
        request.body === JSON.stringify({ token: "admin-secret" })
      ) {
        return {
          ...jsonResult(200, { ok: true }),
          headers: { "set-cookie": "admin_session=admin-secret; HttpOnly" },
        };
      }

      if (
        request.path === "/api/admin/collector-jobs" &&
        request.headers.cookie === "admin_session=admin-secret"
      ) {
        return jsonResult(200, { ok: true, jobs: [] });
      }

      if (
        request.path === "/api/admin/event-drafts" &&
        request.headers.cookie === "admin_session=admin-secret"
      ) {
        return jsonResult(200, { ok: true, drafts: [] });
      }

      if (
        request.path === "/api/admin/excluded-articles" &&
        request.headers.cookie === "admin_session=admin-secret"
      ) {
        return jsonResult(200, { ok: true, excludedArticles: [] });
      }

      if (
        request.path === "/api/admin/processing-ledger?mode=production" &&
        request.headers.cookie === "admin_session=admin-secret"
      ) {
        return jsonResult(200, { ok: true, ledger: [] });
      }

      if (
        request.path === "/api/admin/evaluation-runs" &&
        request.headers.cookie === "admin_session=admin-secret"
      ) {
        return jsonResult(200, { ok: true, evaluationRuns: [] });
      }

      if (
        request.path.startsWith("/api/admin/llm-usage?range=") &&
        request.headers.cookie === "admin_session=admin-secret"
      ) {
        const range = new URL(
          request.path,
          "https://local-activities.example",
        ).searchParams.get("range");
        return jsonResult(200, {
          ok: true,
          usage: {
            range: { key: range },
            totals: { requestCount: 0 },
            byModel: [],
            byEnvironment: [],
            byRun: [],
            recent: [],
          },
        });
      }

      if (
        request.path === "/api/admin/collector-jobs" &&
        request.headers.authorization === "Bearer smoke-invalid-admin-token"
      ) {
        return jsonResult(401, { ok: false, error: "invalid_admin_token" });
      }

      throw new Error(`unexpected_request:${request.path}`);
    };

    const result = await runAdminReadonlySmoke({
      env: {
        APP_BASE_URL: "https://local-activities.example/",
        ADMIN_ACCESS_TOKEN: "admin-secret",
        LOCAL_TEST_HTTPS_PROXY: "http://127.0.0.1:7897",
      },
      requestImpl,
    });

    expect(calls.map((call) => call.path)).toEqual([
      "/api/admin/login",
      "/",
      "/admin",
      "/api/admin/collector-jobs",
      "/api/admin/event-drafts",
      "/api/admin/excluded-articles",
      "/api/admin/processing-ledger?mode=production",
      "/api/admin/evaluation-runs",
      "/api/admin/llm-usage?range=today",
      "/api/admin/llm-usage?range=7d",
      "/api/admin/llm-usage?range=all",
      "/api/admin/collector-jobs",
    ]);
    expect(calls.map((call) => call.method)).toEqual([
      "POST",
      "GET",
      "GET",
      "GET",
      "GET",
      "GET",
      "GET",
      "GET",
      "GET",
      "GET",
      "GET",
      "GET",
    ]);
    expect(calls.every((call) => call.proxyUrl === "http://127.0.0.1:7897"))
      .toBe(true);
    expect(result).toEqual({
      kind: "passed",
      baseUrl: "https://local-activities.example",
      checked: [
        "admin_login",
        "public_home",
        "admin_page",
        "admin_jobs_json",
        "admin_drafts_json",
        "admin_excluded_articles_json",
        "admin_processing_ledger_json",
        "admin_evaluation_runs_json",
        "admin_usage_today_json",
        "admin_usage_7d_json",
        "admin_usage_all_json",
        "admin_invalid_token_json",
      ],
      proxyUrl: "http://127.0.0.1:7897",
    });
  });

  it("builds the expected read-only request plan", () => {
    expect(
      buildAdminReadonlySmokeRequests({
        adminCookie: "admin_session=admin-secret",
        invalidToken: "wrong",
      }).map((request) => ({
        name: request.name,
        path: request.path,
        authorization: request.headers.authorization,
        cookie: request.headers.cookie,
      })),
    ).toEqual([
      {
        name: "public_home",
        path: "/",
        authorization: undefined,
        cookie: undefined,
      },
      {
        name: "admin_page",
        path: "/admin",
        authorization: undefined,
        cookie: undefined,
      },
      {
        name: "admin_login",
        path: "/api/admin/login",
        authorization: undefined,
        cookie: undefined,
      },
      {
        name: "admin_jobs_json",
        path: "/api/admin/collector-jobs",
        authorization: undefined,
        cookie: "admin_session=admin-secret",
      },
      {
        name: "admin_drafts_json",
        path: "/api/admin/event-drafts",
        authorization: undefined,
        cookie: "admin_session=admin-secret",
      },
      {
        name: "admin_excluded_articles_json",
        path: "/api/admin/excluded-articles",
        authorization: undefined,
        cookie: "admin_session=admin-secret",
      },
      {
        name: "admin_processing_ledger_json",
        path: "/api/admin/processing-ledger?mode=production",
        authorization: undefined,
        cookie: "admin_session=admin-secret",
      },
      {
        name: "admin_evaluation_runs_json",
        path: "/api/admin/evaluation-runs",
        authorization: undefined,
        cookie: "admin_session=admin-secret",
      },
      {
        name: "admin_usage_today_json",
        path: "/api/admin/llm-usage?range=today",
        authorization: undefined,
        cookie: "admin_session=admin-secret",
      },
      {
        name: "admin_usage_7d_json",
        path: "/api/admin/llm-usage?range=7d",
        authorization: undefined,
        cookie: "admin_session=admin-secret",
      },
      {
        name: "admin_usage_all_json",
        path: "/api/admin/llm-usage?range=all",
        authorization: undefined,
        cookie: "admin_session=admin-secret",
      },
      {
        name: "admin_invalid_token_json",
        path: "/api/admin/collector-jobs",
        authorization: "Bearer wrong",
        cookie: undefined,
      },
    ]);
  });

  it("formats summaries without secret values", () => {
    const summary = formatAdminReadonlySmokeSummary({
      kind: "passed",
      baseUrl: "https://local-activities.example",
      checked: ["public_home", "admin_jobs_json"],
      proxyUrl: "http://127.0.0.1:7897",
    });

    expect(summary).toContain("Admin readonly smoke passed");
    expect(summary).toContain("https://local-activities.example");
    expect(summary).toContain("proxy=enabled");
    expect(summary).not.toContain("admin-secret");
  });
});

function jsonResult(status, json) {
  return { status, json, text: JSON.stringify(json), headers: {} };
}

function textResult(status, text) {
  return { status, json: undefined, text, headers: {} };
}
