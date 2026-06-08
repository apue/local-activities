import { describe, expect, it } from "vitest";

import { runWechat2RssCaptureOnce } from "./wechat2rss-worker.mjs";

describe("Wechat2RSS capture worker", () => {
  it("polls healthy Wechat2RSS articles, builds bundles, and dry-runs analysis payloads", async () => {
    const queries = [];
    const result = await runWechat2RssCaptureOnce({
      now: new Date("2026-06-08T12:00:00.000Z"),
      mode: "production",
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
      mode: "production",
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
      storagePrefix: expect.stringMatching(/^article-bundles\/bundle_[a-f0-9]{24}$/),
      edgePayload: {
        sourceUrl: "https://mp.weixin.qq.com/s/dry-run",
        sourceProvider: "wechat2rss",
        sourceId: "source-dry-run",
        sourceName: "Source dry-run",
        mode: "production",
      },
    });
    expect(queries).toEqual([{ after: "20260601", content: true }]);
  });

  it("uploads and invokes analysis for new articles", async () => {
    const uploaded = [];
    const result = await runWechat2RssCaptureOnce({
      now: new Date("2026-06-08T12:00:00.000Z"),
      dryRun: false,
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
            mode: input.manifest.mode,
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
  });

  it("skips articles that already have an article bundle row", async () => {
    const result = await runWechat2RssCaptureOnce({
      now: new Date("2026-06-08T12:00:00.000Z"),
      dryRun: false,
      wechat2rss: fakeWechat2Rss({
        accounts: [{ status: "healthy", name: "account" }],
        articles: [sampleArticle("existing")],
      }),
      idempotency: fakeIdempotency({
        existing: {
          bundleId: "bundle_existing",
          storagePrefix: "article-bundles/bundle_existing",
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
          storagePrefix: "article-bundles/bundle_existing",
          status: "processed",
        },
      },
    ]);
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
