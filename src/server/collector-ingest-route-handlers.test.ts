import { describe, expect, it } from "vitest";

import type { CollectorIngestStore } from "./collector-ingest-service";
import {
  handleArticleSnapshotIngest,
  handleEventDraftIngest,
  handleSourceRunIngest,
} from "./collector-ingest-route-handlers";

class RouteIngestStore implements CollectorIngestStore {
  async upsertSourceRun() {
    return { id: "source-run-1" };
  }

  async upsertArticleSnapshot() {
    return { id: "article-snapshot-1" };
  }

  async upsertEvidenceAsset() {
    return { id: "evidence-1" };
  }

  async upsertEventDraft() {
    return { id: "draft-1" };
  }

  async upsertCollectorFailure() {
    return { id: "failure-1" };
  }
}

function post(body: unknown, headers: HeadersInit = {}) {
  return new Request("https://example.com/api/collector/source-run", {
    method: "POST",
    headers: {
      authorization: "Bearer collector-secret",
      "content-type": "application/json",
      "x-collector-id": "home-1",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const envelopeBase = {
  collectorId: "home-1",
  runId: "run-001",
  observedAt: "2026-05-28T08:00:00.000Z",
  payloadVersion: "2026-05-collector-v1",
};

describe("collector ingest route handlers", () => {
  it("rejects unauthenticated ingest requests", async () => {
    const response = await handleSourceRunIngest(
      post(
        {
          ...envelopeBase,
          payload: {
            status: "success",
            startedAt: "2026-05-28T07:59:00.000Z",
            checkedUrlCount: 1,
            articleCount: 1,
            draftCount: 1,
            failureCount: 0,
          },
        },
        { authorization: "Bearer wrong" },
      ),
      new RouteIngestStore(),
      { COLLECTOR_API_KEY: "collector-secret" },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "invalid_collector_token",
    });
  });

  it("rejects unknown payload versions", async () => {
    const response = await handleSourceRunIngest(
      post({
        ...envelopeBase,
        payloadVersion: "old-version",
        payload: {
          status: "success",
          startedAt: "2026-05-28T07:59:00.000Z",
          checkedUrlCount: 1,
          articleCount: 1,
          draftCount: 1,
          failureCount: 0,
        },
      }),
      new RouteIngestStore(),
      { COLLECTOR_API_KEY: "collector-secret" },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "invalid_request",
    });
  });

  it("rejects collector id mismatches", async () => {
    const response = await handleArticleSnapshotIngest(
      post({
        ...envelopeBase,
        collectorId: "other",
        payload: {
          canonicalUrl: "https://mp.weixin.qq.com/s/example",
          finalUrl: "https://mp.weixin.qq.com/s/example",
          capturedAt: "2026-05-28T08:00:00.000Z",
          languageHints: [],
          captureMode: "text_complete",
          evidenceAssetIds: [],
          contentHash: "hash",
        },
      }),
      new RouteIngestStore(),
      { COLLECTOR_API_KEY: "collector-secret" },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "collector_id_mismatch",
    });
  });

  it("accepts event drafts with missing optional fields", async () => {
    const response = await handleEventDraftIngest(
      post({
        ...envelopeBase,
        payload: {
          articleUrl: "https://mp.weixin.qq.com/s/example",
          extractionAttemptId: "attempt-001",
          captureMode: "image_dominant",
          timezone: "Asia/Shanghai",
          city: "Beijing",
          signals: ["missing_required_public_field"],
          evidenceAssetIds: [],
          fieldEvidence: {},
          confidence: 0.4,
        },
      }),
      new RouteIngestStore(),
      { COLLECTOR_API_KEY: "collector-secret" },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      id: "draft-1",
      reviewState: "needs_info",
      autoPublished: false,
    });
  });

  it("rejects collector attempts to set publish state", async () => {
    const response = await handleEventDraftIngest(
      post({
        ...envelopeBase,
        payload: {
          articleUrl: "https://mp.weixin.qq.com/s/example",
          extractionAttemptId: "attempt-001",
          captureMode: "text_complete",
          timezone: "Asia/Shanghai",
          city: "Beijing",
          signals: ["ready_for_review"],
          evidenceAssetIds: [],
          fieldEvidence: {},
          confidence: 0.9,
          publishState: "published",
        },
      }),
      new RouteIngestStore(),
      { COLLECTOR_API_KEY: "collector-secret" },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "invalid_request",
    });
  });

  it("returns backend routing metadata for auto-published drafts", async () => {
    class PublishingStore extends RouteIngestStore {
      async publishEventDraft() {
        return { id: "event-1" };
      }
    }

    const response = await handleEventDraftIngest(
      post({
        ...envelopeBase,
        payload: {
          articleUrl: "https://mp.weixin.qq.com/s/example",
          extractionAttemptId: "attempt-001",
          captureMode: "text_complete",
          title: "Auto Publish Event",
          organizer: "Official Cultural Center",
          startsAt: "2026-06-06T06:00:00.000Z",
          timezone: "Asia/Shanghai",
          venueName: "Cultural Center Hall",
          city: "Beijing",
          reservationStatus: "required",
          signals: ["ready_for_review"],
          evidenceAssetIds: [],
          fieldEvidence: {},
          confidence: 0.98,
        },
      }),
      new PublishingStore(),
      {
        COLLECTOR_API_KEY: "collector-secret",
        BACKEND_AUTO_PUBLISH_ENABLED: "true",
        BACKEND_AUTO_PUBLISH_CONFIDENCE_THRESHOLD: "0.95",
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      id: "draft-1",
      reviewState: "approved",
      autoPublished: true,
      publishedEventId: "event-1",
    });
  });
});
