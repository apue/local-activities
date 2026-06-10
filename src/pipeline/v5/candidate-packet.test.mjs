import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildCandidatePacket } from "./candidate-packet.mjs";
import { cleanCapturedArticleBundle } from "./content-cleaner.mjs";
import { scoreNormalizedContent } from "./signal-scorer.mjs";

describe("V5 candidate packet builder", () => {
  it("builds a high-information packet with signals, mini programs, and registration context", async () => {
    const normalized = cleanCapturedArticleBundle(
      await readCorpusBundle("beiping-beer-festival-guide"),
    );
    const signalScore = scoreNormalizedContent(normalized);

    const packet = buildCandidatePacket({ normalized, signalScore });

    expect(packet.version).toBe("v5-candidate-packet.v1");
    expect(packet.includedSections).toEqual(
      expect.arrayContaining(["metadata", "first_paragraphs", "signals", "signal_windows", "mini_programs"]),
    );
    expect(packet.sourceSignalIds.length).toBeGreaterThan(0);
    expect(packet.packetText).toContain("北平机器友谊万岁精酿啤酒节");
    expect(packet.packetText).toContain("Registration action: mini_program");
    expect(packet.packetText).toContain("wx4d1258677af59f5c");
    expect(packet.estimatedTokens).toBeGreaterThan(0);
  });

  it("includes links, images, and tail text when available", () => {
    const normalized = cleanCapturedArticleBundle({
      title: "测试展览预约",
      sourceName: "Test Source",
      sourceUrl: "https://mp.weixin.qq.com/s/test",
      publishedAt: "2026-06-10T00:00:00.000Z",
      text: [
        "测试展览预约",
        "6月20日 19:00 在北京文化中心举办。",
        "请点击报名链接或查看海报二维码。",
        "尾部联系方式：contact@example.com",
      ].join("\n"),
      links: [{ url: "https://example.com/register", text: "报名链接" }],
      images: [{ id: "poster", role: "poster", sourceUrl: "https://cdn.example/poster.jpg" }],
      miniPrograms: [],
    });
    const signalScore = scoreNormalizedContent(normalized);

    const packet = buildCandidatePacket({ normalized, signalScore });

    expect(packet.includedSections).toEqual(expect.arrayContaining(["links", "images", "tail"]));
    expect(packet.packetText).toContain("https://example.com/register");
    expect(packet.packetText).toContain("poster");
    expect(packet.packetText).toContain("contact@example.com");
  });

  it("enforces the max character bound deterministically", () => {
    const normalized = cleanCapturedArticleBundle({
      title: "超长活动",
      sourceName: "Test Source",
      sourceUrl: "https://mp.weixin.qq.com/s/long",
      publishedAt: "2026-06-10T00:00:00.000Z",
      text: `6月20日 19:00 北京文化中心 报名 ${"活动介绍 ".repeat(2000)}`,
      links: [],
      images: [],
      miniPrograms: [],
    });
    const signalScore = scoreNormalizedContent(normalized);

    const packet = buildCandidatePacket({ normalized, signalScore, maxChars: 900 });

    expect(packet.packetText.length).toBeLessThanOrEqual(900);
    expect(packet.packetText).toContain("[truncated]");
  });

  it("does not claim sections that are fully dropped by truncation", () => {
    const normalized = cleanCapturedArticleBundle({
      title: "超长活动",
      sourceName: "Test Source",
      sourceUrl: "https://mp.weixin.qq.com/s/long",
      publishedAt: "2026-06-10T00:00:00.000Z",
      text: `6月20日 19:00 北京文化中心 报名 ${"活动介绍 ".repeat(2000)}`,
      links: [{ url: "https://example.com/register", text: "报名链接" }],
      images: [{ id: "poster", sourceUrl: "https://cdn.example/poster.jpg" }],
      miniPrograms: [{ appId: "wx-test", path: "pages/register" }],
    });
    const signalScore = scoreNormalizedContent(normalized);

    const packet = buildCandidatePacket({ normalized, signalScore, maxChars: 260 });

    expect(packet.packetText.length).toBeLessThanOrEqual(260);
    expect(packet.packetText).toContain("[truncated]");
    for (const section of ["links", "mini_programs", "images", "tail"]) {
      if (packet.includedSections.includes(section)) {
        const marker = {
          links: "## Links",
          mini_programs: "## Mini Programs",
          images: "## Images",
          tail: "## Tail",
        }[section];
        expect(packet.packetText).toContain(marker);
      }
    }
    expect(packet.droppedSections).toEqual(
      expect.arrayContaining(["links", "mini_programs", "images", "tail"]),
    );
  });

  it("does not treat marker-shaped article text as an included dropped section", () => {
    const normalized = cleanCapturedArticleBundle({
      title: "Marker collision",
      sourceName: "Test Source",
      sourceUrl: "https://mp.weixin.qq.com/s/marker",
      publishedAt: "2026-06-10T00:00:00.000Z",
      text: [
        "正文里故意出现 section marker。",
        "## Tail",
        "6月20日 19:00 北京文化中心 报名",
        "后续内容 ".repeat(500),
      ].join("\n"),
      links: [{ url: "https://example.com/register", text: "报名链接" }],
      images: [],
      miniPrograms: [],
    });
    const signalScore = scoreNormalizedContent(normalized);

    const packet = buildCandidatePacket({ normalized, signalScore, maxChars: 320 });

    expect(packet.packetText).toContain("## Tail");
    expect(packet.droppedSections).toContain("tail");
    expect(packet.includedSections).not.toContain("tail");
  });
});

async function readCorpusBundle(caseId) {
  const filePath = path.resolve("tests/regression-corpus", caseId, "captured-bundle.json");
  return JSON.parse(await readFile(filePath, "utf8"));
}
