import { describe, expect, it } from "vitest";

import {
  deriveWechat2RssHealth,
  formatWechat2RssSmokeSummary,
  normalizeWechat2RssArticleQueryResponse,
  normalizeWechat2RssLoginListResponse,
  readWechat2RssConfig,
  runWechat2RssSmoke,
} from "./wechat2rss-source.mjs";

describe("Wechat2RSS source adapter", () => {
  it("reads required collector configuration without leaking token values", () => {
    expect(
      readWechat2RssConfig({
        WECHAT2RSS_BASE_URL: "",
        WECHAT2RSS_TOKEN: "",
      }),
    ).toEqual({
      ok: false,
      error: "missing_wechat2rss_config",
      missing: ["WECHAT2RSS_BASE_URL", "WECHAT2RSS_TOKEN"],
    });

    expect(
      readWechat2RssConfig({
        WECHAT2RSS_BASE_URL: "http://localhost:4000/",
        WECHAT2RSS_TOKEN: "secret-token",
        WECHAT2RSS_LOOKBACK_DAYS: "3",
      }),
    ).toEqual({
      ok: true,
      baseUrl: "http://localhost:4000",
      token: "secret-token",
      lookbackDays: 3,
    });
  });

  it("normalizes article query responses into stable article index items", () => {
    const result = normalizeWechat2RssArticleQueryResponse({
      data: {
        list: [
          {
            id: "article-1",
            title: "Cultural Weekend",
            url: "https://mp.weixin.qq.com/s/example",
            pubDate: 1780315200,
            mpName: "Embassy Culture",
            biz: "biz-1",
            digest: "Weekend activity",
          },
          {
            title: "Missing URL",
          },
        ],
      },
    });

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]).toMatchObject({
      provider: "wechat2rss",
      rawId: "article-1",
      title: "Cultural Weekend",
      url: "https://mp.weixin.qq.com/s/example",
      publishedAt: new Date(1780315200 * 1000).toISOString(),
      sourceName: "Embassy Culture",
      sourceId: "biz-1",
      summary: "Weekend activity",
    });
    expect(result.articles[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("normalizes login health and derives product-visible source health", () => {
    const healthy = normalizeWechat2RssLoginListResponse({
      accounts: [{ nickname: "reader", status: "正常" }],
    });
    const risky = normalizeWechat2RssLoginListResponse({
      accounts: [{ nickname: "reader", status: "今日小黑屋 风控" }],
    });

    expect(healthy.accounts[0]).toMatchObject({
      name: "reader",
      status: "healthy",
    });
    expect(deriveWechat2RssHealth(healthy)).toEqual({
      healthStatus: "healthy",
    });
    expect(deriveWechat2RssHealth(risky)).toEqual({
      healthStatus: "attention_needed",
      failureReason: "fetch_blocked",
    });
    expect(deriveWechat2RssHealth({ accounts: [] })).toEqual({
      healthStatus: "attention_needed",
      failureReason: "login_required",
    });
  });

  it("runs a read-only smoke through login and query endpoints", async () => {
    const requests = [];
    const fetchImpl = async (url) => {
      requests.push(url);
      if (url.includes("/login/list")) {
        return jsonResponse({
          accounts: [{ nickname: "reader", status: "normal" }],
        });
      }
      return jsonResponse({
        data: [
          {
            title: "Activity",
            url: "https://mp.weixin.qq.com/s/activity",
            date: "2026-06-01T12:00:00+08:00",
            mpName: "Culture Org",
          },
        ],
      });
    };

    const result = await runWechat2RssSmoke({
      env: {
        WECHAT2RSS_BASE_URL: "http://localhost:4000",
        WECHAT2RSS_TOKEN: "secret-token",
        WECHAT2RSS_LOOKBACK_DAYS: "2",
      },
      fetchImpl,
      now: new Date("2026-06-02T08:00:00.000Z"),
    });

    expect(requests).toEqual([
      "http://localhost:4000/login/list?k=secret-token",
      "http://localhost:4000/api/query?k=secret-token&after=20260531&content=0",
    ]);
    expect(result).toMatchObject({
      kind: "ok",
      healthStatus: "healthy",
      accountCount: 1,
      articleCount: 1,
      after: "20260531",
    });
    expect(formatWechat2RssSmokeSummary(result)).toContain("articles=1");
    expect(formatWechat2RssSmokeSummary(result)).not.toContain("secret-token");
  });

  it("maps provider failures into structured smoke failures", async () => {
    const result = await runWechat2RssSmoke({
      env: {
        WECHAT2RSS_BASE_URL: "http://localhost:4000",
        WECHAT2RSS_TOKEN: "secret-token",
      },
      fetchImpl: async () => jsonResponse({ error: "blocked" }, 429),
      now: new Date("2026-06-02T08:00:00.000Z"),
    });

    expect(result).toMatchObject({
      kind: "failed",
      healthStatus: "attention_needed",
      failureReason: "fetch_blocked",
    });
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
