import { describe, expect, it } from "vitest";

import {
  articleSnapshotSchema,
  collectorEnvelopeSchema,
  collectorFailureSchema,
  eventDraftUploadSchema,
  evidenceAssetSchema,
  sourceRunReportSchema,
} from "../src/contracts/collector";
import {
  formatWechat2RssSyncSummary,
  readWechat2RssSyncConfig,
  runWechat2RssSyncOnce,
} from "./wechat2rss-sync.mjs";

describe("Wechat2RSS one-shot sync", () => {
  it("reports missing sync configuration without leaking provided secrets", () => {
    expect(readWechat2RssSyncConfig({})).toEqual({
      ok: false,
      missing: [
        "COLLECTOR_BASE_URL",
        "COLLECTOR_API_KEY",
        "COLLECTOR_ID",
        "WECHAT2RSS_BASE_URL",
        "WECHAT2RSS_TOKEN",
      ],
    });
  });

  it("uploads one source run and deduplicated article snapshots", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
      if (url.includes("/login/list")) {
        return jsonResponse({ accounts: [{ nickname: "reader", status: "正常" }] });
      }
      if (url.includes("/api/query")) {
        return jsonResponse({
          data: [
            {
              title: "Activity",
              url: "https://mp.weixin.qq.com/s/activity",
              date: "2026-06-01T12:00:00+08:00",
              mpName: "Culture Org",
              digest: "Weekend activity",
            },
            {
              title: "Activity",
              url: "https://mp.weixin.qq.com/s/activity",
              date: "2026-06-01T12:00:00+08:00",
              mpName: "Culture Org",
              digest: "Weekend activity",
            },
          ],
        });
      }
      if (url.endsWith("/api/collector/source-run")) {
        return jsonResponse({ ok: true, id: "source-run-1" });
      }
      if (url.endsWith("/api/collector/article-snapshot")) {
        return jsonResponse({ ok: true, id: "snapshot-1" });
      }
      throw new Error(`unexpected_url:${url}`);
    };

    const result = await runWechat2RssSyncOnce({
      env: validEnv(),
      fetchImpl,
      now: new Date("2026-06-02T08:00:00.000Z"),
      runId: "wechat2rss-test",
    });

    expect(result).toEqual({
      kind: "uploaded",
      runId: "wechat2rss-test",
      sourceRunId: "source-run-1",
      articleCount: 1,
      uploadedArticleCount: 1,
      uploadedArticleSnapshotIds: ["snapshot-1"],
      after: "20260526",
    });
    expect(calls.map((call) => call.url)).toEqual([
      "http://localhost:4000/login/list?k=wechat-token",
      "http://localhost:4000/api/query?k=wechat-token&after=20260526&content=0",
      "https://activities.example/api/collector/source-run",
      "https://activities.example/api/collector/article-snapshot",
    ]);
    expect(calls[2].body.payload).toMatchObject({
      status: "success",
      articleCount: 1,
      checkedUrlCount: 1,
      failureCount: 0,
    });
    expect(calls[3].body.payload).toMatchObject({
      canonicalUrl: "https://mp.weixin.qq.com/s/activity",
      finalUrl: "https://mp.weixin.qq.com/s/activity",
      title: "Activity",
      authorName: "Culture Org",
      captureMode: "text_complete",
      evidenceAssetIds: [],
    });
    expect(calls[3].body.payload.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(() =>
      collectorEnvelopeSchema(sourceRunReportSchema).parse(calls[2].body),
    ).not.toThrow();
    expect(() =>
      collectorEnvelopeSchema(articleSnapshotSchema).parse(calls[3].body),
    ).not.toThrow();
    expect(calls[3].init.headers.authorization).toBe("Bearer collector-secret");
    expect(formatWechat2RssSyncSummary(result)).not.toContain("collector-secret");
    expect(formatWechat2RssSyncSummary(result)).not.toContain("wechat-token");
  });

  it("retains poster and QR image evidence from Wechat2RSS article HTML", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
      if (url.includes("/login/list")) {
        return jsonResponse({ accounts: [{ nickname: "reader", status: "正常" }] });
      }
      if (url.includes("/api/query")) {
        return jsonResponse({
          data: [
            {
              title: "QR Poster Activity",
              url: "https://mp.weixin.qq.com/s/qr-poster",
              date: "2026-06-01T12:00:00+08:00",
              mpName: "Culture Org",
              digest: "Scan the QR poster to register.",
              content:
                '<p>Scan the QR poster to register.</p><img data-src="https://mmbiz.qpic.cn/activity-poster.jpg" alt="活动海报" width="900" height="1200" /><img data-src="https://mmbiz.qpic.cn/register-qr.jpg" alt="报名二维码" />',
            },
          ],
        });
      }
      if (url.endsWith("/api/collector/source-run")) {
        return jsonResponse({ ok: true, id: "source-run-1" });
      }
      if (url.endsWith("/api/collector/article-snapshot")) {
        return jsonResponse({ ok: true, id: "snapshot-1" });
      }
      if (url.endsWith("/api/collector/evidence-asset")) {
        return jsonResponse({ ok: true, id: `evidence-${calls.length}` });
      }
      throw new Error(`unexpected_url:${url}`);
    };

    const result = await runWechat2RssSyncOnce({
      env: validEnv(),
      fetchImpl,
      now: new Date("2026-06-02T08:00:00.000Z"),
      runId: "wechat2rss-images",
    });

    const articleUpload = calls.find((call) =>
      call.url.endsWith("/api/collector/article-snapshot"),
    );
    const evidenceUploads = calls.filter((call) =>
      call.url.endsWith("/api/collector/evidence-asset"),
    );

    expect(result).toMatchObject({
      kind: "uploaded",
      uploadedEvidenceAssetCount: 2,
    });
    expect(articleUpload.body.payload).toMatchObject({
      captureMode: "image_with_qr_registration",
      evidenceAssetIds: [
        expect.stringMatching(/^asset-[a-f0-9]{24}$/),
        expect.stringMatching(/^asset-[a-f0-9]{24}$/),
      ],
    });
    expect(evidenceUploads.map((call) => call.body.payload.role)).toEqual([
      "poster",
      "qr",
    ]);
    expect(evidenceUploads[0].body.payload.sourceUrl).toBe(
      "https://mmbiz.qpic.cn/activity-poster.jpg",
    );
    expect(() =>
      collectorEnvelopeSchema(evidenceAssetSchema).parse(evidenceUploads[0].body),
    ).not.toThrow();
  });

  it("optionally extracts uploaded Wechat2RSS snapshots into reviewable drafts", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
      if (url.includes("/login/list")) {
        return jsonResponse({ accounts: [{ nickname: "reader", status: "正常" }] });
      }
      if (url.includes("/api/query")) {
        return jsonResponse({
          data: [
            {
              title: "Activity",
              url: "https://mp.weixin.qq.com/s/activity",
              date: "2026-06-01T12:00:00+08:00",
              mpName: "Culture Org",
              digest:
                "Weekend activity, June 6 14:00-16:00, Beijing Culture Center.",
              content:
                "<p>Weekend activity, June 6 14:00-16:00, Beijing Culture Center.</p>",
            },
          ],
        });
      }
      if (url === "https://api.openai.com/v1/responses") {
        return jsonResponse(openaiResponse(activityResponse()));
      }
      if (url.endsWith("/api/collector/source-run")) {
        return jsonResponse({ ok: true, id: "source-run-1" });
      }
      if (url.endsWith("/api/collector/article-snapshot")) {
        return jsonResponse({ ok: true, id: "snapshot-1" });
      }
      if (url.endsWith("/api/collector/evidence-asset")) {
        return jsonResponse({ ok: true, id: "evidence-1" });
      }
      if (url.endsWith("/api/collector/event-draft")) {
        return jsonResponse({ ok: true, id: "draft-1" });
      }
      throw new Error(`unexpected_url:${url}`);
    };

    const result = await runWechat2RssSyncOnce({
      env: extractionEnv(),
      fetchImpl,
      now: new Date("2026-06-02T08:00:00.000Z"),
      runId: "wechat2rss-extract",
      extract: true,
    });

    expect(result).toEqual({
      kind: "uploaded",
      runId: "wechat2rss-extract",
      sourceRunId: "source-run-1",
      articleCount: 1,
      uploadedArticleCount: 1,
      uploadedArticleSnapshotIds: ["snapshot-1"],
      uploadedEvidenceAssetCount: 1,
      uploadedEventDraftCount: 1,
      uploadedCollectorFailureCount: 0,
      after: "20260526",
    });
    expect(calls.map((call) => call.url)).toEqual([
      "http://localhost:4000/login/list?k=wechat-token",
      "http://localhost:4000/api/query?k=wechat-token&after=20260526&content=1",
      "https://api.openai.com/v1/responses",
      "https://activities.example/api/collector/source-run",
      "https://activities.example/api/collector/article-snapshot",
      "https://activities.example/api/collector/evidence-asset",
      "https://activities.example/api/collector/event-draft",
    ]);
    expect(calls[3].body.payload).toMatchObject({
      status: "success",
      articleCount: 1,
      draftCount: 1,
      failureCount: 0,
    });
    expect(() =>
      collectorEnvelopeSchema(evidenceAssetSchema).parse(calls[5].body),
    ).not.toThrow();
    expect(calls[4].body.payload.visibleText).toContain(
      "Weekend activity, June 6 14:00-16:00, Beijing Culture Center.",
    );
    expect(() =>
      collectorEnvelopeSchema(eventDraftUploadSchema).parse(calls[6].body),
    ).not.toThrow();
    expect(calls[6].body.payload.fieldEvidence._extraction).toEqual([
      "prompt:event-extraction-2026-06-02",
      "schema:event-extraction-schema-v1",
      "provider:openai",
      "model:gpt-5-mini",
    ]);
    expect(formatWechat2RssSyncSummary(result)).toContain("drafts=1");
    expect(formatWechat2RssSyncSummary(result)).not.toContain("openai-secret");
  });

  it("uploads extractor failures as structured collector failures without aborting sync", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
      if (url.includes("/login/list")) {
        return jsonResponse({ accounts: [{ nickname: "reader", status: "正常" }] });
      }
      if (url.includes("/api/query")) {
        return jsonResponse({
          data: [
            {
              title: "Activity",
              url: "https://mp.weixin.qq.com/s/activity",
              mpName: "Culture Org",
            },
          ],
        });
      }
      if (url.endsWith("/api/collector/source-run")) {
        return jsonResponse({ ok: true, id: "source-run-1" });
      }
      if (url.endsWith("/api/collector/article-snapshot")) {
        return jsonResponse({ ok: true, id: "snapshot-1" });
      }
      if (url.endsWith("/api/collector/failure")) {
        return jsonResponse({ ok: true, id: "failure-1" });
      }
      throw new Error(`unexpected_url:${url}`);
    };

    const result = await runWechat2RssSyncOnce({
      env: validEnv(),
      fetchImpl,
      now: new Date("2026-06-02T08:00:00.000Z"),
      runId: "wechat2rss-extract-missing",
      extract: true,
    });

    expect(result).toMatchObject({
      kind: "uploaded",
      uploadedArticleCount: 1,
      uploadedEventDraftCount: 0,
      uploadedCollectorFailureCount: 1,
    });
    expect(calls.map((call) => call.url)).toEqual([
      "http://localhost:4000/login/list?k=wechat-token",
      "http://localhost:4000/api/query?k=wechat-token&after=20260526&content=1",
      "https://activities.example/api/collector/source-run",
      "https://activities.example/api/collector/article-snapshot",
      "https://activities.example/api/collector/failure",
    ]);
    expect(calls[2].body.payload).toMatchObject({
      status: "partial",
      articleCount: 1,
      draftCount: 0,
      failureCount: 1,
      failureReason: "agent_config_missing",
    });
    expect(calls[4].body.payload).toMatchObject({
      stage: "draft_extraction",
      reason: "agent_config_missing",
      retryable: true,
    });
    expect(() =>
      collectorEnvelopeSchema(collectorFailureSchema).parse(calls[4].body),
    ).not.toThrow();
  });

  it("uploads only a failed source run when Wechat2RSS account health needs attention", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
      if (url.includes("/login/list")) {
        return jsonResponse({
          accounts: [{ nickname: "reader", status: "今日小黑屋 风控" }],
        });
      }
      return jsonResponse({ ok: true, id: "source-run-1" });
    };

    const result = await runWechat2RssSyncOnce({
      env: validEnv(),
      fetchImpl,
      now: new Date("2026-06-02T08:00:00.000Z"),
      runId: "wechat2rss-risk",
    });

    expect(result).toEqual({
      kind: "attention_needed",
      runId: "wechat2rss-risk",
      failureReason: "fetch_blocked",
      uploadedArticleCount: 0,
    });
    expect(calls.map((call) => call.url)).toEqual([
      "http://localhost:4000/login/list?k=wechat-token",
      "https://activities.example/api/collector/source-run",
    ]);
    expect(calls[1].body.payload).toMatchObject({
      status: "failed",
      failureReason: "fetch_blocked",
      failureCount: 1,
    });
  });

  it("uploads a failed source run when login health fetch fails", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
      if (url.includes("/login/list")) {
        return jsonResponse({ error: "unauthorized" }, 401);
      }
      return jsonResponse({ ok: true, id: "source-run-1" });
    };

    const result = await runWechat2RssSyncOnce({
      env: validEnv(),
      fetchImpl,
      now: new Date("2026-06-02T08:00:00.000Z"),
      runId: "wechat2rss-login-fail",
    });

    expect(result).toEqual({
      kind: "failed",
      runId: "wechat2rss-login-fail",
      failureReason: "login_required",
      uploadedArticleCount: 0,
    });
    expect(calls[1].body.payload).toMatchObject({
      status: "failed",
      failureReason: "login_required",
    });
  });

  it("surfaces collector upload failures", async () => {
    const fetchImpl = async (url) => {
      if (url.includes("/login/list")) {
        return jsonResponse({ accounts: [{ nickname: "reader", status: "正常" }] });
      }
      if (url.includes("/api/query")) {
        return jsonResponse({
          data: [
            {
              title: "Activity",
              url: "https://mp.weixin.qq.com/s/activity",
            },
          ],
        });
      }
      return jsonResponse({ ok: false, error: "invalid_collector_token" }, 401);
    };

    await expect(
      runWechat2RssSyncOnce({
        env: validEnv(),
        fetchImpl,
        now: new Date("2026-06-02T08:00:00.000Z"),
        runId: "wechat2rss-upload-fail",
      }),
    ).rejects.toThrow(
      "collector_upload_failed:/api/collector/source-run:401",
    );
  });
});

