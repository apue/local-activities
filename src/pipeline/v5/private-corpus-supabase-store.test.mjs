import { describe, expect, it } from "vitest";

import { createSupabasePrivateCorpusStore } from "./private-corpus-supabase-store.mjs";

describe("private corpus Supabase store", () => {
  it("reads feedback, pipeline runs, and stored article bundles without writing data", async () => {
    const calls = [];
    const store = createSupabasePrivateCorpusStore({
      client: fakeSupabaseClient(calls),
    });

    await expect(store.getFeedbackById("feedback-1")).resolves.toMatchObject({
      id: "feedback-1",
      feedbackType: "missing_qr",
      articleBundleId: "bundle-1",
    });
    await expect(store.getPipelineRunById("pipe-1")).resolves.toMatchObject({
      runId: "pipe-1",
      articleBundleId: "bundle-1",
    });
    await expect(store.getArticleBundleById("bundle-1")).resolves.toMatchObject({
      bundleId: "bundle-1",
      capturedBundle: {
        version: "captured-article-bundle-v1",
        provider: "wechat2rss",
        sourceUrl: "https://mp.weixin.qq.com/s/test-event",
        text: "Private article text",
        html: "<article>Private article HTML</article>",
        images: [
          expect.objectContaining({
            id: "poster-1",
            body: expect.any(Buffer),
            storagePath: "production/bundle-1/images/poster-1.png",
          }),
        ],
        links: [
          {
            url: "https://example.com/register",
            text: "Register",
            role: "registration",
          },
        ],
        miniPrograms: [
          {
            appId: "wx-test",
            path: "pages/register",
            text: "Register mini",
            actionType: "registration",
          },
        ],
      },
    });

    expect(calls).toEqual(
      expect.arrayContaining([
        ["from", "admin_feedback_ledger"],
        ["from", "pipeline_runs"],
        ["from", "article_bundles"],
        ["download", "article-bundles", "production/bundle-1/manifest.json"],
        ["download", "article-bundles", "production/bundle-1/images/poster-1.png"],
      ]),
    );
    expect(calls.some((call) => call[0] === "insert" || call[0] === "update")).toBe(false);
  });

  it("fails fast when a byte-backed image asset cannot be downloaded", async () => {
    const store = createSupabasePrivateCorpusStore({
      client: fakeSupabaseClient([], {
        missingFiles: ["production/bundle-1/images/poster-1.png"],
      }),
    });

    await expect(store.getArticleBundleById("bundle-1")).rejects.toThrow(
      "private_corpus_bundle_image_missing:production/bundle-1/images/poster-1.png",
    );
  });
});

function fakeSupabaseClient(calls, { missingFiles = [] } = {}) {
  const rows = {
    admin_feedback_ledger: {
      feedback_id: "feedback-1",
      data_class: "production",
      feedback_type: "missing_qr",
      article_bundle_id: "bundle-1",
      draft_id: "draft-1",
      field_name: "registrationQrAssetId",
      reason: "QR missing.",
      created_by: "admin",
      status: "open",
      metadata: {},
      created_at: "2026-06-11T10:00:00.000Z",
      updated_at: "2026-06-11T10:00:00.000Z",
    },
    pipeline_runs: {
      run_id: "pipe-1",
      data_class: "production",
      article_bundle_id: "bundle-1",
      status: "completed",
      decision: "needs_review",
      reason: "Missing QR.",
      started_at: "2026-06-11T09:00:00.000Z",
      metadata: {},
    },
    article_bundles: {
      bundle_id: "bundle-1",
      data_class: "production",
      source_provider: "wechat2rss",
      source_id: "source-1",
      source_name: "Test Culture Center",
      source_url: "https://mp.weixin.qq.com/s/test-event",
      canonical_url: "https://mp.weixin.qq.com/s/test-event",
      published_at: "2026-06-10T09:00:00.000Z",
      captured_at: "2026-06-11T09:00:00.000Z",
      content_hash: "hash-1",
      storage_bucket: "article-bundles",
      storage_prefix: "article-bundles/production/bundle-1",
    },
  };
  const storageFiles = {
    "production/bundle-1/manifest.json": JSON.stringify({
      captureId: "capture-1",
      sourceProvider: "wechat2rss",
      sourceId: "source-1",
      sourceName: "Test Culture Center",
      sourceUrl: "https://mp.weixin.qq.com/s/test-event",
      canonicalUrl: "https://mp.weixin.qq.com/s/test-event",
      finalUrl: "https://mp.weixin.qq.com/s/test-event",
      title: "Culture Talk",
      authorName: "Test Culture Center",
      publishedAt: "2026-06-10T09:00:00.000Z",
      capturedAt: "2026-06-11T09:00:00.000Z",
      contentHash: "hash-1",
      images: [
        {
          id: "poster-1",
          path: "images/poster-1.png",
          hasBytes: true,
          role: "poster",
          contentType: "image/png",
        },
      ],
    }),
    "production/bundle-1/article.html": "<article>Private article HTML</article>",
    "production/bundle-1/article.txt": "Private article text",
    "production/bundle-1/links.json": JSON.stringify({
      links: [
        {
          url: "https://example.com/register",
          text: "Register",
          role: "registration",
        },
      ],
      miniPrograms: [
        {
          appId: "wx-test",
          path: "pages/register",
          text: "Register mini",
          actionType: "registration",
        },
      ],
    }),
    "production/bundle-1/diagnostics.json": JSON.stringify({
      diagnostics: [],
      captureWarnings: [],
    }),
    "production/bundle-1/images/poster-1.png": Buffer.from([1, 2, 3, 4]),
  };

  return {
    from(table) {
      calls.push(["from", table]);
      const query = {
        select() {
          calls.push(["select", table]);
          return query;
        },
        eq(column, value) {
          calls.push(["eq", table, column, value]);
          return query;
        },
        maybeSingle() {
          calls.push(["maybeSingle", table]);
          return Promise.resolve({ data: rows[table] ?? null, error: null });
        },
      };
      return query;
    },
    storage: {
      from(bucket) {
        return {
          async download(objectPath) {
            calls.push(["download", bucket, objectPath]);
            if (missingFiles.includes(objectPath)) {
              return { data: null, error: { statusCode: 404 } };
            }
            const value = storageFiles[objectPath];
            if (value === undefined) {
              return { data: null, error: { statusCode: 404 } };
            }
            return {
              error: null,
              data: blobLike(value),
            };
          },
        };
      },
    },
  };
}

function blobLike(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return {
    async text() {
      return buffer.toString("utf8");
    },
    async arrayBuffer() {
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      );
    },
  };
}
