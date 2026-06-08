/// <reference lib="deno.ns" />

import { assert, assertEquals, assertRejects } from "./test_assertions.ts";
import { readArticleBundle } from "./bundle.ts";
import {
  buildProviderInput,
  createMockProvider,
  parseProviderOutput,
} from "./provider.ts";

Deno.test("readArticleBundle reads manifest, article files, diagnostics, links, and image references", async () => {
  const storage = fakeStorage({
    "bundle-1/manifest.json": JSON.stringify({
      bundleId: "bundle-1",
      sourceUrl: "https://mp.weixin.qq.com/s/example",
      images: [
        {
          imageId: "poster-1",
          storagePath: "bundle-1/images/poster.jpg",
          sourceUrl: "https://mmbiz.qpic.cn/remote-poster",
          contentType: "image/jpeg",
          width: 1080,
          height: 1440,
          altText: "Concert poster",
        },
      ],
      links: [{ href: "https://example.org/register", text: "Register" }],
      diagnostics: [{ reason: "ok" }],
    }),
    "bundle-1/article.html": "<article><h1>Concert</h1></article>",
    "bundle-1/article.txt": "Concert in Beijing",
    "bundle-1/links.json": JSON.stringify([
      { href: "https://example.org/register", text: "Register" },
    ]),
    "bundle-1/diagnostics.json": JSON.stringify([{ reason: "ok" }]),
    "bundle-1/images.json": JSON.stringify([
      {
        imageId: "qr-1",
        storagePath: "bundle-1/images/qr.png",
        sourceUrl: "https://mmbiz.qpic.cn/remote-qr",
        contentType: "image/png",
      },
    ]),
  });

  const bundle = await readArticleBundle(storage, {
    storagePrefix: "article-bundles/bundle-1",
  });

  assertEquals(bundle.text, "Concert in Beijing");
  assertEquals(bundle.links.length, 1);
  assertEquals(bundle.diagnostics.length, 1);
  assertEquals(
    bundle.images.map((image: { imageId: string }) => image.imageId),
    [
      "poster-1",
      "qr-1",
    ],
  );
});

Deno.test("readArticleBundle accepts capture-worker links and diagnostics object files", async () => {
  const storage = fakeStorage({
    "bundle-1/manifest.json": JSON.stringify({
      bundleId: "bundle-1",
      sourceUrl: "https://mp.weixin.qq.com/s/example",
      images: [
        {
          imageId: "poster-1",
          path: "images/poster-1.reference.json",
          hasBytes: false,
          sourceUrl: "https://mmbiz.qpic.cn/remote-poster",
          contentType: "image/jpeg",
          width: 1080,
          height: 1440,
          altText: "Concert poster",
        },
      ],
    }),
    "bundle-1/article.html": "<article><h1>Concert</h1></article>",
    "bundle-1/article.txt": "Concert in Beijing",
    "bundle-1/links.json": JSON.stringify({
      links: [{ href: "https://example.org/register", text: "Register" }],
      miniPrograms: [{ appId: "wx123", label: "报名" }],
    }),
    "bundle-1/diagnostics.json": JSON.stringify({
      diagnostics: [{ reason: "ok" }],
      captureWarnings: [{ code: "image_reference_only", severity: "info" }],
    }),
  });

  const bundle = await readArticleBundle(storage, {
    storagePrefix: "article-bundles/bundle-1",
  });

  assertEquals(bundle.links.length, 2);
  assertEquals(bundle.diagnostics.length, 2);
  assertEquals(bundle.images[0].storagePath, "images/poster-1.reference.json");
  assertEquals(bundle.images[0].hasBytes, false);
});

Deno.test("readArticleBundle signs byte-backed bundle images for provider vision input", async () => {
  const storage = fakeStorage({
    "bundle-1/manifest.json": JSON.stringify({
      bundleId: "bundle-1",
      sourceUrl: "https://mp.weixin.qq.com/s/example",
      images: [
        {
          imageId: "poster-1",
          path: "images/poster.jpg",
          hasBytes: true,
          sourceUrl: "https://mmbiz.qpic.cn/remote-poster",
          contentType: "image/jpeg",
        },
      ],
    }),
    "bundle-1/article.html": "<article><h1>Concert</h1></article>",
    "bundle-1/article.txt": "Concert in Beijing",
    "bundle-1/links.json": JSON.stringify({ links: [], miniPrograms: [] }),
    "bundle-1/diagnostics.json": JSON.stringify({
      diagnostics: [],
      captureWarnings: [],
    }),
  }, {
    signedUrls: {
      "article-bundles/bundle-1/images/poster.jpg":
        "https://supabase.test/storage/v1/object/sign/article-bundles/bundle-1/images/poster.jpg?token=signed",
    },
  });

  const bundle = await readArticleBundle(storage, {
    storagePrefix: "article-bundles/bundle-1",
  });
  const input = buildProviderInput({
    request: {
      sourceUrl: "https://mp.weixin.qq.com/s/example",
      bundleId: "bundle-1",
      storagePrefix: "article-bundles/bundle-1",
      contentHash: "sha256:abc",
      sourceProvider: "wechat2rss",
      mode: "production",
    },
    bundle,
  });

  assertEquals(
    bundle.images[0].bundleStoragePath,
    "bundle-1/images/poster.jpg",
  );
  assertEquals(bundle.images[0].publicUrl?.includes("token=signed"), true);
  assertEquals(
    input.user.some((part) =>
      part.type === "image_url" && part.imageId === "poster-1"
    ),
    true,
  );
});

