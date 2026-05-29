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
        request.path === "/api/admin/collector-jobs" &&
        request.headers.authorization === "Bearer admin-secret"
      ) {
        return jsonResult(200, { ok: true, jobs: [] });
      }

      if (
        request.path === "/api/admin/event-drafts" &&
        request.headers.authorization === "Bearer admin-secret"
      ) {
        return jsonResult(200, { ok: true, drafts: [] });
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
      "/",
      "/admin",
      "/api/admin/collector-jobs",
      "/api/admin/event-drafts",
      "/api/admin/collector-jobs",
    ]);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(calls.every((call) => call.proxyUrl === "http://127.0.0.1:7897"))
      .toBe(true);
    expect(result).toEqual({
      kind: "passed",
      baseUrl: "https://local-activities.example",
      checked: [
        "public_home",
        "admin_page",
        "admin_jobs_json",
        "admin_drafts_json",
        "admin_invalid_token_json",
      ],
      proxyUrl: "http://127.0.0.1:7897",
    });
  });

  it("builds the expected read-only request plan", () => {
    expect(
      buildAdminReadonlySmokeRequests({
        adminToken: "admin-secret",
        invalidToken: "wrong",
      }).map((request) => ({
        name: request.name,
        path: request.path,
        authorization: request.headers.authorization,
      })),
    ).toEqual([
      { name: "public_home", path: "/", authorization: undefined },
      { name: "admin_page", path: "/admin", authorization: undefined },
      {
        name: "admin_jobs_json",
        path: "/api/admin/collector-jobs",
        authorization: "Bearer admin-secret",
      },
      {
        name: "admin_drafts_json",
        path: "/api/admin/event-drafts",
        authorization: "Bearer admin-secret",
      },
      {
        name: "admin_invalid_token_json",
        path: "/api/admin/collector-jobs",
        authorization: "Bearer wrong",
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
  return { status, json, text: JSON.stringify(json) };
}

function textResult(status, text) {
  return { status, json: undefined, text };
}
