import { describe, expect, it } from "vitest";

import {
  collectorEnvelopeSchema,
  evidenceAssetSchema,
} from "../src/contracts/collector";
import {
  buildImageEvidenceAssetEnvelopes,
  captureModeForImageEvidence,
  classifyImageCandidate,
  extractImageCandidatesFromHtml,
} from "./wechat-image-evidence.mjs";

describe("WeChat image evidence helpers", () => {
  it("extracts image candidates from WeChat-like lazy image HTML", () => {
    const candidates = extractImageCandidatesFromHtml(
      `
        <p>Scan the QR to register.</p>
        <img data-src="/poster.png" alt="活动海报" width="900" height="1200" />
        <img data-src="https://mmbiz.qpic.cn/qr.jpg" alt="报名二维码" />
        <img data-src="https://mmbiz.qpic.cn/qr.jpg" alt="duplicate" />
      `,
      { articleUrl: "https://mp.weixin.qq.com/s/activity" },
    );

    expect(candidates).toEqual([
      {
        url: "https://mp.weixin.qq.com/poster.png",
        alt: "活动海报",
        width: 900,
        height: 1200,
        source: "html_img",
      },
      {
        url: "https://mmbiz.qpic.cn/qr.jpg",
        alt: "报名二维码",
        source: "html_img",
      },
    ]);
  });

  it("classifies poster, QR, and ordinary article images", () => {
    expect(
      classifyImageCandidate({
        url: "https://mmbiz.qpic.cn/a.jpg",
        alt: "报名二维码",
      }),
    ).toBe("qr");
    expect(
      classifyImageCandidate({
        url: "https://mmbiz.qpic.cn/event-poster.jpg",
      }),
    ).toBe("poster");
    expect(
      classifyImageCandidate({
        url: "https://mmbiz.qpic.cn/body.jpg",
        width: 120,
        height: 80,
      }),
    ).toBe("article_image");
  });

  it("builds evidence asset envelopes accepted by collector contracts", () => {
    const envelopes = buildImageEvidenceAssetEnvelopes({
      collectorId: "collector-1",
      runId: "run-1",
      observedAt: "2026-06-03T08:00:00.000Z",
      articleUrl: "https://mp.weixin.qq.com/s/activity",
      imageCandidates: [
        {
          url: "https://mmbiz.qpic.cn/poster.jpg",
          alt: "活动海报",
          width: 900,
          height: 1200,
        },
        {
          url: "https://mmbiz.qpic.cn/register-qr.jpg",
          alt: "报名二维码",
        },
      ],
    });

    expect(envelopes.map((envelope) => envelope.payload.role)).toEqual([
      "poster",
      "qr",
    ]);
    expect(envelopes.map((envelope) => envelope.payload.assetId)).toEqual([
      expect.stringMatching(/^asset-[a-f0-9]{24}$/),
      expect.stringMatching(/^asset-[a-f0-9]{24}$/),
    ]);
    expect(() =>
      collectorEnvelopeSchema(evidenceAssetSchema).parse(envelopes[0]),
    ).not.toThrow();
  });

  it("stores supported image evidence through an injected public asset uploader", async () => {
    const putCalls = [];
    const fetchCalls = [];
    const envelopes = await buildImageEvidenceAssetEnvelopes({
      collectorId: "collector-1",
      runId: "run-1",
      observedAt: "2026-06-03T08:00:00.000Z",
      articleUrl: "https://mp.weixin.qq.com/s/activity",
      imageCandidates: [
        {
          url: "https://mmbiz.qpic.cn/poster.jpg",
          alt: "活动海报",
          width: 900,
          height: 1200,
        },
        {
          url: "https://mmbiz.qpic.cn/register-qr.jpg",
          alt: "报名二维码",
        },
      ],
      storeImages: true,
      fetchImpl: async (url) => {
        fetchCalls.push(url);
        return new Response(Buffer.from(`bytes:${url}`), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      },
      putPublicAsset: async (input) => {
        putCalls.push(input);
        return {
          url: `https://blob.example.com/${input.role}/${input.keyHint}.jpg`,
        };
      },
    });

    expect(fetchCalls).toEqual([
      "https://mmbiz.qpic.cn/poster.jpg",
      "https://mmbiz.qpic.cn/register-qr.jpg",
    ]);
    expect(putCalls.map((call) => call.role)).toEqual([
      "poster",
      "registration_qr",
    ]);
    expect(envelopes.map((envelope) => envelope.payload.storagePath)).toEqual([
      expect.stringContaining("https://blob.example.com/poster/"),
      expect.stringContaining("https://blob.example.com/registration_qr/"),
    ]);
    expect(envelopes[0].payload.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(envelopes[0].payload.contentHash).not.toBe(
      envelopes[1].payload.contentHash,
    );
  });

  it("keeps source-only evidence when image storage fails", async () => {
    const envelopes = await buildImageEvidenceAssetEnvelopes({
      collectorId: "collector-1",
      runId: "run-1",
      observedAt: "2026-06-03T08:00:00.000Z",
      articleUrl: "https://mp.weixin.qq.com/s/activity",
      imageCandidates: [
        {
          url: "https://mmbiz.qpic.cn/poster.jpg",
          alt: "活动海报",
          width: 900,
          height: 1200,
        },
      ],
      storeImages: true,
      fetchImpl: async () => {
        throw new Error("image_fetch_failed");
      },
      putPublicAsset: async () => {
        throw new Error("should_not_upload");
      },
    });

    expect(envelopes).toHaveLength(1);
    expect(envelopes[0].payload).toMatchObject({
      role: "poster",
      sourceUrl: "https://mmbiz.qpic.cn/poster.jpg",
    });
    expect(envelopes[0].payload.storagePath).toBeUndefined();
  });

  it("keeps evidence asset ids distinct when different articles reuse the same image", () => {
    const sharedImage = {
      url: "https://mmbiz.qpic.cn/shared-poster.jpg",
      alt: "活动海报",
      width: 900,
      height: 1200,
    };
    const first = buildImageEvidenceAssetEnvelopes({
      collectorId: "collector-1",
      runId: "run-1",
      observedAt: "2026-06-03T08:00:00.000Z",
      articleUrl: "https://mp.weixin.qq.com/s/activity-one",
      imageCandidates: [sharedImage],
    });
    const second = buildImageEvidenceAssetEnvelopes({
      collectorId: "collector-1",
      runId: "run-1",
      observedAt: "2026-06-03T08:00:00.000Z",
      articleUrl: "https://mp.weixin.qq.com/s/activity-two",
      imageCandidates: [sharedImage],
    });

    expect(first[0].payload.assetId).not.toBe(second[0].payload.assetId);
    expect(first[0].payload.contentHash).toBe(second[0].payload.contentHash);
  });

  it("does not invent evidence assets for text-only articles", () => {
    const candidates = extractImageCandidatesFromHtml("<p>Text only</p>", {
      articleUrl: "https://mp.weixin.qq.com/s/text",
    });
    const envelopes = buildImageEvidenceAssetEnvelopes({
      collectorId: "collector-1",
      runId: "run-1",
      observedAt: "2026-06-03T08:00:00.000Z",
      articleUrl: "https://mp.weixin.qq.com/s/text",
      imageCandidates: candidates,
    });

    expect(candidates).toEqual([]);
    expect(envelopes).toEqual([]);
    expect(
      captureModeForImageEvidence({
        visibleText: "A readable activity page.",
        evidenceAssets: envelopes,
      }),
    ).toBe("text_complete");
  });
});
