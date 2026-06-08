/// <reference lib="deno.ns" />

import { assert, assertEquals } from "./test_assertions.ts";
import { runAnalysisPipeline } from "./pipeline.ts";

Deno.test("runAnalysisPipeline writes production bundle, usage, evidence, draft, canonical event, dedupe, and ledger", async () => {
  const db = createRecordingDb();
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: successfulProvider(),
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "published");
  assert(db.table("article_bundles").length === 1);
  assert(db.table("llm_usage_ledger").length === 1);
  assert(db.table("evidence_assets").length === 1);
  assert(db.table("event_drafts").length === 1);
  assert(db.table("canonical_events").length === 1);
  assert(db.table("dedupe_decisions").length === 1);
  assert(db.table("processing_ledger").length === 1);
});

Deno.test("runAnalysisPipeline writes article bundle status through protected status writer", async () => {
  const db = createRecordingDb();
  await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: successfulProvider(),
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(
    db.articleBundleWrites.map((call) => call.status),
    ["analysis_started", "processed"],
  );
  assertEquals(db.table("article_bundles")[0].status, "processed");
});

Deno.test("runAnalysisPipeline does not create a canonical event when dedupe candidates exist", async () => {
  const db = createRecordingDb({
    canonicalCandidates: [
      {
        event_id: "existing-event",
        title: "Example Public Lecture",
        starts_at: "2026-06-10T11:00:00+08:00",
        source_url: "https://mp.weixin.qq.com/s/example",
      },
    ],
  });
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: successfulProvider(),
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "needs_review");
  assertEquals(db.table("canonical_events").length, 0);
  assertEquals(db.table("event_drafts")[0].review_state, "possible_duplicate");
  assertEquals(db.table("dedupe_decisions")[0].decision, "same_event");
});

Deno.test("runAnalysisPipeline in eval mode does not write production draft or canonical tables", async () => {
  const db = createRecordingDb();
  await runAnalysisPipeline({
    request: { ...validRequest(), mode: "eval" },
    storage: bundleStorage(),
    db,
    provider: successfulProvider(),
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(db.table("event_drafts").length, 0);
  assertEquals(db.table("canonical_events").length, 0);
  assertEquals(db.table("dedupe_decisions").length, 0);
  assertEquals(db.table("llm_usage_ledger").length, 1);
  assertEquals(db.table("processing_ledger").length, 1);
  assertEquals(db.table("processing_ledger")[0].state, "needs_review");
});

Deno.test("runAnalysisPipeline writes failed ledger and failed usage when provider fails", async () => {
  const db = createRecordingDb();
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: {
      name: "mock",
      model: "mock-vision",
      async analyze() {
        throw new Error("provider_timeout");
      },
    },
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "failed");
  assertEquals(db.table("llm_usage_ledger")[0].status, "failed");
  assertEquals(db.table("processing_ledger")[0].state, "failed");
  const ledger = db.table("processing_ledger")[0] as {
    error_details: { message: string };
  };
  assertEquals(ledger.error_details.message, "provider_timeout");
});

Deno.test("runAnalysisPipeline keeps failed ledger writable when production write fails after usage", async () => {
  const db = createRecordingDb({
    failInserts: { event_drafts: "draft_write_failed" },
    enforceUniqueIds: true,
  });
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: successfulProvider(),
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "failed");
  assertEquals(db.table("llm_usage_ledger").length, 1);
  assertEquals(db.table("llm_usage_ledger")[0].status, "failed");
  assertEquals(db.table("llm_usage_ledger")[0].total_tokens, 200);
  assertEquals(db.table("processing_ledger").length, 1);
  assertEquals(db.table("processing_ledger")[0].state, "failed");
  assertEquals(db.table("processing_ledger")[0].reason, "draft_write_failed");
});

Deno.test("runAnalysisPipeline skips already processed bundles instead of downgrading terminal state", async () => {
  const db = createRecordingDb({ enforceUniqueIds: true });
  await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: successfulProvider(),
    env: { provider: "mock", model: "mock-vision" },
  });

  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: {
      name: "mock",
      model: "mock-vision",
      async analyze() {
        throw new Error("should_not_analyze_processed_bundle");
      },
    },
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "processed");
  assertEquals(db.table("article_bundles")[0].status, "processed");
  assertEquals(db.table("llm_usage_ledger")[0].status, "succeeded");
  assertEquals(db.table("processing_ledger")[0].state, "published");
  assertEquals(db.table("canonical_events").length, 1);
});

