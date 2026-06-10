import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { cleanCapturedArticleBundle } from "./content-cleaner.mjs";

describe("V5 content cleaner", () => {
  it("normalizes captured bundle text and preserves mini programs", async () => {
    const bundle = await readCorpusBundle("beiping-beer-festival-guide");

    const normalized = cleanCapturedArticleBundle(bundle);

    expect(normalized).toMatchObject({
      version: "v5-normalized-content.v1",
      title: "北平机器友谊万岁精酿啤酒节终极指南！",
      sourceName: "北平机器",
      publishedAt: "2026-06-09T07:02:00.000Z",
      sourceUrl: bundle.sourceUrl,
    });
    expect(normalized.markdown).toContain("北平机器友谊万岁精酿啤酒节");
    expect(normalized.markdown).toContain("Registration action: mini_program");
    expect(normalized.miniPrograms).toHaveLength(2);
    expect(normalized.contentStats).toMatchObject({
      imageCount: 0,
      linkCount: 0,
      miniProgramCount: 2,
    });
    expect(normalized.contentStats.textLength).toBeGreaterThan(100);
  });

  it("falls back from simple html and preserves links and image metadata", () => {
    const normalized = cleanCapturedArticleBundle({
      version: "captured-article-bundle-v1",
      captureId: "capture-inline",
      sourceName: "Test Source",
      provider: "test",
      sourceUrl: "https://mp.weixin.qq.com/s/test",
      canonicalUrl: "https://mp.weixin.qq.com/s/test",
      finalUrl: "https://mp.weixin.qq.com/s/test",
      title: "测试活动报名",
      publishedAt: "2026-06-10T00:00:00.000Z",
      capturedAt: "2026-06-10T00:01:00.000Z",
      html: "<article><h1>测试活动报名</h1><p>6月20日 19:00 在北京文化中心举办。</p><p>扫码报名。</p></article>",
      images: [{
        id: "poster",
        path: "assets/poster.jpg",
        sourceUrl: "https://cdn.example/poster.jpg",
        role: "poster",
        width: 800,
        height: 1200,
      }],
      links: [{ url: "https://example.com/register", text: "报名链接" }],
      miniPrograms: [{ appId: "wx-test", path: "pages/register", actionType: "mini_program" }],
    });

    expect(normalized.markdown).toContain("测试活动报名");
    expect(normalized.markdown).toContain("扫码报名");
    expect(normalized.links).toEqual([
      expect.objectContaining({ url: "https://example.com/register", text: "报名链接" }),
    ]);
    expect(normalized.images).toEqual([
      expect.objectContaining({ id: "poster", role: "poster", width: 800, height: 1200 }),
    ]);
    expect(normalized.contentStats).toMatchObject({
      imageCount: 1,
      linkCount: 1,
      miniProgramCount: 1,
    });
  });

  it("extracts nested js_content without dropping later paragraphs", () => {
    const normalized = cleanCapturedArticleBundle({
      title: "嵌套正文活动",
      sourceName: "Test Source",
      sourceUrl: "https://mp.weixin.qq.com/s/nested",
      publishedAt: "2026-06-10T00:00:00.000Z",
      html: [
        "<html><body>",
        "<div id=\"js_content\">",
        "<div><p>活动介绍</p></div>",
        "<div><p>6月20日 19:00</p><p>扫码报名</p></div>",
        "</div>",
        "<div>分享噪声</div>",
        "</body></html>",
      ].join(""),
      links: [],
      images: [],
      miniPrograms: [],
    });

    expect(normalized.markdown).toContain("活动介绍");
    expect(normalized.markdown).toContain("6月20日 19:00");
    expect(normalized.markdown).toContain("扫码报名");
    expect(normalized.markdown).not.toContain("分享噪声");
  });
});

async function readCorpusBundle(caseId) {
  const filePath = path.resolve("tests/regression-corpus", caseId, "captured-bundle.json");
  return JSON.parse(await readFile(filePath, "utf8"));
}
