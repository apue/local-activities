import { describe, expect, it } from "vitest";

import type {
  ArticleSnapshot,
  CollectorEnvelope,
  CollectorFailure,
  EventDraftUpload,
  EvidenceAsset,
  SourceRunReport,
} from "../contracts/collector";
import {
  ingestArticleSnapshot,
  ingestCollectorFailure,
  ingestEventDraft,
  ingestEvidenceAsset,
  ingestSourceRun,
  type CollectorIngestStore,
} from "./collector-ingest-service";

class MemoryIngestStore implements CollectorIngestStore {
  sourceRuns = new Map<string, string>();
  articleSnapshots = new Map<string, string>();
  evidenceAssets = new Map<string, string>();
  eventDrafts = new Map<string, string>();
  failures = new Map<string, string>();

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

  async upsertCollectorFailure(input: { failureId: string }) {
    const id =
      this.failures.get(input.failureId) ?? `failure-${this.failures.size + 1}`;
    this.failures.set(input.failureId, id);
    return { id };
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

    await expect(ingestEventDraft(envelope, store)).resolves.toEqual({
      id: "draft-1",
    });
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