Deno.test("runAnalysisPipeline skips fresh in-progress bundles", async () => {
  const db = createRecordingDb({
    initialArticleBundles: [{
      bundle_id: "bundle-1",
      mode: "production",
      status: "analysis_started",
      updated_at: new Date().toISOString(),
    }],
  });
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: {
      name: "mock",
      model: "mock-vision",
      async analyze() {
        throw new Error("should_not_analyze_fresh_in_progress_bundle");
      },
    },
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "in_progress");
  assertEquals(db.table("llm_usage_ledger").length, 0);
  assertEquals(db.table("processing_ledger").length, 0);
});

Deno.test("runAnalysisPipeline reclaims stale in-progress bundles", async () => {
  const staleUpdatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000)
    .toISOString();
  const db = createRecordingDb({
    initialArticleBundles: [{
      bundle_id: "bundle-1",
      mode: "production",
      status: "analysis_started",
      updated_at: staleUpdatedAt,
    }],
  });
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: successfulProvider(),
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "published");
  assertEquals(db.table("article_bundles")[0].status, "processed");
  assertEquals(db.table("llm_usage_ledger").length, 1);
  assertEquals(db.table("processing_ledger").length, 1);
});

Deno.test("runAnalysisPipeline does not downgrade processed bundles when stale guards miss an overlapping failure", async () => {
  const db = createRecordingDb({
    enforceUniqueIds: true,
    staleArticleBundleLookup: true,
  });
  await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: successfulProvider(),
    env: { provider: "mock", model: "mock-vision" },
  });

  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: {
      name: "mock",
      model: "mock-vision",
      async analyze() {
        throw new Error("overlapping_retry_failed");
      },
    },
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "processed");
  assertEquals(db.table("article_bundles")[0].status, "processed");
  assertEquals(db.table("llm_usage_ledger").length, 1);
  assertEquals(db.table("processing_ledger").length, 1);
  assertEquals(
    db.table("processing_ledger").map((row) => row.state),
    ["published"],
  );
  assertEquals(db.table("canonical_events").length, 1);
});

Deno.test("runAnalysisPipeline records provider usage when schema validation fails", async () => {
  const db = createRecordingDb();
  const result = await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: {
      name: "mock",
      model: "mock-vision",
      async analyze() {
        return {
          json: JSON.stringify({
            decision: "maybe",
            reason: "Invalid schema",
            confidence: 0.5,
            events: [],
            dedupe: { decision: "new_event", confidence: 0.5 },
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          }),
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        };
      },
    },
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(result.status, "failed");
  assertEquals(db.table("llm_usage_ledger")[0].status, "failed");
  assertEquals(db.table("llm_usage_ledger")[0].input_tokens, 10);
  assertEquals(db.table("llm_usage_ledger")[0].output_tokens, 5);
  assertEquals(db.table("llm_usage_ledger")[0].total_tokens, 15);
  assertEquals(db.table("processing_ledger")[0].state, "failed");
});

Deno.test("runAnalysisPipeline creates storage-backed evidence rows instead of stable remote WeChat URLs", async () => {
  const storage = bundleStorage({ imageKind: "stable" });
  const db = createRecordingDb();
  await runAnalysisPipeline({
    request: validRequest(),
    storage,
    db,
    provider: successfulProvider(),
    env: { provider: "mock", model: "mock-vision" },
  });

  const evidence = db.table("evidence_assets")[0];
  assertEquals(evidence.storage_bucket, "event-evidence-assets");
  assertEquals(
    evidence.storage_path,
    "articles/bundle-1/evidence-1-poster-poster-1-bundle-1.jpg",
  );
  assertEquals(
    evidence.public_url,
    "https://supabase.test/storage/v1/object/public/event-evidence-assets/articles/bundle-1/evidence-1-poster-poster-1-bundle-1.jpg",
  );
  assertEquals(String(evidence.public_url).includes("mmbiz.qpic.cn"), false);
  assertEquals(evidence.source_url, "https://mmbiz.qpic.cn/remote-poster");
  assertEquals(storage.uploaded.length, 1);
  assertEquals(storage.uploaded[0].bucket, "event-evidence-assets");
  assertEquals(
    storage.uploaded[0].path,
    "articles/bundle-1/evidence-1-poster-poster-1-bundle-1.jpg",
  );
});

