/// <reference lib="deno.ns" />

import { assert, assertEquals, assertRejects } from "./test_assertions.ts";
import { readArticleBundle } from "./bundle.ts";
import {
  buildProviderInput,
  createMockProvider,
  createOpenAiCompatibleProvider,
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

Deno.test("readArticleBundle inlines byte-backed bundle images as data URLs when bytes are readable", async () => {
  const storage = fakeStorage({
    "bundle-1/manifest.json": JSON.stringify({
      images: [
        {
          imageId: "poster-1",
          path: "images/poster.jpg",
          hasBytes: true,
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
    bytes: {
      "article-bundles/bundle-1/images/poster.jpg": new Uint8Array([
        1,
        2,
        3,
      ]),
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

  assertEquals(bundle.images[0].publicUrl, "data:image/jpeg;base64,AQID");
  assert(
    input.user.some((part) =>
      part.type === "image_url" &&
      part.imageUrl === "data:image/jpeg;base64,AQID"
    ),
  );
  assertEquals(JSON.stringify(input).includes("AQID"), true);
});

Deno.test("readArticleBundle tolerates missing byte-backed image objects", async () => {
  const bundle = await readArticleBundle(
    fakeStorage({
      "bundle-1/manifest.json": JSON.stringify({
        images: [{
          imageId: "poster-1",
          path: "images/missing.jpg",
          hasBytes: true,
          contentType: "image/jpeg",
        }],
      }),
      "bundle-1/article.html": "",
      "bundle-1/article.txt": "Article text",
      "bundle-1/links.json": JSON.stringify({ links: [], miniPrograms: [] }),
      "bundle-1/diagnostics.json": JSON.stringify({
        diagnostics: [],
        captureWarnings: [],
      }),
    }, {
      missingBytePaths: new Set([
        "article-bundles/bundle-1/images/missing.jpg",
      ]),
    }),
    { storagePrefix: "article-bundles/bundle-1" },
  );

  assertEquals(bundle.images.length, 1);
  assertEquals(bundle.images[0].publicUrl, undefined);
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

Deno.test("parseProviderOutput accepts excluded articles without event arrays", () => {
  const parsed = parseProviderOutput({
    json: JSON.stringify({
      decision: "excluded",
      reason: "News-only article without a public Beijing activity.",
      confidence: 0.92,
      excludedArticle: {
        triageDecision: "non_public_news",
        exclusionReason: "News-only article.",
        exclusionSignals: ["no public attendance signal"],
      },
      dedupe: { decision: "insufficient_info", confidence: 0.9 },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    }),
  });

  assertEquals(parsed.events, []);
  assertEquals(parsed.excludedArticle?.triageDecision, "non_public_news");
});

Deno.test("parseProviderOutput supplies conservative dedupe defaults when provider omits dedupe", () => {
  const excluded = parseProviderOutput({
    json: JSON.stringify({
      decision: "excluded",
      reason: "News-only article without public attendance signals.",
      confidence: 0.88,
      excludedArticle: {
        triageDecision: "non_public_news",
        exclusionReason: "News-only article.",
      },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    }),
  });
  assertEquals(excluded.dedupe.decision, "insufficient_info");
  assertEquals(excluded.dedupe.confidence, 0.88);

  const publicEvent = parseProviderOutput({
    json: JSON.stringify({
      decision: "needs_review",
      reason: "Public event but missing some publication details.",
      confidence: 0.74,
      events: [
        {
          title: "Public Lecture",
          startsAt: "2026-06-20T10:00:00+08:00",
          city: "Beijing",
          publicEligibility: "public",
          confidence: 0.74,
        },
      ],
    }),
  });
  assertEquals(publicEvent.dedupe.decision, "new_event");
  assertEquals(publicEvent.dedupe.confidence, 0.74);
});

Deno.test("parseProviderOutput normalizes safe decision aliases", () => {
  const parsed = parseProviderOutput({
    json: JSON.stringify({
      decision: "not_event",
      reason: "Not a public event.",
      confidence: 0.9,
      excludedArticle: {
        triageDecision: "not_event",
        exclusionReason: "No public attendance signal.",
      },
      dedupe: { decision: "insufficient_info", confidence: 0.9 },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    }),
  });

  assertEquals(parsed.decision, "excluded");
  assertEquals(parsed.events, []);
});

Deno.test("parseProviderOutput treats eligible false provider output as excluded", () => {
  const parsed = parseProviderOutput({
    json: JSON.stringify({
      eligible: false,
      reason: "News-only article without a public event.",
    }),
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  });

  assertEquals(parsed.decision, "excluded");
  assertEquals(parsed.events, []);
  assertEquals(parsed.dedupe.decision, "insufficient_info");
  assertEquals(parsed.usage.totalTokens, 15);
});

Deno.test("parseProviderOutput normalizes common event field aliases", () => {
  const parsed = parseProviderOutput({
    json: JSON.stringify({
      decision: "published",
      reason: "Public seminar with registration.",
      confidence: 0.98,
      events: [
        {
          title: "Education seminar",
          startsAt: "2026-06-13T09:30:00+08:00",
          city: "Beijing",
          publicEligibility: "公开活动，面向学生及家长",
          triageDecision: "public_event",
          triageAction: "publish",
          eventKind: "seminar",
          scheduleKind: "single_session",
          confidence: 0.98,
          evidence: ["registration QR present"],
          publish: { createCanonicalEvent: true },
        },
      ],
      dedupe: { decision: "new_event", confidence: 0.95 },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    }),
  });

  assertEquals(parsed.events[0].publicEligibility, "public");
  assertEquals(parsed.events[0].triageDecision, "public_activity");
  assertEquals(parsed.events[0].triageAction, "extract");
  assertEquals(parsed.events[0].eventKind, "single");
  assertEquals(parsed.events[0].scheduleKind, "single");
  assertEquals(parsed.events[0].evidence, []);
});

Deno.test("parseProviderOutput treats China local +00 timestamps as Asia/Shanghai wall time", () => {
  const parsed = parseProviderOutput({
    json: JSON.stringify({
      decision: "published",
      reason: "Public Beijing seminar.",
      confidence: 0.96,
      events: [
        {
          title: "RELO Beijing English Teaching Seminar",
          startsAt: "2026-06-13T09:00:00+00:00",
          endsAt: "2026-06-13T17:00:00Z",
          timezone: "Asia/Shanghai",
          city: "Beijing",
          publicEligibility: "unclear",
          triageDecision: "public_activity",
          triageAction: "extract",
          eventKind: "single",
          scheduleKind: "unsupported",
          confidence: 0.95,
        },
      ],
      dedupe: { decision: "new_event", confidence: 0.95 },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    }),
  });

  assertEquals(parsed.events[0].startsAt, "2026-06-13T09:00:00+08:00");
  assertEquals(parsed.events[0].endsAt, "2026-06-13T17:00:00+08:00");
  assertEquals(parsed.events[0].scheduleKind, "single");
});

Deno.test("parseProviderOutput downgrades nonstandard event enums instead of failing the article", () => {
  const parsed = parseProviderOutput({
    json: JSON.stringify({
      decision: "published",
      reason: "Possible public event with model-provided free text enums.",
      confidence: 0.82,
      events: [
        {
          title: "Possible lecture",
          startsAt: "2026-06-13T09:30:00+08:00",
          city: "Beijing",
          publicEligibility: "Audience eligibility is not clearly stated",
          triageDecision: "community_program",
          triageAction: "send_to_editor",
          reservationStatus: "booking information not confirmed",
          eventKind: "culture program",
          scheduleKind: "single_event",
          confidence: 0.82,
          evidence: [
            { imageId: "image-1", role: "registration_qr", confidence: 0.9 },
            { imageId: "image-2", role: "flyer", confidence: 0.6 },
          ],
          publish: { createCanonicalEvent: true },
        },
      ],
      dedupe: { decision: "new_event", confidence: 0.8 },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    }),
  });

  assertEquals(parsed.events[0].publicEligibility, "unclear");
  assertEquals(parsed.events[0].triageDecision, "possible_public_activity");
  assertEquals(parsed.events[0].triageAction, "review");
  assertEquals(parsed.events[0].reservationStatus, "unknown");
  assertEquals(parsed.events[0].eventKind, "unsupported");
  assertEquals(parsed.events[0].scheduleKind, "single");
  assertEquals(
    parsed.events[0].evidence?.map((selection) => selection.role),
    ["qr", "poster"],
  );
});

Deno.test("openai-compatible provider surfaces vision HTTP failures instead of retrying text-only", async () => {
  const bodies: unknown[] = [];
  const provider = createOpenAiCompatibleProvider({
    baseUrl: "https://llm.test/v1",
    apiKey: "key",
    model: "vision-model",
    fetchImpl: async (_url, init) => {
      const requestInit = init as { body?: unknown } | undefined;
      bodies.push(JSON.parse(String(requestInit?.body)));
      if (bodies.length === 1) {
        return new Response("vision forbidden", { status: 403 });
      }
      return new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                decision: "excluded",
                reason: "Text-only fallback.",
                confidence: 0.9,
                events: [],
                dedupe: { decision: "insufficient_info", confidence: 0.9 },
              }),
            },
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  await assertRejects(
    () =>
      provider.analyze({
        system: "system",
        responseFormat: "json",
        user: [
          { type: "text", text: "article text" },
          {
            type: "image_url",
            imageId: "image-1",
            imageUrl: "data:image/jpeg;base64,AQID",
          },
        ],
      }),
    "provider_http_403",
  );

  assertEquals(bodies.length, 1);
  assertEquals(JSON.stringify(bodies[0]).includes("image_url"), true);
});

Deno.test("openai-compatible provider surfaces vision provider 5xx instead of retrying text-only", async () => {
  const bodies: unknown[] = [];
  const provider = createOpenAiCompatibleProvider({
    baseUrl: "https://llm.test/v1",
    apiKey: "key",
    model: "vision-model",
    fetchImpl: async (_url, init) => {
      const requestInit = init as { body?: unknown } | undefined;
      bodies.push(JSON.parse(String(requestInit?.body)));
      if (bodies.length === 1) {
        return new Response(
          JSON.stringify({ code: 50507, message: "Unknown error." }),
          { status: 500 },
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                decision: "excluded",
                reason: "Text-only fallback after provider 5xx.",
                confidence: 0.9,
                events: [],
                dedupe: { decision: "insufficient_info", confidence: 0.9 },
              }),
            },
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  await assertRejects(
    () =>
      provider.analyze({
        system: "system",
        responseFormat: "json",
        user: [
          { type: "text", text: "article text" },
          {
            type: "image_url",
            imageId: "image-1",
            imageUrl: "data:image/jpeg;base64,AQID",
          },
        ],
      }),
    "provider_http_500",
  );

  assertEquals(bodies.length, 1);
  assertEquals(JSON.stringify(bodies[0]).includes("image_url"), true);
});

Deno.test("openai-compatible provider times out even when fetch ignores abort signals", async () => {
  const provider = createOpenAiCompatibleProvider({
    baseUrl: "https://llm.test/v1",
    apiKey: "key",
    model: "vision-model",
    timeoutMs: 5,
    fetchImpl: async () => new Promise(() => {}),
  });

  const sentinel = timeoutSentinel(30, "still_pending");
  const result = await Promise.race([
    provider.analyze({
      system: "system",
      responseFormat: "json",
      user: [{ type: "text", text: "article text" }],
    }).catch((error) => error instanceof Error ? error.message : String(error)),
    sentinel.promise,
  ]);
  sentinel.cancel();

  assertEquals(result, "provider_timeout:5");
});

Deno.test("openai-compatible provider surfaces vision timeouts instead of retrying text-only", async () => {
  const bodies: unknown[] = [];
  const provider = createOpenAiCompatibleProvider({
    baseUrl: "https://llm.test/v1",
    apiKey: "key",
    model: "vision-model",
    timeoutMs: 5,
    fetchImpl: async (_url, init) => {
      const requestInit = init as { body?: unknown } | undefined;
      bodies.push(JSON.parse(String(requestInit?.body)));
      if (bodies.length === 1) return new Promise(() => {});
      return new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                decision: "excluded",
                reason: "Text-only fallback after timeout.",
                confidence: 0.9,
                events: [],
                dedupe: { decision: "insufficient_info", confidence: 0.9 },
              }),
            },
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  await assertRejects(
    () =>
      provider.analyze({
        system: "system",
        responseFormat: "json",
        user: [
          { type: "text", text: "article text" },
          {
            type: "image_url",
            imageId: "image-1",
            imageUrl: "data:image/jpeg;base64,AQID",
          },
        ],
      }),
    "provider_timeout:5",
  );

  assertEquals(bodies.length, 1);
  assertEquals(JSON.stringify(bodies[0]).includes("image_url"), true);
});

function fakeStorage(
  files: Record<string, string>,
  {
    signedUrls = {},
    bytes = {},
    missingBytePaths = new Set<string>(),
  }: {
    signedUrls?: Record<string, string>;
    bytes?: Record<string, Uint8Array>;
    missingBytePaths?: Set<string>;
  } = {},
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
    async downloadBytes(
      bucket: string,
      path: string,
    ): Promise<Uint8Array | null> {
      if (missingBytePaths.has(`${bucket}/${path}`)) {
        throw new Error("Object not found");
      }
      return bytes[`${bucket}/${path}`] ?? null;
    },
  };
}

function timeoutSentinel<T>(ms: number, value: T) {
  let timer: number | undefined;
  return {
    promise: new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(value), ms);
    }),
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