function validEnv() {
  return {
    COLLECTOR_BASE_URL: "https://activities.example",
    COLLECTOR_API_KEY: "collector-secret",
    COLLECTOR_ID: "home-1",
    WECHAT2RSS_BASE_URL: "http://localhost:4000",
    WECHAT2RSS_TOKEN: "wechat-token",
  };
}

function extractionEnv() {
  return {
    ...validEnv(),
    AGENT_PROVIDER: "openai",
    OPENAI_API_KEY: "openai-secret",
    OPENAI_MODEL: "gpt-5-mini",
    OPENAI_BASE_URL: "https://api.openai.com/v1",
  };
}

function activityResponse() {
  return {
    classification: {
      kind: "activity",
      confidence: 0.9,
      signals: [],
      missingFields: [],
    },
    events: [
      {
        title: "Activity",
        originalTitle: "Activity",
        organizer: "Culture Org",
        startsAt: "2026-06-06T06:00:00.000Z",
        endsAt: "2026-06-06T08:00:00.000Z",
        venueName: "Beijing Culture Center",
        venueAddress: "Beijing",
        reservationStatus: "required",
        registrationAction: "Register from source article",
        registrationUrl: "https://mp.weixin.qq.com/s/activity",
        summary: "Weekend activity.",
        signals: ["ready_for_review"],
        evidenceAssetIds: [],
        fieldEvidence: {
          title: ["visibleText"],
          startsAt: ["visibleText"],
          venueName: ["visibleText"],
        },
        confidence: 0.9,
      },
    ],
  };
}

function openaiResponse(data) {
  return {
    output: [
      {
        content: [
          {
            type: "output_text",
            text: JSON.stringify(data),
          },
        ],
      },
    ],
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}