Deno.test("runAnalysisPipeline keeps per-event canonical ids isolated in multi-event dedupe rows", async () => {
  const db = createRecordingDb();
  await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: multiEventProvider(),
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(db.table("canonical_events").length, 1);
  assertEquals(db.table("dedupe_decisions").length, 2);
  assertEquals(
    db.table("dedupe_decisions")[0].canonical_event_id,
    "event-1-bundle-1",
  );
  assertEquals(db.table("dedupe_decisions")[1].canonical_event_id, undefined);
});

Deno.test("runAnalysisPipeline records reference-only evidence without fabricating poster URLs", async () => {
  const db = createRecordingDb();
  await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage({ imageKind: "reference" }),
    db,
    provider: successfulProvider(),
    env: { provider: "mock", model: "mock-vision" },
  });

  const evidence = db.table("evidence_assets")[0];
  assertEquals(evidence.storage_bucket, "event-evidence-assets");
  assertEquals(evidence.storage_path, undefined);
  assertEquals(evidence.public_url, undefined);
  assertEquals(evidence.source_url, "https://mmbiz.qpic.cn/remote-poster");

  const draft = db.table("event_drafts")[0];
  assertEquals(draft.poster_asset_id, "evidence-1-poster-poster-1-bundle-1");
  assertEquals(draft.poster_image_url, undefined);

  const canonical = db.table("canonical_events")[0];
  assertEquals(
    canonical.poster_asset_id,
    "evidence-1-poster-poster-1-bundle-1",
  );
  assertEquals(canonical.poster_image_url, undefined);
});

Deno.test("runAnalysisPipeline writes excluded article and ledger for excluded output", async () => {
  const db = createRecordingDb();
  await runAnalysisPipeline({
    request: validRequest(),
    storage: bundleStorage(),
    db,
    provider: {
      name: "mock",
      model: "mock-vision",
      async analyze() {
        return {
          json: JSON.stringify({
            decision: "excluded",
            reason: "Official visit news without public activity",
            confidence: 0.92,
            excludedArticle: {
              triageDecision: "official_visit",
              exclusionReason: "No public registration or attendance signal",
              publicSignals: [],
              exclusionSignals: ["official visit"],
            },
            events: [],
            dedupe: { decision: "insufficient_info", confidence: 0.4 },
            usage: { inputTokens: 90, outputTokens: 20, totalTokens: 110 },
          }),
          usage: { inputTokens: 90, outputTokens: 20, totalTokens: 110 },
        };
      },
    },
    env: { provider: "mock", model: "mock-vision" },
  });

  assertEquals(db.table("excluded_articles").length, 1);
  assertEquals(db.table("processing_ledger")[0].state, "excluded");
});

function validRequest() {
  return {
    sourceUrl: "https://mp.weixin.qq.com/s/example",
    publishedAt: "2026-06-08T10:00:00+08:00",
    bundleId: "bundle-1",
    storagePrefix: "article-bundles/bundle-1",
    contentHash: "sha256:abc",
    sourceProvider: "wechat2rss",
    sourceId: "embassy-feed",
    sourceName: "Example Embassy",
    mode: "production" as const,
  };
}

