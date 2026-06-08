import { describe, expect, it } from "vitest";

import {
  createSupabaseCaptureAdapter,
  createSupabaseCaptureClientFromEnv,
} from "./supabase-adapter.mjs";

describe("capture worker Supabase adapter", () => {
  it("checks idempotency by source URL, content hash, and mode", async () => {
    const calls = [];
    const adapter = createSupabaseCaptureAdapter({
      client: fakeSupabaseClient({
        calls,
        selectResult: {
          data: {
            bundle_id: "bundle_existing",
            storage_prefix: "article-bundles/bundle_existing",
            status: "processed",
          },
          error: null,
        },
      }),
    });

    const result = await adapter.findExistingBundle({
      sourceUrl: "https://mp.weixin.qq.com/s/existing",
      contentHash: "hash-existing",
      mode: "production",
    });

    expect(result).toEqual({
      bundleId: "bundle_existing",
      storagePrefix: "article-bundles/bundle_existing",
      status: "processed",
    });
    expect(calls).toEqual([
      ["from", "article_bundles"],
      ["select", "bundle_id, storage_prefix, status"],
      ["eq", "source_url", "https://mp.weixin.qq.com/s/existing"],
      ["eq", "content_hash", "hash-existing"],
      ["eq", "mode", "production"],
      ["maybeSingle"],
    ]);
  });

  it("uploads bundle files, records metadata, and invokes analysis", async () => {
    const calls = [];
    const adapter = createSupabaseCaptureAdapter({
      client: fakeSupabaseClient({ calls }),
      collectorEdgeToken: "collector-edge-secret",
      collectorId: "collector-local",
    });

    const payload = await adapter.uploadAndAnalyzeBundle({
      files: [
        {
          path: "manifest.json",
          body: "{\"ok\":true}",
          contentType: "application/json",
        },
        {
          path: "article.txt",
          body: "Article text",
          contentType: "text/plain; charset=utf-8",
        },
      ],
      manifest: {
        bundleId: "bundle_abc123",
        sourceProvider: "wechat2rss",
        sourceId: "source-1",
        sourceName: "Source One",
        sourceUrl: "https://mp.weixin.qq.com/s/upload",
        canonicalUrl: "https://mp.weixin.qq.com/s/upload",
        publishedAt: "2026-06-08T10:00:00.000Z",
        capturedAt: "2026-06-08T11:00:00.000Z",
        contentHash: "hash-upload",
        images: [{ id: "image-001" }],
        links: [{ url: "https://example.com/signup" }],
        diagnostics: [{ key: "runner", value: "test" }],
        mode: "production",
      },
      storagePrefix: "article-bundles/bundle_abc123",
    });

    expect(calls).toEqual([
      ["storage.from", "article-bundles"],
      [
        "upload",
        "bundle_abc123/manifest.json",
        "{\"ok\":true}",
        {
          contentType: "application/json",
          cacheControl: "3600",
          upsert: true,
        },
      ],
      ["storage.from", "article-bundles"],
      [
        "upload",
        "bundle_abc123/article.txt",
        "Article text",
        {
          contentType: "text/plain; charset=utf-8",
          cacheControl: "3600",
          upsert: true,
        },
      ],
      [
        "functions.invoke",
        "analyze-article-bundle",
        {
          body: {
            sourceUrl: "https://mp.weixin.qq.com/s/upload",
            publishedAt: "2026-06-08T10:00:00.000Z",
            bundleId: "bundle_abc123",
            storagePrefix: "article-bundles/bundle_abc123",
            contentHash: "hash-upload",
            sourceProvider: "wechat2rss",
            sourceId: "source-1",
            sourceName: "Source One",
            mode: "production",
          },
          headers: {
            "x-collector-edge-token": "collector-edge-secret",
            "x-collector-id": "collector-local",
          },
        },
      ],
    ]);
    expect(calls).not.toContainEqual(["from", "article_bundles"]);
    expect(calls.some((call) => call[0] === "insert")).toBe(false);
    expect(payload).toEqual({
      sourceUrl: "https://mp.weixin.qq.com/s/upload",
      publishedAt: "2026-06-08T10:00:00.000Z",
      bundleId: "bundle_abc123",
      storagePrefix: "article-bundles/bundle_abc123",
      contentHash: "hash-upload",
      sourceProvider: "wechat2rss",
      sourceId: "source-1",
      sourceName: "Source One",
      mode: "production",
    });
  });

  it("can retry analysis after a previous partial bundle upload", async () => {
    const calls = [];
    const adapter = createSupabaseCaptureAdapter({
      client: fakeSupabaseClient({ calls }),
      collectorEdgeToken: "collector-edge-secret",
    });

    await adapter.uploadAndAnalyzeBundle({
      files: [
        {
          path: "manifest.json",
          body: "{\"retry\":true}",
          contentType: "application/json",
        },
      ],
      manifest: {
        bundleId: "bundle_retry",
        sourceProvider: "wechat2rss",
        sourceUrl: "https://mp.weixin.qq.com/s/retry",
        canonicalUrl: "https://mp.weixin.qq.com/s/retry",
        capturedAt: "2026-06-08T11:00:00.000Z",
        contentHash: "hash-retry",
        mode: "production",
      },
      storagePrefix: "article-bundles/bundle_retry",
    });

    expect(calls).toContainEqual([
      "upload",
      "bundle_retry/manifest.json",
      "{\"retry\":true}",
      {
        contentType: "application/json",
        cacheControl: "3600",
        upsert: true,
      },
    ]);
    expect(calls.some((call) => call[0] === "functions.invoke")).toBe(true);
  });

  it("refuses to invoke analysis without a collector edge token", async () => {
    const adapter = createSupabaseCaptureAdapter({
      client: fakeSupabaseClient({ calls: [] }),
    });

    await expect(
      adapter.uploadAndAnalyzeBundle({
        files: [],
        manifest: {
          bundleId: "bundle_missing_token",
          sourceProvider: "wechat2rss",
          sourceUrl: "https://mp.weixin.qq.com/s/missing-token",
          canonicalUrl: "https://mp.weixin.qq.com/s/missing-token",
          capturedAt: "2026-06-08T11:00:00.000Z",
          contentHash: "hash-missing-token",
          mode: "production",
        },
        storagePrefix: "article-bundles/bundle_missing_token",
      }),
    ).rejects.toThrow("collector_edge_token_required");
  });

  it("creates a server-side Supabase client from reset-compatible environment names", () => {
    const created = [];
    const client = createSupabaseCaptureClientFromEnv({
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SECRET_KEY: "sb_secret_value",
      },
      createClientImpl: (url, key, options) => {
        created.push([url, key, options]);
        return { ok: true };
      },
    });

    expect(client).toEqual({ ok: true });
    expect(created).toEqual([
      [
        "https://project.supabase.co",
        "sb_secret_value",
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false,
          },
        },
      ],
    ]);
  });
});

function fakeSupabaseClient({ calls, selectResult = { data: null, error: null } }) {
  return {
    from(table) {
      calls.push(["from", table]);
      return {
        select(columns) {
          calls.push(["select", columns]);
          return {
            eq(column, value) {
              calls.push(["eq", column, value]);
              return this;
            },
            async maybeSingle() {
              calls.push(["maybeSingle"]);
              return selectResult;
            },
          };
        },
        async insert(row) {
          calls.push(["insert", row]);
          return { data: row, error: null };
        },
      };
    },
    storage: {
      from(bucket) {
        calls.push(["storage.from", bucket]);
        return {
          async upload(path, body, options) {
            calls.push(["upload", path, body, options]);
            return { data: { path }, error: null };
          },
        };
      },
    },
    functions: {
      async invoke(name, options) {
        calls.push(["functions.invoke", name, options]);
        return { data: { ok: true }, error: null };
      },
    },
  };
}
