/// <reference lib="deno.ns" />

import { assertEquals, assertRejects } from "./test_assertions.ts";
import { authenticateCollector, parseAnalyzeRequest } from "./request.ts";

Deno.test("authenticateCollector accepts x-collector-edge-token", () => {
  const request = new Request("https://example.test", {
    headers: { "x-collector-edge-token": "secret-token" },
  });

  assertEquals(
    authenticateCollector(request, { collectorEdgeToken: "secret-token" }),
    true,
  );
});

Deno.test("authenticateCollector accepts bearer token", () => {
  const request = new Request("https://example.test", {
    headers: { authorization: "Bearer secret-token" },
  });

  assertEquals(
    authenticateCollector(request, { collectorEdgeToken: "secret-token" }),
    true,
  );
});

Deno.test("authenticateCollector rejects missing or mismatched tokens", () => {
  assertEquals(
    authenticateCollector(new Request("https://example.test"), {
      collectorEdgeToken: "secret-token",
    }),
    false,
  );
  assertEquals(
    authenticateCollector(
      new Request("https://example.test", {
        headers: { "x-collector-edge-token": "wrong" },
      }),
      { collectorEdgeToken: "secret-token" },
    ),
    false,
  );
});

Deno.test("parseAnalyzeRequest defaults data class to production and keeps optional fields", async () => {
  const request = new Request("https://example.test", {
    method: "POST",
    body: JSON.stringify({
      sourceUrl: "https://mp.weixin.qq.com/s/example",
      publishedAt: "2026-06-08T10:00:00+08:00",
      bundleId: "bundle-1",
      storagePrefix: "article-bundles/production/bundle-1",
      contentHash: "sha256:abc",
      sourceProvider: "wechat2rss",
      sourceId: "embassy-feed",
      sourceName: "Example Embassy",
    }),
  });

  const parsed = await parseAnalyzeRequest(request);

  assertEquals(parsed.dataClass, "production");
  assertEquals(parsed.sourceName, "Example Embassy");
  assertEquals(parsed.storagePrefix, "article-bundles/production/bundle-1");
});

Deno.test("parseAnalyzeRequest rejects invalid data class and missing required fields", async () => {
  await assertRejects(
    () =>
      parseAnalyzeRequest(
        new Request("https://example.test", {
          method: "POST",
          body: JSON.stringify({
            sourceUrl: "https://mp.weixin.qq.com/s/example",
            bundleId: "bundle-1",
            storagePrefix: "article-bundles/production/bundle-1",
            contentHash: "sha256:abc",
            sourceProvider: "wechat2rss",
            dataClass: "preview",
          }),
        }),
      ),
    "invalid_data_class",
  );

  await assertRejects(
    () =>
      parseAnalyzeRequest(
        new Request("https://example.test", {
          method: "POST",
          body: JSON.stringify({ bundleId: "bundle-1" }),
        }),
      ),
    "missing_sourceUrl",
  );
});

Deno.test("parseAnalyzeRequest rejects non-string request fields", async () => {
  await assertRejects(
    () =>
      parseAnalyzeRequest(
        new Request("https://example.test", {
          method: "POST",
          body: JSON.stringify({
            sourceUrl: { href: "https://mp.weixin.qq.com/s/example" },
            bundleId: "bundle-1",
            storagePrefix: "article-bundles/production/bundle-1",
            contentHash: "sha256:abc",
            sourceProvider: "wechat2rss",
          }),
        }),
      ),
    "invalid_sourceUrl",
  );

  await assertRejects(
    () =>
      parseAnalyzeRequest(
        new Request("https://example.test", {
          method: "POST",
          body: JSON.stringify({
            sourceUrl: "https://mp.weixin.qq.com/s/example",
            publishedAt: 123,
            bundleId: "bundle-1",
            storagePrefix: "article-bundles/production/bundle-1",
            contentHash: "sha256:abc",
            sourceProvider: "wechat2rss",
          }),
        }),
      ),
    "invalid_publishedAt",
  );
});