function bundleStorage(
  { imageKind = "stable" }: { imageKind?: "stable" | "reference" } = {},
) {
  const image = imageKind === "stable"
    ? {
      imageId: "poster-1",
      path: "images/poster.jpg",
      hasBytes: true,
      sourceUrl: "https://mmbiz.qpic.cn/remote-poster",
      contentType: "image/jpeg",
      contentHash: "sha256:poster",
      width: 1080,
      height: 1440,
      altText: "Poster",
    }
    : {
      imageId: "poster-1",
      path: "images/poster-1.reference.json",
      hasBytes: false,
      sourceUrl: "https://mmbiz.qpic.cn/remote-poster",
      contentType: "image/jpeg",
      contentHash: "sha256:poster",
      width: 1080,
      height: 1440,
      altText: "Poster",
    };
  const files: Record<string, string> = {
    "bundle-1/manifest.json": JSON.stringify({
      bundleVersion: "article-bundle-v1",
      bundleId: "bundle-1",
      sourceProvider: "wechat2rss",
      sourceUrl: "https://mp.weixin.qq.com/s/example",
      canonicalUrl: "https://mp.weixin.qq.com/s/example",
      publishedAt: "2026-06-08T10:00:00+08:00",
      capturedAt: "2026-06-08T10:30:00+08:00",
      contentHash: "sha256:abc",
      images: [image],
      links: [],
      diagnostics: [],
    }),
    "bundle-1/article.html": "<article></article>",
    "bundle-1/article.txt": "Public lecture in Beijing",
    "bundle-1/links.json": JSON.stringify({ links: [], miniPrograms: [] }),
    "bundle-1/diagnostics.json": JSON.stringify({
      diagnostics: [],
      captureWarnings: [],
    }),
  };
  const bytes: Record<string, Uint8Array> = {
    "bundle-1/images/poster.jpg": new Uint8Array([1, 2, 3, 4]),
  };
  const uploaded: Array<{
    bucket: string;
    path: string;
    body: Uint8Array;
    options?: { contentType?: string; upsert?: boolean };
  }> = [];
  return {
    uploaded,
    async downloadText(_bucket: string, path: string): Promise<string | null> {
      return files[path] ?? null;
    },
    async downloadBytes(
      _bucket: string,
      path: string,
    ): Promise<Uint8Array | null> {
      return bytes[path] ?? null;
    },
    async uploadBytes(
      bucket: string,
      path: string,
      body: Uint8Array,
      options?: { contentType?: string; upsert?: boolean },
    ) {
      uploaded.push({ bucket, path, body, options });
    },
    async createPublicUrl(bucket: string, path: string): Promise<string> {
      return `https://supabase.test/storage/v1/object/public/${bucket}/${path}`;
    },
  };
}

function successfulProvider() {
  return {
    name: "mock",
    model: "mock-vision",
    async analyze() {
      return {
        json: JSON.stringify({
          decision: "needs_review",
          reason: "Public event found",
          confidence: 0.88,
          events: [
            {
              title: "Example Public Lecture",
              originalTitle: "Example Public Lecture",
              organizer: "Example Embassy",
              startsAt: "2026-06-10T11:00:00+08:00",
              timezone: "Asia/Shanghai",
              city: "Beijing",
              venueName: "Cultural Center",
              reservationStatus: "required",
              registrationUrl: "https://example.org/register",
              summary: "A public lecture.",
              publicEligibility: "public",
              triageDecision: "public_activity",
              triageAction: "extract",
              eventKind: "single",
              scheduleKind: "single",
              confidence: 0.88,
              publish: {
                createCanonicalEvent: true,
                confidence: 0.93,
              },
              evidence: [
                { imageId: "poster-1", role: "poster", confidence: 0.91 },
              ],
            },
          ],
          dedupe: { decision: "new_event", confidence: 0.74 },
          usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
        }),
        usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
      };
    },
  };
}

function multiEventProvider() {
  return {
    name: "mock",
    model: "mock-vision",
    async analyze() {
      const event = {
        title: "Example Public Lecture",
        startsAt: "2026-06-10T11:00:00+08:00",
        publicEligibility: "public",
        triageDecision: "public_activity",
        triageAction: "extract",
        confidence: 0.9,
        publish: { createCanonicalEvent: true, confidence: 0.96 },
        evidence: [{ imageId: "poster-1", role: "poster", confidence: 0.91 }],
      };
      return {
        json: JSON.stringify({
          decision: "needs_review",
          reason: "Two events found",
          confidence: 0.88,
          events: [
            event,
            {
              ...event,
              title: "Second Event Needs Review",
              startsAt: undefined,
              publish: { createCanonicalEvent: false, confidence: 0.5 },
            },
          ],
          dedupe: { decision: "new_event", confidence: 0.74 },
          usage: { inputTokens: 140, outputTokens: 100, totalTokens: 240 },
        }),
        usage: { inputTokens: 140, outputTokens: 100, totalTokens: 240 },
      };
    },
  };
}

