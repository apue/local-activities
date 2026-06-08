import { describe, expect, it } from "vitest";

import type {
  ArticleSnapshot,
  CollectorEnvelope,
  CollectorFailure,
  EventDraftUpload,
  EvidenceAsset,
  LlmUsageEventUpload,
  SourceCandidate,
  SourceRunReport,
} from "../contracts/collector";
import {
  ingestArticleSnapshot,
  ingestCollectorFailure,
  ingestEventDraft,
  ingestEvidenceAsset,
  ingestLlmUsage,
  ingestSourceRun,
  type CollectorIngestStore,
  type NormalizedLlmUsageEnvelope,
} from "./collector-ingest-service";

class MemoryIngestStore implements CollectorIngestStore {
  sourceRuns = new Map<string, string>();
  articleSnapshots = new Map<string, string>();
  evidenceAssets = new Map<string, string>();
  eventDrafts = new Map<string, string>();
  failures = new Map<string, string>();
  sourceCandidates = new Map<string, string>();
  llmUsage: NormalizedLlmUsageEnvelope[] = [];
  publishedDrafts: Array<{
    title: string;
    scheduleText?: string;
    posterImageUrl?: string;
    publishedAt: string;
  }> = [];

  async upsertSourceCandidate(input: CollectorEnvelope<SourceCandidate>) {
    const key = input.payload.sourceKey;
    const id =
      this.sourceCandidates.get(key) ??
      `source-${this.sourceCandidates.size + 1}`;
    this.sourceCandidates.set(key, id);
    return { id };
  }

  async upsertSourceRun(input: {
    collectorId: string;
    runId: string;
  }) {
    const key = `${input.collectorId}:${input.runId}`;
    const id = this.sourceRuns.get(key) ?? `source-run-${this.sourceRuns.size + 1}`;
    this.sourceRuns.set(key, id);
    return { id };
  }

  async upsertArticleSnapshot(input: CollectorEnvelope<ArticleSnapshot>) {
    const key = `${input.payload.canonicalUrl}:${input.payload.contentHash}`;
    const id =
      this.articleSnapshots.get(key) ??
      `article-snapshot-${this.articleSnapshots.size + 1}`;
    this.articleSnapshots.set(key, id);
    return { id };
  }

  async upsertEvidenceAsset(input: CollectorEnvelope<EvidenceAsset>) {
    const key = `${input.payload.articleUrl}:${input.payload.role}:${input.payload.contentHash}`;
    const id =
      this.evidenceAssets.get(key) ?? `evidence-${this.evidenceAssets.size + 1}`;
    this.evidenceAssets.set(key, id);
    return { id };
  }

  async upsertEventDraft(input: CollectorEnvelope<EventDraftUpload>) {
    const key = `${input.payload.articleUrl}:${input.payload.extractionAttemptId}`;
    const id = this.eventDrafts.get(key) ?? `draft-${this.eventDrafts.size + 1}`;
    this.eventDrafts.set(key, id);
    return { id };
  }

  async publishEventDraft(input: {
    payload: EventDraftUpload;
    publishedAt: string;
  }) {
    this.publishedDrafts.push({
      title: input.payload.title ?? "",
      scheduleText: input.payload.scheduleText,
      posterImageUrl: input.payload.posterImageUrl,
      publishedAt: input.publishedAt,
    });
    return { id: `event-${this.publishedDrafts.length}` };
  }

  async upsertCollectorFailure(input: { failureId: string }) {
    const id =
      this.failures.get(input.failureId) ?? `failure-${this.failures.size + 1}`;
    this.failures.set(input.failureId, id);
    return { id };
  }

  async insertLlmUsage(input: NormalizedLlmUsageEnvelope) {
    this.llmUsage.push(input);
    return { id: input.payload.usageId };
  }
}

const envelopeBase = {
  collectorId: "home-192-168-0-16",
  runId: "run-001",
  observedAt: "2026-05-28T08:00:00.000Z",
  payloadVersion: "2026-05-collector-v1" as const,
};

