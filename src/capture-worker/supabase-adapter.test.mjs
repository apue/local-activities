import { describe, expect, it } from "vitest";

import {
  createSupabaseCaptureAdapter,
  createSupabaseCaptureClientFromEnv,
} from "./supabase-adapter.mjs";

describe("capture worker Supabase adapter", () => {
  it("checks idempotency by source URL, content hash, and data class", async () => {
    const calls = [];
    const adapter = createSupabaseCaptureAdapter({
      client: fakeSupabaseClient({
        calls,
        selectResult: {
          data: {
            bundle_id: "bundle_existing",
            storage_prefix: "article-bundles/production/bundle_existing",
            status: "processed",
          },
          error: null,
        },
      }),
    });

    const result = await adapter.findExistingBundle({
      sourceUrl: "https://mp.weixin.qq.com/s/existing",
      contentHash: "hash-existing",
      dataClass: "production",
    });

    expect(result).toEqual({
      bundleId: "bundle_existing",
      storagePrefix: "article-bundles/production/bundle_existing",
      status: "processed",
    });
    expect(calls).toEqual([
      ["from", "article_bundles"],
      ["select", "bundle_id, storage_prefix, status"],
      ["eq", "source_url", "https://mp.weixin.qq.com/s/existing"],
      ["eq", "content_hash", "hash-existing"],
      ["eq", "data_class", "production"],
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
        dataClass: "production",
      },
      storagePrefix: "article-bundles/production/bundle_abc123",
    });

    expect(calls).toEqual([
      ["storage.from", "article-bundles"],
      [
        "upload",
        "production/bundle_abc123/manifest.json",
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
        "production/bundle_abc123/article.txt",
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
            storagePrefix: "article-bundles/production/bundle_abc123",
            contentHash: "hash-upload",
            sourceProvider: "wechat2rss",
            sourceId: "source-1",
            sourceName: "Source One",
            dataClass: "production",
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
      storagePrefix: "article-bundles/production/bundle_abc123",
      contentHash: "hash-upload",
      sourceProvider: "wechat2rss",
      sourceId: "source-1",
      sourceName: "Source One",
      dataClass: "production",
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
        dataClass: "production",
      },
      storagePrefix: "article-bundles/production/bundle_retry",
    });

    expect(calls).toContainEqual([
      "upload",
      "production/bundle_retry/manifest.json",
      "{\"retry\":true}",
      {
        contentType: "application/json",
        cacheControl: "3600",
        upsert: true,
      },
    ]);
    expect(calls.some((call) => call[0] === "functions.invoke")).toBe(true);
  });

  it("can invoke analysis through an explicit function URL after uploading bundle files", async () => {
    const calls = [];
    const fetchCalls = [];
    const adapter = createSupabaseCaptureAdapter({
      client: fakeSupabaseClient({ calls }),
      collectorEdgeToken: "collector-edge-secret",
      collectorId: "collector-local",
      analyzeFunctionUrl: "http://127.0.0.1:54321/functions/v1/analyze-article-bundle",
      fetchImpl: async (url, init) => {
        fetchCalls.push([url, init]);
        return {
          ok: true,
          status: 200,
          async text() {
            return "{\"ok\":true}";
          },
        };
      },
    });

    await adapter.uploadAndAnalyzeBundle({
      files: [
        {
          path: "manifest.json",
          body: "{\"local\":true}",
          contentType: "application/json",
        },
      ],
      manifest: {
        bundleId: "bundle_local",
        sourceProvider: "wechat2rss",
        sourceUrl: "https://mp.weixin.qq.com/s/local-function",
        canonicalUrl: "https://mp.weixin.qq.com/s/local-function",
        capturedAt: "2026-06-08T11:00:00.000Z",
        contentHash: "hash-local",
        dataClass: "production",
      },
      storagePrefix: "article-bundles/production/bundle_local",
    });

    expect(calls.some((call) => call[0] === "functions.invoke")).toBe(false);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0][0]).toBe(
      "http://127.0.0.1:54321/functions/v1/analyze-article-bundle",
    );
    expect(fetchCalls[0][1]).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-collector-edge-token": "collector-edge-secret",
        "x-collector-id": "collector-local",
      },
    });
    expect(JSON.parse(fetchCalls[0][1].body)).toMatchObject({
      sourceUrl: "https://mp.weixin.qq.com/s/local-function",
      bundleId: "bundle_local",
      storagePrefix: "article-bundles/production/bundle_local",
      contentHash: "hash-local",
      sourceProvider: "wechat2rss",
      dataClass: "production",
    });
  });

  it("aborts explicit function URL analysis calls after the configured timeout", async () => {
    const adapter = createSupabaseCaptureAdapter({
      client: fakeSupabaseClient({ calls: [] }),
      collectorEdgeToken: "collector-edge-secret",
      analyzeFunctionUrl: "http://127.0.0.1:54321/functions/v1/analyze-article-bundle",
      analyzeFunctionTimeoutMs: 5,
      fetchImpl: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    });

    await expect(
      adapter.uploadAndAnalyzeBundle({
        files: [],
        manifest: {
          bundleId: "bundle_timeout",
          sourceProvider: "wechat2rss",
          sourceUrl: "https://mp.weixin.qq.com/s/timeout",
          canonicalUrl: "https://mp.weixin.qq.com/s/timeout",
          capturedAt: "2026-06-08T11:00:00.000Z",
          contentHash: "hash-timeout",
          dataClass: "production",
        },
        storagePrefix: "article-bundles/production/bundle_timeout",
      }),
    ).rejects.toThrow("analyze_function_url_timeout");
  });

  it("times out explicit function URL analysis calls even when fetch ignores abort signals", async () => {
    const adapter = createSupabaseCaptureAdapter({
      client: fakeSupabaseClient({ calls: [] }),
      collectorEdgeToken: "collector-edge-secret",
      analyzeFunctionUrl: "http://127.0.0.1:54321/functions/v1/analyze-article-bundle",
      analyzeFunctionTimeoutMs: 5,
      fetchImpl: async () => new Promise(() => {}),
    });

    const result = await Promise.race([
      adapter.uploadAndAnalyzeBundle({
        files: [],
        manifest: {
          bundleId: "bundle_timeout_ignored_abort",
          sourceProvider: "wechat2rss",
          sourceUrl: "https://mp.weixin.qq.com/s/timeout-ignored-abort",
          canonicalUrl: "https://mp.weixin.qq.com/s/timeout-ignored-abort",
          capturedAt: "2026-06-08T11:00:00.000Z",
          contentHash: "hash-timeout-ignored-abort",
          dataClass: "production",
        },
        storagePrefix: "article-bundles/production/bundle_timeout_ignored_abort",
      }).catch((error) => error instanceof Error ? error.message : String(error)),
      delay(30).then(() => "still_pending"),
    ]);

    expect(result).toBe("analyze_function_url_timeout:5");
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
          dataClass: "production",
        },
        storagePrefix: "article-bundles/production/bundle_missing_token",
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

  it("passes an injected fetch implementation to the Supabase client", () => {
    const created = [];
    const fetchImpl = async () => new Response("{}");
    createSupabaseCaptureClientFromEnv({
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SECRET_KEY: "sb_secret_value",
      },
      fetchImpl,
      createClientImpl: (url, key, options) => {
        created.push([url, key, options]);
        return { ok: true };
      },
    });

    expect(created[0][2].global.fetch).toBe(fetchImpl);
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
