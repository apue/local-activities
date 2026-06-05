import { describe, expect, it } from "vitest";

import {
  buildWechatArticleBundleFromText,
  buildWechatArticleSnapshotFromText,
  formatWechatUrlExtractionSummary,
  parseWechatUrlExtractionArgs,
  runWechatUrlExtractionOnce,
} from "./wechat-url-extract.mjs";

describe("single WeChat URL extractor", () => {
  it("parses required URL, env file, upload, and browser session args", () => {
    expect(
      parseWechatUrlExtractionArgs([
        "--url",
        "https://mp.weixin.qq.com/s/example",
        "--env-file",
        ".env.collector",
        "--upload",
        "--session",
        "wechat-test",
      ]),
    ).toEqual({
      url: "https://mp.weixin.qq.com/s/example",
      envFile: ".env.collector",
      upload: true,
      session: "wechat-test",
      help: false,
    });
  });

  it("builds a normalized article snapshot from browser text", () => {
    const bundle = buildWechatArticleBundleFromText({
      url: "https://mp.weixin.qq.com/s/example",
      text: [
        "六月活动简报 - 文化活动 | Boletin de junio",
        "六月活动简报 - 文化活动 | Boletin de junio",
        "北京塞万提斯学院 西班牙驻华大使馆",
        "2026年6月1日 21:44 北京",
        "白蓝映像：阿根廷短片展 - 第二场放映",
        "6月6日星期六 16:00",
        "北京塞万提斯学院",
      ].join("\n"),
      now: new Date("2026-06-03T04:00:00.000Z"),
    });
    const snapshot = buildWechatArticleSnapshotFromText({
      url: "https://mp.weixin.qq.com/s/example",
      text: [
        "六月活动简报 - 文化活动 | Boletin de junio",
        "六月活动简报 - 文化活动 | Boletin de junio",
        "北京塞万提斯学院 西班牙驻华大使馆",
        "2026年6月1日 21:44 北京",
        "白蓝映像：阿根廷短片展 - 第二场放映",
        "6月6日星期六 16:00",
        "北京塞万提斯学院",
      ].join("\n"),
      now: new Date("2026-06-03T04:00:00.000Z"),
    });

    expect(bundle).toMatchObject({
      version: "captured-article-bundle-v1",
      provider: "url_browser",
      sourceUrl: "https://mp.weixin.qq.com/s/example",
      text: expect.stringContaining("白蓝映像"),
      images: [],
    });
    expect(snapshot).toMatchObject({
      canonicalUrl: "https://mp.weixin.qq.com/s/example",
      finalUrl: "https://mp.weixin.qq.com/s/example",
      title: "六月活动简报 - 文化活动 | Boletin de junio",
      authorName: "北京塞万提斯学院 西班牙驻华大使馆",
      publishedAt: "2026-06-01T13:44:00.000Z",
      capturedAt: "2026-06-03T04:00:00.000Z",
      languageHints: ["zh", "es"],
      captureMode: "text_complete",
      evidenceAssetIds: [],
    });
    expect(snapshot.visibleText).toContain("白蓝映像");
    expect(snapshot.textHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("runs a dry-run extraction with injected page text and extractor", async () => {
    const calls = [];
    const result = await runWechatUrlExtractionOnce({
      env: { COLLECTOR_ID: "collector-1" },
      url: "https://mp.weixin.qq.com/s/example",
      now: new Date("2026-06-03T04:00:00.000Z"),
      readArticleText: async () => "Monthly events\nOrg\n2026年6月1日 21:44 北京\nConcert\n6月6日 16:00",
      extract: async (input) => {
        calls.push(input);
        return {
          kind: "drafts",
          runId: input.runId,
          failures: [],
          eventDrafts: [
            {
              payload: {
                title: "Concert",
                startsAt: "2026-06-06T16:00:00+08:00",
                venueName: "Institute",
                signals: ["possible_duplicate"],
                confidence: 0.9,
              },
            },
          ],
        };
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].upload).toBe(false);
    expect(calls[0].articleSnapshot.title).toBe("Monthly events");
    expect(calls[0].evidenceAssets).toEqual([]);
    expect(result.articleBundle).toMatchObject({
      version: "captured-article-bundle-v1",
      provider: "url_browser",
      sourceUrl: "https://mp.weixin.qq.com/s/example",
    });
    expect(result.draftSummaries).toEqual([
      {
        title: "Concert",
        startsAt: "2026-06-06T16:00:00+08:00",
        endsAt: undefined,
        scheduleText: undefined,
        venueName: "Institute",
        confidence: 0.9,
        signals: ["possible_duplicate"],
      },
    ]);
    expect(formatWechatUrlExtractionSummary(result)).toContain("drafts=1");
  });

  it("passes upload through only when explicitly requested", async () => {
    const result = await runWechatUrlExtractionOnce({
      env: {},
      url: "https://mp.weixin.qq.com/s/example",
      upload: true,
      readArticleText: async () => "Title\nOrg\nBody",
      extract: async (input) => ({
        kind: input.upload ? "uploaded" : "drafts",
        runId: input.runId,
        eventDrafts: [],
        failures: [],
        uploadedEventDraftIds: [],
      }),
    });

    expect(result.extraction.uploadedEventDraftIds).toEqual([]);
  });
});