describe("collector ingest service", () => {
  it("upserts source runs idempotently by collector and run id", async () => {
    const store = new MemoryIngestStore();
    const envelope: CollectorEnvelope<SourceRunReport> = {
      ...envelopeBase,
      payload: {
        status: "success",
        startedAt: "2026-05-28T07:59:00.000Z",
        checkedUrlCount: 1,
        articleCount: 1,
        draftCount: 1,
        failureCount: 0,
      },
    };

    await expect(ingestSourceRun(envelope, store)).resolves.toEqual({
      id: "source-run-1",
    });
    await expect(ingestSourceRun(envelope, store)).resolves.toEqual({
      id: "source-run-1",
    });
  });

  it("upserts article snapshots by canonical URL and content hash", async () => {
    const store = new MemoryIngestStore();
    const envelope: CollectorEnvelope<ArticleSnapshot> = {
      ...envelopeBase,
      payload: {
        canonicalUrl: "https://mp.weixin.qq.com/s/example",
        finalUrl: "https://mp.weixin.qq.com/s/example",
        capturedAt: "2026-05-28T08:00:00.000Z",
        languageHints: ["zh-CN"],
        captureMode: "text_complete",
        evidenceAssetIds: [],
        contentHash: "hash-article",
      },
    };

    const first = await ingestArticleSnapshot(envelope, store);
    const second = await ingestArticleSnapshot(envelope, store);

    expect(second.id).toBe(first.id);
  });

  it("allows event drafts with missing optional public fields", async () => {
    const store = new MemoryIngestStore();
    const envelope: CollectorEnvelope<EventDraftUpload> = {
      ...envelopeBase,
      payload: {
        articleUrl: "https://mp.weixin.qq.com/s/example",
        extractionAttemptId: "attempt-001",
        captureMode: "image_with_qr_registration",
        timezone: "Asia/Shanghai",
        city: "Beijing",
        reservationStatus: "unknown",
        signals: ["missing_required_public_field"],
        evidenceAssetIds: [],
        fieldEvidence: {},
        confidence: 0.42,
      },
    };

    await expect(ingestEventDraft(envelope, store)).resolves.toMatchObject({
      id: "draft-1",
      reviewState: "needs_info",
      autoPublished: false,
    });
    expect(store.publishedDrafts).toEqual([]);
  });

  it("keeps low-confidence complete drafts in review even when auto-publish is enabled", async () => {
    const store = new MemoryIngestStore();
    const envelope = completeDraftEnvelope({
      confidence: 0.51,
      venueName: undefined,
      venueAddress: "北京市朝阳区朝阳公园",
      scheduleText: "5月30日至31日每日10:30-18:00",
    });

    await expect(
      ingestEventDraft(envelope, store, {
        autoPublishEnabled: true,
        now: new Date("2026-05-28T08:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      id: "draft-1",
      reviewState: "needs_review",
      autoPublished: false,
    });
    expect(store.publishedDrafts).toEqual([]);
  });

  it("auto-publishes high-confidence complete drafts through backend policy", async () => {
    const store = new MemoryIngestStore();
    const envelope = completeDraftEnvelope({
      confidence: 0.96,
    });

    await expect(
      ingestEventDraft(envelope, store, {
        autoPublishEnabled: true,
        autoPublishConfidenceThreshold: 0.95,
        now: new Date("2026-05-28T08:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      id: "draft-1",
      reviewState: "approved",
      autoPublished: true,
      publishedEventId: "event-1",
    });
    expect(store.publishedDrafts).toEqual([
      {
        title: "Policy Event",
        scheduleText: undefined,
        posterImageUrl: "https://cdn.example.com/posters/policy.png",
        publishedAt: "2026-05-28T08:00:00.000Z",
      },
    ]);
  });

  it("does not auto-publish drafts already resolved as possible duplicates", async () => {
    const store = new MemoryIngestStore();
    const envelope = completeDraftEnvelope({
      confidence: 0.96,
      signals: ["possible_duplicate"],
    });

    await expect(
      ingestEventDraft(envelope, store, {
        autoPublishEnabled: true,
        now: new Date("2026-05-28T08:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      id: "draft-1",
      reviewState: "needs_review",
      autoPublished: false,
    });
    expect(store.publishedDrafts).toEqual([]);
  });

  it("does not auto-publish high-confidence drafts blocked by backend publication policy", async () => {
    for (const overrides of [
      { eventKind: "news" as const },
      { publicEligibility: "not_public" as const },
      { resolutionDecision: "update_existing" as const },
    ]) {
      const store = new MemoryIngestStore();
      const envelope = completeDraftEnvelope({
        confidence: 1,
        ...overrides,
      });

      await expect(
        ingestEventDraft(envelope, store, {
          autoPublishEnabled: true,
          autoPublishConfidenceThreshold: 0.95,
          now: new Date("2026-05-28T08:00:00.000Z"),
        }),
      ).resolves.toMatchObject({
        id: "draft-1",
        autoPublished: false,
      });
      expect(store.publishedDrafts).toEqual([]);
    }
  });

  it("does not auto-publish QR-required drafts without registration evidence", async () => {
    const store = new MemoryIngestStore();
    const envelope = completeDraftEnvelope({
      confidence: 0.98,
      reservationStatus: "required",
      registrationAction: undefined,
      registrationUrl: undefined,
      registrationQrAssetId: undefined,
    });

    await expect(
      ingestEventDraft(envelope, store, {
        autoPublishEnabled: true,
        now: new Date("2026-05-28T08:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      id: "draft-1",
      reviewState: "ready_for_review",
      autoPublished: false,
    });
    expect(store.publishedDrafts).toEqual([]);
  });

  it("uses deterministic failure identifiers for idempotency", async () => {
    const store = new MemoryIngestStore();
    const envelope: CollectorEnvelope<CollectorFailure> = {
      ...envelopeBase,
      payload: {
        articleUrl: "https://mp.weixin.qq.com/s/example",
        stage: "page_fetch",
        reason: "fetch_timeout",
        message: "Timed out while fetching page",
        retryable: true,
      },
    };

    const first = await ingestCollectorFailure(envelope, store);
    const second = await ingestCollectorFailure(envelope, store);

    expect(second.id).toBe(first.id);
  });

  it("normalizes LLM usage records with missing provider usage fields", async () => {
    const store = new MemoryIngestStore();
    const envelope: CollectorEnvelope<LlmUsageEventUpload> = {
      ...envelopeBase,
      observedAt: "2026-06-04T08:00:00.000Z",
      payload: {
        operation: "event_extraction",
        provider: "dashscope",
        model: "qwen3-vl-plus",
        status: "succeeded",
        latencyMs: 1200,
        metadata: {
          schemaVersion: "event-extraction-schema-v1",
        },
      },
    };

    const result = await ingestLlmUsage(envelope, store);

    expect(result.id).toMatch(/^usage-/);
    expect(store.llmUsage).toHaveLength(1);
    expect(store.llmUsage[0].payload).toMatchObject({
      recordedAt: "2026-06-04T08:00:00.000Z",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      reasoningOutputTokens: 0,
      costMicroCny: 0,
      sourceRunId: "run-001",
      metadata: { schemaVersion: "event-extraction-schema-v1" },
    });
    expect(store.llmUsage[0].payload.usageId).toMatch(/^usage-/);
  });

  it("upserts evidence assets by article, role, and content hash", async () => {
    const store = new MemoryIngestStore();
    const envelope: CollectorEnvelope<EvidenceAsset> = {
      ...envelopeBase,
      payload: {
        assetId: "asset-qr-1",
        articleUrl: "https://mp.weixin.qq.com/s/example",
        role: "qr",
        mediaType: "image",
        contentHash: "hash-qr",
      },
    };

    const first = await ingestEvidenceAsset(envelope, store);
    const second = await ingestEvidenceAsset(envelope, store);

    expect(second.id).toBe(first.id);
  });
});

function completeDraftEnvelope(
  overrides: Partial<EventDraftUpload> = {},
): CollectorEnvelope<EventDraftUpload> {
  return {
    ...envelopeBase,
    payload: {
      articleUrl: "https://mp.weixin.qq.com/s/policy",
      extractionAttemptId: "attempt-policy",
      captureMode: "text_complete",
      title: "Policy Event",
      organizer: "Official Cultural Center",
      startsAt: "2026-06-06T06:00:00.000Z",
      timezone: "Asia/Shanghai",
      venueName: "Cultural Center Hall",
      city: "Beijing",
      reservationStatus: "required",
      registrationAction: "Register from source article",
      posterImageUrl: "https://cdn.example.com/posters/policy.png",
      posterImageAlt: "Policy Event poster",
      posterImageSourceUrl: "https://example.com/source-poster.png",
      signals: ["ready_for_review"],
      evidenceAssetIds: [],
      fieldEvidence: {},
      confidence: 0.96,
      ...overrides,
    },
  };
}