function createRecordingDb({
  canonicalCandidates = [],
  failInserts = {},
  enforceUniqueIds = false,
  staleArticleBundleLookup = false,
  initialArticleBundles = [],
}: {
  canonicalCandidates?: Record<string, unknown>[];
  failInserts?: Record<string, string>;
  enforceUniqueIds?: boolean;
  staleArticleBundleLookup?: boolean;
  initialArticleBundles?: Record<string, unknown>[];
} = {}) {
  const rows: Record<string, Record<string, unknown>[]> = {
    article_bundles: [...initialArticleBundles],
  };
  return {
    upsertCalls: [] as Array<{
      table: string;
      payload: Record<string, unknown>;
      options?: Record<string, unknown>;
    }>,
    articleBundleWrites: [] as Array<{
      status: "analysis_started" | "processed" | "failed";
      payload: Record<string, unknown>;
    }>,
    async insert(
      table: string,
      payload: Record<string, unknown> | Record<string, unknown>[],
    ) {
      const failure = failInserts[table];
      if (failure) throw new Error(failure);
      const items = Array.isArray(payload) ? payload : [payload];
      rows[table] ??= [];
      if (enforceUniqueIds) {
        for (const item of items) {
          const uniqueKey = uniqueKeyForTable(table);
          if (
            uniqueKey && item[uniqueKey] &&
            rows[table].some((row) => row[uniqueKey] === item[uniqueKey])
          ) {
            throw new Error(`duplicate_${table}_${uniqueKey}`);
          }
        }
      }
      rows[table].push(...items);
      return items;
    },
    async upsert(
      table: string,
      payload: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) {
      const failure = failInserts[table];
      if (failure) throw new Error(failure);
      this.upsertCalls.push({ table, payload, options });
      rows[table] ??= [];
      const conflictKey = String(options?.onConflict ?? "bundle_id");
      const existingIndex = rows[table].findIndex((row) =>
        row[conflictKey] && row[conflictKey] === payload[conflictKey]
      );
      if (existingIndex >= 0) rows[table][existingIndex] = payload;
      else rows[table].push(payload);
      return payload;
    },
    async writeArticleBundle(
      payload: Record<string, unknown>,
      status: "analysis_started" | "processed" | "failed",
    ) {
      this.articleBundleWrites.push({ status, payload });
      rows.article_bundles ??= [];
      const existingIndex = rows.article_bundles.findIndex((row) =>
        row.bundle_id === payload.bundle_id
      );
      if (status === "analysis_started") {
        if (existingIndex < 0) {
          rows.article_bundles.push(withUpdatedAt(payload));
          return "written";
        }
        if (rows.article_bundles[existingIndex].status === "failed") {
          rows.article_bundles[existingIndex] = withUpdatedAt(payload);
          return "written";
        }
        if (
          rows.article_bundles[existingIndex].status === "analysis_started" &&
          isStaleBundleClaim(rows.article_bundles[existingIndex].updated_at)
        ) {
          rows.article_bundles[existingIndex] = withUpdatedAt(payload);
          return "written";
        }
        return rows.article_bundles[existingIndex].status === "processed"
          ? "skipped_processed"
          : "skipped_existing";
      }
      if (existingIndex < 0) {
        rows.article_bundles.push(withUpdatedAt(payload));
        return "written";
      }
      if (rows.article_bundles[existingIndex].status === "processed") {
        return "skipped_processed";
      }
      rows.article_bundles[existingIndex] = withUpdatedAt(payload);
      return "written";
    },
    async findCanonicalCandidates() {
      return canonicalCandidates;
    },
    async findArticleBundle(bundleId: string, mode: string) {
      if (staleArticleBundleLookup) return null;
      return (rows.article_bundles ?? []).find((row) =>
        row.bundle_id === bundleId && row.mode === mode
      ) ?? null;
    },
    table(name: string) {
      return rows[name] ?? [];
    },
  };
}

function withUpdatedAt(row: Record<string, unknown>) {
  return { ...row, updated_at: new Date().toISOString() };
}

function isStaleBundleClaim(value: unknown) {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp) && Date.now() - timestamp > 30 * 60 * 1000;
}

function uniqueKeyForTable(table: string): string | undefined {
  return ({
    article_bundles: "bundle_id",
    canonical_events: "event_id",
    dedupe_decisions: "dedupe_id",
    event_drafts: "draft_id",
    evidence_assets: "asset_id",
    excluded_articles: "excluded_article_id",
    llm_usage_ledger: "usage_id",
    processing_ledger: "ledger_id",
  } as Record<string, string>)[table];
}
