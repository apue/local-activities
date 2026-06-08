import { describe, expect, it } from "vitest";

import {
  articleBundleToArticleSnapshot,
  articleBundleToEvidenceAssets,
  articleBundleToExtractionInput,
  createCapturedArticleBundle,
  createCaptureFailureResult,
  createCaptureSuccessResult,
  validateCaptureResult,
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

  it("allows image-dominant bundles when readable text is empty", () => {
    const bundle = createCapturedArticleBundle({
      provider: "url_browser",
      sourceUrl: "https://mp.weixin.qq.com/s/image-only",
      captureMode: "image_dominant",
      text: " ",
      images: [
        {
          id: "image-001",
          sourceUrl: "https://mmbiz.qpic.cn/image-only-poster.jpg",
          role: "poster",
        },
      ],
    });

    expect(validateCapturedArticleBundle(bundle)).toBe(true);
    expect(articleBundleToArticleSnapshot(bundle)).toMatchObject({
      canonicalUrl: "https://mp.weixin.qq.com/s/image-only",
      visibleText: "",
      captureMode: "image_dominant",
      evidenceAssetIds: [expect.stringMatching(/^asset-/)],
    });
  });

  it("rejects bundles without readable article material", () => {
    expect(() =>
      createCapturedArticleBundle({
        provider: "url_browser",
        sourceUrl: "https://mp.weixin.qq.com/s/empty",
        text: " ",
      }),
    ).toThrow("captured_bundle_material_required");
  });

  it("preserves canonical URL, content hash, links, mini-program actions, diagnostics, and warnings", () => {
    const bundle = createCapturedArticleBundle({
      provider: "url_browser",
      sourceUrl: "https://mp.weixin.qq.com/s/source",
      canonicalUrl: "https://mp.weixin.qq.com/s/canonical",
      finalUrl: "https://mp.weixin.qq.com/s/final",
      capturedAt: "2026-06-05T02:00:00.000Z",
      text: "Registration opens today",
      html: "<a href=\"/register\">Register</a>",
      links: [
        {
          url: "/register",
          text: "Register",
          role: "registration",
        },
      ],
      miniPrograms: [
        {
          appId: "wx123",
          path: "pages/register",
          text: "Mini registration",
          actionType: "registration",
        },
      ],
      diagnostics: [{ key: "dom_eval", value: "ok" }],
      captureWarnings: [{ code: "body_html_fallback", message: "Used DOM eval" }],
    });

    expect(bundle).toMatchObject({
      canonicalUrl: "https://mp.weixin.qq.com/s/canonical",
      finalUrl: "https://mp.weixin.qq.com/s/final",
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      links: [
        {
          url: "https://mp.weixin.qq.com/register",
          text: "Register",
          role: "registration",
        },
      ],
      miniPrograms: [
        {
          appId: "wx123",
          path: "pages/register",
          text: "Mini registration",
          actionType: "registration",
        },
      ],
      diagnostics: [{ key: "dom_eval", value: "ok" }],
      captureWarnings: [{ code: "body_html_fallback", message: "Used DOM eval" }],
    });
    expect(articleBundleToArticleSnapshot(bundle)).toMatchObject({
      canonicalUrl: "https://mp.weixin.qq.com/s/canonical",
      finalUrl: "https://mp.weixin.qq.com/s/final",
      contentHash: bundle.contentHash,
    });
  });

  it("wraps successful and failed captures in a typed capture result", () => {
    const bundle = createCapturedArticleBundle({
      provider: "url_browser",
      sourceUrl: "https://mp.weixin.qq.com/s/success",
      text: "Successful capture",
    });
    const success = createCaptureSuccessResult({
      bundle,
      diagnostics: [{ key: "runner", value: "fake" }],
    });
    const failure = createCaptureFailureResult({
      stage: "page_fetch",
      reason: "login_required",
      message: "Login is required before capture.",
      retryable: true,
      sourceUrl: "https://mp.weixin.qq.com/s/login",
      diagnostics: [{ key: "status", value: "401" }],
    });

    expect(validateCaptureResult(success)).toBe(true);
    expect(validateCaptureResult(failure)).toBe(true);
    expect(success).toMatchObject({
      ok: true,
      bundle,
      diagnostics: [{ key: "runner", value: "fake" }],
    });
    expect(failure).toMatchObject({
      ok: false,
      failure: {
        stage: "page_fetch",
        reason: "login_required",
        retryable: true,
        sourceUrl: "https://mp.weixin.qq.com/s/login",
      },
    });
  });
});