Deno.test("buildProviderInput includes product rules and storage-backed image metadata", () => {
  const input = buildProviderInput({
    request: {
      sourceUrl: "https://mp.weixin.qq.com/s/example",
      bundleId: "bundle-1",
      storagePrefix: "article-bundles/bundle-1",
      contentHash: "sha256:abc",
      sourceProvider: "wechat2rss",
      mode: "production",
    },
    bundle: {
      manifest: {},
      html: "<article></article>",
      text: "Public concert in Beijing. Scan QR to register.",
      links: [],
      diagnostics: [],
      images: [
        {
          imageId: "poster-1",
          storagePath: "bundle-1/images/poster.jpg",
          sourceUrl: "https://mmbiz.qpic.cn/remote-poster",
          contentType: "image/jpeg",
        },
      ],
    },
  });

  assert(input.system.includes("public event eligibility"));
  assert(input.system.includes("multi-event extraction"));
  assert(input.system.includes("poster/QR evidence"));
  assert(
    input.user.some((part: { type: string }) => part.type === "image_metadata"),
  );
  assert(JSON.stringify(input).includes("bundle-1/images/poster.jpg"));
});

Deno.test("mock provider returns strict JSON that validates", async () => {
  const provider = createMockProvider({
    output: {
      decision: "needs_review",
      reason: "Public activity detected",
      confidence: 0.86,
      events: [
        {
          title: "Example Concert",
          startsAt: "2026-06-10T11:00:00+08:00",
          publicEligibility: "public",
          evidence: [
            { imageId: "poster-1", role: "poster", confidence: 0.9 },
          ],
        },
      ],
      dedupe: { decision: "new_event", confidence: 0.7 },
      usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
    },
  });

  const output = await provider.analyze({
    system: "",
    user: [],
    responseFormat: "json",
  });

  const parsed = parseProviderOutput(output);
  assertEquals(parsed.events[0].title, "Example Concert");
  assertEquals(parsed.usage.totalTokens, 140);
});

Deno.test("parseProviderOutput rejects malformed model output instead of defaulting into drafts", async () => {
  await assertRejects(
    async () =>
      parseProviderOutput({
        json: JSON.stringify({
          decision: "maybe",
          reason: "Bad enum",
          confidence: 0.7,
          events: [],
          dedupe: { decision: "new_event", confidence: 0.5 },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        }),
      }),
    "invalid_decision",
  );

  await assertRejects(
    async () =>
      parseProviderOutput({
        json: JSON.stringify({
          decision: "needs_review",
          reason: "Missing title",
          confidence: 0.7,
          events: [{ startsAt: "2026-06-10T11:00:00+08:00" }],
          dedupe: { decision: "new_event", confidence: 0.5 },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        }),
      }),
    "missing_event_title",
  );

  await assertRejects(
    async () =>
      parseProviderOutput({
        json: JSON.stringify({
          decision: "needs_review",
          reason: "Malformed event item",
          confidence: 0.7,
          events: ["not-an-event-object"],
          dedupe: { decision: "new_event", confidence: 0.5 },
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        }),
      }),
    "invalid_event",
  );
});

function fakeStorage(
  files: Record<string, string>,
  { signedUrls = {} }: { signedUrls?: Record<string, string> } = {},
) {
  return {
    async downloadText(bucket: string, path: string): Promise<string | null> {
      assertEquals(bucket, "article-bundles");
      return files[path] ?? null;
    },
    async createSignedUrl(
      bucket: string,
      path: string,
      _expiresInSeconds: number,
    ): Promise<string | null> {
      return signedUrls[`${bucket}/${path}`] ?? null;
    },
  };
}
