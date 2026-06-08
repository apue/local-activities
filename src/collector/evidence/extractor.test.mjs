import { describe, expect, it } from "vitest";

import { createCapturedArticleBundle } from "../../capture/article-bundle.mjs";
import { extractEvidenceFromArticleBundle } from "./extractor.mjs";

describe("EvidenceExtractor", () => {
  it("emits poster and QR registration evidence from bundle image metadata", () => {
    const evidence = extractEvidenceFromArticleBundle(
      bundle({
        text: "Public lecture. Scan the code to register.",
        images: [
          {
            id: "poster",
            sourceUrl: "https://mmbiz.qpic.cn/poster.jpg",
            role: "poster",
            width: 900,
            height: 1200,
          },
          {
            id: "registration-qr",
            sourceUrl: "https://mmbiz.qpic.cn/random-image.jpg",
            role: "registration",
            width: 320,
            height: 320,
          },
        ],
      }),
    );

    expect(evidence.posters).toHaveLength(1);
    expect(evidence.qrCodes).toEqual([
      expect.objectContaining({
        kind: "qr_code",
        registrationLikely: true,
        sourceImageId: "registration-qr",
        evidenceRole: "registration",
      }),
    ]);
    expect(evidence.evidenceAssets.map((asset) => asset.role)).toEqual([
      "poster",
      "registration",
    ]);
    expect(evidence.assetRequests).toEqual([
      expect.objectContaining({ role: "poster" }),
      expect.objectContaining({ role: "registration_qr" }),
    ]);
  });

  it("keeps poster-only and image-dominant article images typed separately", () => {
    const evidence = extractEvidenceFromArticleBundle(
      bundle({
        text: "",
        images: [
          {
            id: "hero",
            sourceUrl: "https://mmbiz.qpic.cn/event-art.jpg",
            role: "poster",
            width: 1080,
            height: 1600,
          },
          {
            id: "body",
            sourceUrl: "https://mmbiz.qpic.cn/gallery.jpg",
            role: "article_image",
            width: 640,
            height: 360,
          },
        ],
      }),
    );

    expect(evidence.posters.map((item) => item.sourceImageId)).toEqual(["hero"]);
    expect(evidence.articleImages.map((item) => item.sourceImageId)).toEqual([
      "body",
    ]);
    expect(evidence.qrCodes).toEqual([]);
    expect(evidence.summary).toMatchObject({
      posterCount: 1,
      articleImageCount: 1,
      imageDominant: true,
    });
  });

  it("preserves registration links and WeChat mini-program actions", () => {
    const evidence = extractEvidenceFromArticleBundle(
      bundle({
        text: "Click below to reserve your seat.",
        links: [
          {
            url: "https://example.com/signup",
            text: "Register now",
            role: "registration",
          },
          {
            url: "https://example.com/about",
            text: "About the venue",
            role: "article_link",
          },
        ],
        miniPrograms: [
          {
            appId: "wx123",
            path: "pages/register?id=event",
            text: "小程序预约",
            actionType: "registration",
            source: "html",
          },
        ],
      }),
    );

    expect(evidence.registrationUrls).toEqual([
      expect.objectContaining({
        kind: "registration_url",
        url: "https://example.com/signup",
        registrationLikely: true,
      }),
    ]);
    expect(evidence.miniProgramActions).toEqual([
      expect.objectContaining({
        kind: "mini_program_action",
        appId: "wx123",
        path: "pages/register?id=event",
        actionType: "registration",
        registrationLikely: true,
      }),
    ]);
    expect(evidence.articleLinks).toEqual([
      expect.objectContaining({ url: "https://example.com/about" }),
    ]);
  });

  it("does not classify images as QR solely because the URL contains qr", () => {
    const evidence = extractEvidenceFromArticleBundle(
      bundle({
        text: "Embassy article with a normal inline photo.",
        images: [
          {
            id: "not-qr",
            sourceUrl: "https://mmbiz.qpic.cn/random-qr-token-photo.jpg",
            role: "article_image",
            width: 640,
            height: 360,
          },
        ],
      }),
    );

    expect(evidence.qrCodes).toEqual([]);
    expect(evidence.articleImages).toEqual([
      expect.objectContaining({
        sourceImageId: "not-qr",
        nonRegistrationReason: "article_image",
      }),
    ]);
  });

  it("labels footer/share QR-like images as non-registration evidence", () => {
    const evidence = extractEvidenceFromArticleBundle(
      bundle({
        text: "Follow our account for updates.",
        images: [
          {
            id: "footer-qr",
            sourceUrl: "https://mmbiz.qpic.cn/footer.jpg",
            role: "qr",
            width: 240,
            height: 240,
            textContent: "长按关注公众号",
          },
          {
            id: "share-card",
            sourceUrl: "https://mmbiz.qpic.cn/share.jpg",
            role: "qr",
            width: 240,
            height: 240,
            textContent: "分享给朋友",
          },
        ],
      }),
    );

    expect(evidence.qrCodes).toEqual([]);
    expect(evidence.nonRegistrationImages.map((item) => item.reason)).toEqual([
      "follow_or_footer_qr",
      "share_or_contact_qr",
    ]);
    expect(evidence.articleImages.map((item) => item.sourceImageId)).toEqual([
      "footer-qr",
      "share-card",
    ]);
  });
});

function bundle(overrides = {}) {
  return createCapturedArticleBundle({
    provider: "local_fixture",
    sourceUrl: "https://mp.weixin.qq.com/s/evidence-fixture",
    capturedAt: "2026-06-08T09:00:00.000Z",
    text: "Fixture article",
    ...overrides,
  });
}
