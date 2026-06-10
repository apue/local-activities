import { describe, expect, it } from "vitest";

import { createCapturedArticleBundle } from "../capture/article-bundle.mjs";
import { buildArticleBundleFiles } from "./bundle-files.mjs";

describe("capture worker bundle files", () => {
  it("builds directory-style bundle files without fake image bytes", () => {
    const bundle = createCapturedArticleBundle({
      provider: "wechat2rss",
      sourceId: "goethe-798",
      sourceName: "Goethe-Institut Beijing",
      sourceUrl: "https://mp.weixin.qq.com/s/bundle-file",
      canonicalUrl: "https://mp.weixin.qq.com/s/bundle-file",
      title: "Library weekend",
      publishedAt: "2026-06-08T10:00:00.000Z",
      capturedAt: "2026-06-08T11:00:00.000Z",
      text: "Library weekend\nRegister via QR",
      html: `
        <article>
          <a href="https://example.com/signup">Sign up</a>
          <img src="https://mmbiz.qpic.cn/poster.jpg" alt="poster" />
        </article>
      `,
      images: [
        {
          id: "image-001",
          sourceUrl: "https://mmbiz.qpic.cn/poster.jpg",
          role: "poster",
          alt: "poster",
        },
      ],
      links: [
        {
          url: "https://example.com/signup",
          text: "Sign up",
          role: "registration",
        },
      ],
      diagnostics: [{ key: "wechat2rss_raw_id", value: "raw-1" }],
    });

    const result = buildArticleBundleFiles({ bundle, dataClass: "production" });

    expect(result.bundleId).toMatch(/^bundle_[a-f0-9]{24}$/);
    expect(result.storagePrefix).toBe(`article-bundles/production/${result.bundleId}`);
    expect(result.files.map((file) => file.path).sort()).toEqual([
      "article.html",
      "article.txt",
      "diagnostics.json",
      "images/image-001.reference.json",
      "links.json",
      "manifest.json",
    ]);
    expect(result.files.find((file) => file.path === "article.html")).toMatchObject({
      contentType: "text/html",
    });
    expect(result.files.find((file) => file.path === "article.txt")).toMatchObject({
      contentType: "text/plain",
    });

    const manifest = JSON.parse(
      result.files.find((file) => file.path === "manifest.json").body,
    );
    expect(manifest).toMatchObject({
      bundleVersion: "article-bundle-v1",
      bundleId: result.bundleId,
      sourceProvider: "wechat2rss",
      sourceId: "goethe-798",
      sourceName: "Goethe-Institut Beijing",
      sourceUrl: "https://mp.weixin.qq.com/s/bundle-file",
      canonicalUrl: "https://mp.weixin.qq.com/s/bundle-file",
      publishedAt: "2026-06-08T10:00:00.000Z",
      capturedAt: "2026-06-08T11:00:00.000Z",
      contentHash: bundle.contentHash,
      dataClass: "production",
      images: [
        {
          id: "image-001",
          sourceUrl: "https://mmbiz.qpic.cn/poster.jpg",
          path: "images/image-001.reference.json",
          hasBytes: false,
        },
      ],
      links: [
        {
          url: "https://example.com/signup",
          text: "Sign up",
          role: "registration",
        },
      ],
    });

    const imageReference = JSON.parse(
      result.files.find((file) => file.path === "images/image-001.reference.json")
        .body,
    );
    expect(imageReference).toMatchObject({
      id: "image-001",
      sourceUrl: "https://mmbiz.qpic.cn/poster.jpg",
      hasBytes: false,
    });
  });

  it("writes image bytes as bundle image files when capture provides bytes", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const bundle = createCapturedArticleBundle({
      provider: "local_fixture",
      sourceUrl: "https://mp.weixin.qq.com/s/bundle-image-bytes",
      text: "Poster event",
      images: [
        {
          id: "image-001",
          sourceUrl: "https://mmbiz.qpic.cn/poster.jpg",
          role: "poster",
          contentType: "image/jpeg",
          bytes,
        },
      ],
    });

    const result = buildArticleBundleFiles({ bundle, dataClass: "production" });
    const imageFile = result.files.find((file) => file.path === "images/image-001.jpg");
    const manifest = JSON.parse(
      result.files.find((file) => file.path === "manifest.json").body,
    );

    expect(imageFile).toMatchObject({
      path: "images/image-001.jpg",
      body: bytes,
      contentType: "image/jpeg",
    });
    expect(manifest.images[0]).toMatchObject({
      id: "image-001",
      path: "images/image-001.jpg",
      hasBytes: true,
      contentType: "image/jpeg",
    });
    expect(manifest.images[0]).not.toHaveProperty("bytes");
  });
});
