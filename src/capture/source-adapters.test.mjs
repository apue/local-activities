import { describe, expect, it } from "vitest";

import { articleBundleToExtractionInput } from "./article-bundle.mjs";
import {
  createLocalFixtureArticleBundle,
  createUrlBrowserArticleBundle,
  createWechat2RssArticleBundle,
} from "./source-adapters.mjs";

describe("capture source adapters", () => {
  it("creates a captured article bundle from URL browser text and HTML images", () => {
    const bundle = createUrlBrowserArticleBundle({
      sourceUrl: "https://mp.weixin.qq.com/s/url-browser",
      finalUrl: "https://mp.weixin.qq.com/s/url-browser",
      title: "周末活动",
      authorName: "Embassy Culture",
      publishedAt: "2026-06-01T10:00:00.000Z",
      capturedAt: "2026-06-05T03:00:00.000Z",
      text: "周末活动\n扫码报名\n6月8日 19:00 北京文化中心",
      html: `
        <section>
          <a href="https://example.com/register">Register now</a>
          <mp-miniprogram data-miniprogram-appid="wx123" data-miniprogram-path="pages/register">预约报名</mp-miniprogram>
          <img data-src="https://mmbiz.qpic.cn/poster.jpg" alt="活动海报" width="900" height="1200" />
          <img data-src="https://mmbiz.qpic.cn/register-qr.jpg" alt="报名二维码" />
        </section>
      `,
    });

    expect(bundle).toMatchObject({
      version: "captured-article-bundle-v1",
      provider: "url_browser",
      sourceUrl: "https://mp.weixin.qq.com/s/url-browser",
      title: "周末活动",
      authorName: "Embassy Culture",
      captureMode: "image_with_qr_registration",
    });
    expect(bundle.images.map((image) => image.role)).toEqual(["poster", "qr"]);
    expect(bundle.links).toEqual([
      {
        url: "https://example.com/register",
        text: "Register now",
        role: "registration",
        source: "html",
      },
    ]);
    expect(bundle.miniPrograms).toEqual([
      {
        appId: "wx123",
        path: "pages/register",
        text: "预约报名",
        actionType: "registration",
        source: "html",
      },
    ]);

    const extractionInput = articleBundleToExtractionInput(bundle);
    expect(extractionInput.articleSnapshot).toMatchObject({
      canonicalUrl: "https://mp.weixin.qq.com/s/url-browser",
      captureMode: "image_with_qr_registration",
    });
    expect(extractionInput.evidenceAssets.map((asset) => asset.role)).toEqual([
      "poster",
      "qr",
    ]);
    expect(extractionInput.articleSnapshot.evidenceAssetIds).toEqual(
      extractionInput.evidenceAssets.map((asset) => asset.assetId),
    );
  });

  it("creates a captured article bundle from a normalized Wechat2RSS article", () => {
    const bundle = createWechat2RssArticleBundle({
      article: {
        sourceId: "goethe-798",
        sourceName: "Goethe-Institut Beijing",
        title: "每周六，来歌德798图书馆",
        summary: "扫码预约",
        contentText: "每周六 10:00-18:00 歌德798图书馆",
        contentHtml: `
          <p>扫码预约</p>
          <a href="https://example.com/library-signup">预约报名</a>
          <mp-miniprogram data-appid="wx-library" data-path="pages/signup">小程序预约</mp-miniprogram>
          <img src="https://mmbiz.qpic.cn/library-poster.jpg" alt="活动海报" width="1080" height="1350" />
          <img src="https://mmbiz.qpic.cn/library-qr.jpg" alt="预约二维码" />
        `,
        url: "https://mp.weixin.qq.com/s/wechat2rss",
        publishedAt: "2026-06-02T08:00:00.000Z",
      },
      capturedAt: "2026-06-05T03:00:00.000Z",
    });

    expect(bundle).toMatchObject({
      provider: "wechat2rss",
      sourceId: "goethe-798",
      sourceName: "Goethe-Institut Beijing",
      sourceUrl: "https://mp.weixin.qq.com/s/wechat2rss",
      title: "每周六，来歌德798图书馆",
      authorName: "Goethe-Institut Beijing",
      captureMode: "image_with_qr_registration",
    });
    expect(bundle.text).toContain("每周六 10:00-18:00");
    expect(bundle.images.map((image) => image.role)).toEqual(["poster", "qr"]);
    expect(bundle.links).toEqual([
      {
        url: "https://example.com/library-signup",
        text: "预约报名",
        role: "registration",
        source: "html",
      },
    ]);
    expect(bundle.miniPrograms).toEqual([
      {
        appId: "wx-library",
        path: "pages/signup",
        text: "小程序预约",
        actionType: "registration",
        source: "html",
      },
    ]);

    const { articleSnapshot, evidenceAssets } = articleBundleToExtractionInput(bundle);
    expect(articleSnapshot).toMatchObject({
      sourceId: "goethe-798",
      sourceName: "Goethe-Institut Beijing",
      title: "每周六，来歌德798图书馆",
      captureMode: "image_with_qr_registration",
    });
    expect(evidenceAssets).toHaveLength(2);
  });

  it("creates a local fixture bundle using the same contract shape", () => {
    const bundle = createLocalFixtureArticleBundle({
      fixtureId: "fixture-registration",
      sourceUrl: "https://mp.weixin.qq.com/s/fixture",
      canonicalUrl: "https://mp.weixin.qq.com/s/canonical-fixture",
      title: "Fixture event",
      authorName: "Fixture Source",
      capturedAt: "2026-06-05T03:00:00.000Z",
      text: "Fixture event\nRegistration link below",
      html: "<a href=\"https://example.com/signup\">Sign up</a>",
      links: [{ url: "https://example.com/signup", text: "Sign up" }],
      miniPrograms: [{ appId: "wx-fixture", path: "pages/signup" }],
      captureWarnings: [{ code: "fixture_replay", message: "Loaded from fixture" }],
    });

    expect(bundle).toMatchObject({
      provider: "local_fixture",
      sourceId: "fixture-registration",
      sourceName: "local_fixture",
      sourceUrl: "https://mp.weixin.qq.com/s/fixture",
      canonicalUrl: "https://mp.weixin.qq.com/s/canonical-fixture",
      links: [{ url: "https://example.com/signup", text: "Sign up" }],
      miniPrograms: [{ appId: "wx-fixture", path: "pages/signup" }],
      captureWarnings: [{ code: "fixture_replay", message: "Loaded from fixture" }],
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });
});
