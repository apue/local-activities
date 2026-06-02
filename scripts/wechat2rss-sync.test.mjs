import { describe, expect, it } from "vitest";

import {
  articleSnapshotSchema,
  collectorEnvelopeSchema,
  sourceRunReportSchema,
} from "../src/contracts/collector";
import {
  formatWechat2RssSyncSummary,
  readWechat2RssSyncConfig,
  runWechat2RssSyncOnce,
} from "./wechat2rss-sync.mjs";

describe("Wechat2RSS one-shot sync", () => {
  it("reports missing sync configuration without leaking provided secrets", () => {
    expect(readWechat2RssSyncConfig({})).toEqual({
      ok: false,
      missing: [
        "COLLECTOR_BASE_URL",
        "COLLECTOR_API_KEY",
        "COLLECTOR_ID",
        "WECHAT2RSS_BASE_URL",
        "WECHAT2RSS_TOKEN",
      ],
    });
  });

  it("uploads one source run and deduplicated article snapshots", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
      if (url.includes("/login/list")) {
        return jsonResponse({ accounts: [{ nickname: "reader", status: "正常" }] });
      }
      if (url.includes("/api/query")) {
        return jsonResponse({
          data: [
            {
              title: "Activity",
              url: "https://mp.weixin.qq.com/s/activity",
              date: "2026-06-01T12:00:00+08:00",
              mpName: "Culture Org",
              digest: "Weekend activity",
            },
            {
              title: "Activity",
              url: "https://mp.weixin.qq.com/s/activity",
              date: "2026-06-01T12:00:00+08:00",
              mpName: "Culture Org",
              digest: "Weekend activity",
            },
          ],
        });
      }
      if (url.endsWith("/api/collector/source-run")) {
        return jsonResponse({ ok: true, id: "source-run-1" });
      }
      if (url.endsWith("/api/collector/article-snapshot")) {
        return jsonResponse({ ok: true, id: "snapshot-1" });
      }
      throw new Error(`unexpected_url:${url}`);
    };

    const result = await runWechat2RssSyncOnce({
      env: validEnv(),
      fetchImpl,
      now: new Date("2026-06-02T08:00:00.000Z"),
      runId: "wechat2rss-test",
    });

    expect(result).toEqual({
      kind: "uploaded",
      runId: "wechat2rss-test",
      sourceRunId: "source-run-1",
      articleCount: 1,
      uploadedArticleCount: 1,
      uploadedArticleSnapshotIds: ["snapshot-1"],
      after: "20260526",
    });
    expect(calls.map((call) => call.url)).toEqual([
      "http://localhost:4000/login/list?k=wechat-token",
      "http://localhost:4000/api/query?k=wechat-token&after=20260526&content=0",
      "https://activities.example/api/collector/source-run",
      "https://activities.example/api/collector/article-snapshot",
    ]);
    expect(calls[2].body.payload).toMatchObject({
      status: "success",
      articleCount: 1,
      checkedUrlCount: 1,
      failureCount: 0,
    });
    expect(calls[3].body.payload).toMatchObject({
      canonicalUrl: "https://mp.weixin.qq.com/s/activity",
      finalUrl: "https://mp.weixin.qq.com/s/activity",
      title: "Activity",
      authorName: "Culture Org",
      captureMode: "text_complete",
      evidenceAssetIds: [],
    });
    expect(calls[3].body.payload.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(() =>
      collectorEnvelopeSchema(sourceRunReportSchema).parse(calls[2].body),
    ).not.toThrow();
    expect(() =>
      collectorEnvelopeSchema(articleSnapshotSchema).parse(calls[3].body),
    ).not.toThrow();
    expect(calls[3].init.headers.authorization).toBe("Bearer collector-secret");
    expect(formatWechat2RssSyncSummary(result)).not.toContain("collector-secret");
    expect(formatWechat2RssSyncSummary(result)).not.toContain("wechat-token");
  });

  it("uploads only a failed source run when Wechat2RSS account health needs attention", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
      if (url.includes("/login/list")) {
        return jsonResponse({
          accounts: [{ nickname: "reader", status: "今日小黑屋 风控" }],
        });
      }
      return jsonResponse({ ok: true, id: "source-run-1" });
    };

    const result = await runWechat2RssSyncOnce({
      env: validEnv(),
      fetchImpl,
      now: new Date("2026-06-02T08:00:00.000Z"),
      runId: "wechat2rss-risk",
    });

    expect(result).toEqual({
      kind: "attention_needed",
      runId: "wechat2rss-risk",
      failureReason: "fetch_blocked",
      uploadedArticleCount: 0,
    });
    expect(calls.map((call) => call.url)).toEqual([
      "http://localhost:4000/login/list?k=wechat-token",
      "https://activities.example/api/collector/source-run",
    ]);
    expect(calls[1].body.payload).toMatchObject({
      status: "failed",
      failureReason: "fetch_blocked",
      failureCount: 1,
    });
  });

  it("uploads a failed source run when login health fetch fails", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
      if (url.includes("/login/list")) {
        return jsonResponse({ error: "unauthorized" }, 401);
      }
      return jsonResponse({ ok: true, id: "source-run-1" });
    };

    const result = await runWechat2RssSyncOnce({
      env: validEnv(),
      fetchImpl,
      now: new Date("2026-06-02T08:00:00.000Z"),
      runId: "wechat2rss-login-fail",
    });

    expect(result).toEqual({
      kind: "failed",
      runId: "wechat2rss-login-fail",
      failureReason: "login_required",
      uploadedArticleCount: 0,
    });
    expect(calls[1].body.payload).toMatchObject({
      status: "failed",
      failureReason: "login_required",
    });
  });

  it("surfaces collector upload failures", async () => {
    const fetchImpl = async (url) => {
      if (url.includes("/login/list")) {
        return jsonResponse({ accounts: [{ nickname: "reader", status: "正常" }] });
      }
      if (url.includes("/api/query")) {
        return jsonResponse({
          data: [
            {
              title: "Activity",
              url: "https://mp.weixin.qq.com/s/activity",
            },
          ],
        });
      }
      return jsonResponse({ ok: false, error: "invalid_collector_token" }, 401);
    };

    await expect(
      runWechat2RssSyncOnce({
        env: validEnv(),
        fetchImpl,
        now: new Date("2026-06-02T08:00:00.000Z"),
        runId: "wechat2rss-upload-fail",
      }),
    ).rejects.toThrow(
      "collector_upload_failed:/api/collector/source-run:401",
    );
  });
});

function validEnv() {
  return {
    COLLECTOR_BASE_URL: "https://activities.example",
    COLLECTOR_API_KEY: "collector-secret",
    COLLECTOR_ID: "home-1",
    WECHAT2RSS_BASE_URL: "http://localhost:4000",
    WECHAT2RSS_TOKEN: "wechat-token",
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}
