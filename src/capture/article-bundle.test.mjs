import { describe, expect, it } from "vitest";

import {
  articleBundleToArticleSnapshot,
  articleBundleToEvidenceAssets,
  articleBundleToExtractionInput,
  createCapturedArticleBundle,
  validateCapturedArticleBundle,
} from "./article-bundle.mjs";

describe("captured article bundle", () => {
  it("creates a valid text article bundle and converts it to an article snapshot", () => {
    const bundle = createCapturedArticleBundle({
      sourceId: "source-embassy",
      sourceName: "Cultural Center WeChat",
      provider: "url_browser",
      sourceUrl: "https://mp.weixin.qq.com/s/example",
      title: "Public lecture",
      authorName: "Cultural Center",
      publishedAt: "2026-06-01T04:00:00.000Z",
      capturedAt: "2026-06-05T02:00:00.000Z",
      languageHints: ["zh", "en", "zh"],
      text: "Public lecture\nJune 8 18:30\nBeijing Cultural Center",
    });

    expect(validateCapturedArticleBundle(bundle)).toBe(true);
    expect(bundle).toMatchObject({
      version: "captured-article-bundle-v1",
      provider: "url_browser",
      sourceUrl: "https://mp.weixin.qq.com/s/example",
      finalUrl: "https://mp.weixin.qq.com/s/example",
      languageHints: ["zh", "en"],
      images: [],
    });

    expect(articleBundleToArticleSnapshot(bundle)).toMatchObject({
      sourceId: "source-embassy",
      sourceName: "Cultural Center WeChat",
      canonicalUrl: "https://mp.weixin.qq.com/s/example",
      finalUrl: "https://mp.weixin.qq.com/s/example",
      title: "Public lecture",
      authorName: "Cultural Center",
      captureMode: "text_complete",
      evidenceAssetIds: [],
    });
  });

  it("converts image references into extractor evidence assets", () => {
    const bundle = createCapturedArticleBundle({
      provider: "url_browser",
      sourceUrl: "https://mp.weixin.qq.com/s/poster",
      capturedAt: "2026-06-05T02:00:00.000Z",
      captureMode: "image_with_qr_registration",
      text: "Poster event with QR registration",
      images: [
        {
          id: "image-001",
          path: "images/001.jpg",
          sourceUrl: "https://mmbiz.qpic.cn/poster.jpg",
          role: "poster",
          width: 1080,
          height: 1920,
          contentHash: "poster-hash",
        },
        {
          id: "image-002",
          storagePath: "captures/poster/images/002.jpg",
          role: "registration",
          contentHash: "qr-hash",
        },
      ],
    });

    const evidenceAssets = articleBundleToEvidenceAssets(bundle);
    expect(evidenceAssets).toEqual([
      expect.objectContaining({
        articleUrl: "https://mp.weixin.qq.com/s/poster",
        role: "poster",
        mediaType: "image",
        sourceUrl: "https://mmbiz.qpic.cn/poster.jpg",
        storagePath: "images/001.jpg",
        width: 1080,
        height: 1920,
        contentHash: "poster-hash",
      }),
      expect.objectContaining({
        role: "registration",
        storagePath: "captures/poster/images/002.jpg",
        contentHash: "qr-hash",
      }),
    ]);
    const extractionInput = articleBundleToExtractionInput(bundle);
    expect(extractionInput).toMatchObject({
      articleSnapshot: {
        captureMode: "image_with_qr_registration",
      },
      evidenceAssets,
    });
    expect(extractionInput.articleSnapshot.evidenceAssetIds).toEqual(
      evidenceAssets.map((asset) => asset.assetId),
    );
  });

  it("rejects bundles without readable article text", () => {
    expect(() =>
      createCapturedArticleBundle({
        provider: "url_browser",
        sourceUrl: "https://mp.weixin.qq.com/s/empty",
        text: " ",
      }),
    ).toThrow("captured_bundle_text_required");
  });
});
