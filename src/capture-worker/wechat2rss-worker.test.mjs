import { describe, expect, it } from "vitest";

import { runWechat2RssCaptureOnce } from "./wechat2rss-worker.mjs";

describe("Wechat2RSS capture worker", () => {
  it("polls healthy Wechat2RSS articles, builds bundles, and dry-runs analysis payloads", async () => {
    const queries = [];
    const result = await runWechat2RssCaptureOnce({
      now: new Date("2026-06-08T12:00:00.000Z"),
      dataClass: "production",
      dryRun: true,
      wechat2rss: fakeWechat2Rss({
        accounts: [{ status: "healthy", name: "account" }],
        articles: [sampleArticle("dry-run")],
        queries,
      }),
      idempotency: fakeIdempotency(),
      supabase: throwingSupabase(),
    });

    expect(result).toMatchObject({
      ok: true,
      dataClass: "production",
      dryRun: true,
      checkedCount: 1,
      bundledCount: 1,
      uploadedCount: 0,
      triggeredCount: 0,
      skippedCount: 0,
      failureCount: 0,
    });
    expect(result.bundles).toHaveLength(1);
    expect(result.bundles[0]).toMatchObject({
      sourceUrl: "https://mp.weixin.qq.com/s/dry-run",
      sourceProvider: "wechat2rss",
      storagePrefix: expect.stringMatching(/^article-bundles\/production\/bundle_[a-f0-9]{24}$/),
      edgePayload: {
        sourceUrl: "https://mp.weixin.qq.com/s/dry-run",
        sourceProvider: "wechat2rss",
        sourceId: "source-dry-run",
        sourceName: "Source dry-run",
        dataClass: "production",
      },
    });
    expect(queries).toEqual([{ after: "20260601", content: true }]);
  });

  it("uploads and invokes analysis for new articles", async () => {
    const uploaded = [];
    const progress = [];
    const result = await runWechat2RssCaptureOnce({
      now: new Date("2026-06-08T12:00:00.000Z"),
      dryRun: false,
      onProgress: (event) => progress.push(event),
      wechat2rss: fakeWechat2Rss({
        accounts: [{ status: "healthy", name: "account" }],
        articles: [sampleArticle("upload")],
      }),
      idempotency: fakeIdempotency(),
      supabase: {
        async uploadAndAnalyzeBundle(input) {
          uploaded.push(input);
          return {
            sourceUrl: input.manifest.sourceUrl,
            publishedAt: input.manifest.publishedAt,
            bundleId: input.manifest.bundleId,
            storagePrefix: input.storagePrefix,
            contentHash: input.manifest.contentHash,
            sourceProvider: input.manifest.sourceProvider,
            sourceId: input.manifest.sourceId,
            sourceName: input.manifest.sourceName,
            dataClass: input.manifest.dataClass,
          };
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      checkedCount: 1,
      bundledCount: 1,
      uploadedCount: 1,
      triggeredCount: 1,
      skippedCount: 0,
      failureCount: 0,
    });
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0].files.map((file) => file.path)).toContain("manifest.json");
    expect(progress.map((event) => event.type)).toEqual([
      "article_started",
      "article_bundled",
      "article_completed",
    ]);
    expect(progress[0]).toMatchObject({
      index: 1,
      total: 1,
      sourceUrl: "https://mp.weixin.qq.com/s/upload",
    });
    expect(progress[2]).toMatchObject({
      dryRun: false,
      sourceUrl: "https://mp.weixin.qq.com/s/upload",
    });
  });

  it("hydrates WeChat image bytes before uploading analysis bundles", async () => {
    const uploaded = [];
    const fetched = [];
    const result = await runWechat2RssCaptureOnce({
      now: new Date("2026-06-08T12:00:00.000Z"),
      dryRun: false,
      wechat2rss: fakeWechat2Rss({
        accounts: [{ status: "healthy", name: "account" }],
        articles: [
          {
            ...sampleArticle("image-bytes"),
            contentHtml:
              '<p>Scan the QR to register</p><img data-src="https://mmbiz.qpic.cn/poster.jpg" alt="活动海报" width="900" height="1200" />',
          },
        ],
      }),
      idempotency: fakeIdempotency(),
      fetchImpl: async (url, init) => {
        fetched.push({ url, referer: init?.headers?.referer });
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      },
      supabase: {
        async uploadAndAnalyzeBundle(input) {
          uploaded.push(input);
        },
      },
    });

    expect(result).toMatchObject({ ok: true, failureCount: 0 });
    expect(fetched).toEqual([
      {
        url: "https://mmbiz.qpic.cn/poster.jpg",
        referer: "https://mp.weixin.qq.com/s/image-bytes",
      },
    ]);
    expect(uploaded[0].files.map((file) => file.path)).toContain(
      "images/image-001.jpg",
    );
    expect(uploaded[0].files.map((file) => file.path)).not.toContain(
      "images/image-001.reference.json",
    );
    expect(uploaded[0].manifest.images[0]).toMatchObject({
      id: "image-001",
      path: "images/image-001.jpg",
      hasBytes: true,
      contentType: "image/jpeg",
    });
  });

  it("queries the full lookback but processes only the limited article subset", async () => {
    const uploaded = [];
    const idempotencyChecks = [];
    const result = await runWechat2RssCaptureOnce({
      now: new Date("2026-06-08T12:00:00.000Z"),
      dryRun: false,
      limit: 2,
      wechat2rss: fakeWechat2Rss({
        accounts: [{ status: "healthy", name: "account" }],
        articles: [
          sampleArticle("first"),
          sampleArticle("second"),
          sampleArticle("third"),
        ],
      }),
      idempotency: {
        async findExistingBundle(input) {
          idempotencyChecks.push(input.sourceUrl);
          return null;
        },
      },
      supabase: {
        async uploadAndAnalyzeBundle(input) {
          uploaded.push(input.manifest.sourceUrl);
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      checkedCount: 3,
      consideredCount: 2,
      limit: 2,
      bundledCount: 2,
      uploadedCount: 2,
      triggeredCount: 2,
      skippedCount: 0,
      failureCount: 0,
    });
    expect(idempotencyChecks).toEqual([
      "https://mp.weixin.qq.com/s/first",
      "https://mp.weixin.qq.com/s/second",
    ]);
    expect(uploaded).toEqual([
      "https://mp.weixin.qq.com/s/first",
      "https://mp.weixin.qq.com/s/second",
    ]);
  });

  it("skips articles that already have an article bundle row", async () => {
    const progress = [];
    const result = await runWechat2RssCaptureOnce({
      now: new Date("2026-06-08T12:00:00.000Z"),
      dryRun: false,
      onProgress: (event) => progress.push(event),
      wechat2rss: fakeWechat2Rss({
        accounts: [{ status: "healthy", name: "account" }],
        articles: [sampleArticle("existing")],
      }),
      idempotency: fakeIdempotency({
        existing: {
          bundleId: "bundle_existing",
          storagePrefix: "article-bundles/production/bundle_existing",
          status: "processed",
        },
      }),
      supabase: throwingSupabase(),
    });

    expect(result).toMatchObject({
      ok: true,
      checkedCount: 1,
      bundledCount: 0,
      uploadedCount: 0,
      triggeredCount: 0,
      skippedCount: 1,
      failureCount: 0,
    });
    expect(result.skipped).toEqual([
      {
        sourceUrl: "https://mp.weixin.qq.com/s/existing",
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        reason: "already_processed",
        existing: {
          bundleId: "bundle_existing",
          storagePrefix: "article-bundles/production/bundle_existing",
          status: "processed",
        },
      },
    ]);
    expect(progress.map((event) => event.type)).toEqual([
      "article_started",
      "article_skipped",
    ]);
  });

  it("classifies edge function invocation failures as analyze errors", async () => {
    const progress = [];
    const result = await runWechat2RssCaptureOnce({
      now: new Date("2026-06-08T12:00:00.000Z"),
      dryRun: false,
      onProgress: (event) => progress.push(event),
      wechat2rss: fakeWechat2Rss({
        accounts: [{ status: "healthy", name: "account" }],
        articles: [sampleArticle("edge-failure")],
      }),
      idempotency: fakeIdempotency(),
      supabase: {
        async uploadAndAnalyzeBundle() {
          throw new Error("Failed to send a request to the Edge Function");
        },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      bundledCount: 1,
      uploadedCount: 0,
      triggeredCount: 0,
      failureCount: 1,
      failures: [
        {
          sourceUrl: "https://mp.weixin.qq.com/s/edge-failure",
          reason: "analyze_error",
          message: "Failed to send a request to the Edge Function",
        },
      ],
    });
    expect(progress.map((event) => event.type)).toEqual([
      "article_started",
      "article_bundled",
      "article_failed",
    ]);
    expect(progress.at(-1)).toMatchObject({
      reason: "analyze_error",
      sourceUrl: "https://mp.weixin.qq.com/s/edge-failure",
    });
  });

  it("maps unhealthy Wechat2RSS accounts to typed capture failure reasons", async () => {
    const result = await runWechat2RssCaptureOnce({
      now: new Date("2026-06-08T12:00:00.000Z"),
      dryRun: true,
      wechat2rss: fakeWechat2Rss({
        accounts: [{ status: "account_risk", name: "risky" }],
        articles: [sampleArticle("blocked")],
      }),
      idempotency: fakeIdempotency(),
      supabase: throwingSupabase(),
    });

    expect(result).toMatchObject({
      ok: false,
      failureCount: 1,
      failure: {
        stage: "source_discovery",
        reason: "fetch_blocked",
        retryable: true,
      },
    });
  });
});

function sampleArticle(id) {
  return {
    sourceId: `source-${id}`,
    sourceName: `Source ${id}`,
    title: `Article ${id}`,
    summary: "Registration summary",
    contentText: "Registration text",
    contentHtml: `<p>Registration text</p><a href="https://example.com/${id}">Sign up</a>`,
    url: `https://mp.weixin.qq.com/s/${id}`,
    publishedAt: "2026-06-08T10:00:00.000Z",
    rawId: `raw-${id}`,
  };
}

function fakeWechat2Rss({ accounts, articles, queries = [] }) {
  return {
    async listLogins() {
      return { accounts };
    },
    async queryArticles(query) {
      queries.push(query);
      return { articles };
    },
  };
}

function fakeIdempotency({ existing = null } = {}) {
  return {
    async findExistingBundle() {
      return existing;
    },
  };
}

function throwingSupabase() {
  return {
    async uploadAndAnalyzeBundle() {
      throw new Error("supabase_should_not_be_called");
    },
  };
}
