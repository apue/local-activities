import { describe, expect, it } from "vitest";

import {
  buildWechatArticleBundleFromText,
  buildWechatArticleSnapshotFromText,
  formatWechatUrlExtractionSummary,
  parseWechatUrlExtractionArgs,
  readWechatArticlePageWithAgentBrowser,
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
        "--keep-open",
      ]),
    ).toEqual({
      url: "https://mp.weixin.qq.com/s/example",
      envFile: ".env.collector",
      upload: true,
      session: "wechat-test",
      keepOpen: true,
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

  it("reports WeChat verification pages as capture failures before extraction", async () => {
    const calls = [];
    const result = await runWechatUrlExtractionOnce({
      env: { COLLECTOR_ID: "collector-1" },
      url: "https://mp.weixin.qq.com/s/blocked",
      now: new Date("2026-06-03T04:00:00.000Z"),
      readArticlePage: async () => ({
        finalUrl:
          "https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha?poc_token=token",
        text: "var PAGE_MID='mmbizwap:secitptpage/verify.html';",
        html: "<body>verify</body>",
      }),
      extract: async (input) => {
        calls.push(input);
        throw new Error("extractor_should_not_run");
      },
    });

    expect(calls).toHaveLength(0);
    expect(result.extraction.kind).toBe("failed");
    expect(result.draftSummaries).toEqual([]);
    expect(result.failureSummaries).toEqual([
      expect.objectContaining({
        articleUrl: "https://mp.weixin.qq.com/s/blocked",
        reason: "captcha_required",
        stage: "page_fetch",
        retryable: true,
      }),
    ]);
    expect(formatWechatUrlExtractionSummary(result)).toContain("failures=1");
  });

  it("maps typed page read failures without running extraction", async () => {
    const calls = [];
    const result = await runWechatUrlExtractionOnce({
      env: { COLLECTOR_ID: "collector-1" },
      url: "https://mp.weixin.qq.com/s/login",
      now: new Date("2026-06-03T04:00:00.000Z"),
      readArticlePage: async () => {
        throw Object.assign(new Error("agent_browser_failed:401"), {
          reason: "login_required",
          stage: "page_fetch",
          retryable: true,
          diagnostics: [{ key: "status", value: "401" }],
        });
      },
      extract: async (input) => {
        calls.push(input);
        throw new Error("extractor_should_not_run");
      },
    });

    expect(calls).toHaveLength(0);
    expect(result.captureResult).toMatchObject({
      ok: false,
      failure: {
        reason: "login_required",
        stage: "page_fetch",
        sourceUrl: "https://mp.weixin.qq.com/s/login",
        retryable: true,
      },
    });
    expect(result.failureSummaries).toEqual([
      expect.objectContaining({
        reason: "login_required",
        diagnostics: [{ key: "status", value: "401" }],
      }),
    ]);
  });

  it("passes URL browser HTML image evidence into the extractor", async () => {
    const calls = [];
    const result = await runWechatUrlExtractionOnce({
      env: { COLLECTOR_ID: "collector-1" },
      url: "https://mp.weixin.qq.com/s/image-page",
      now: new Date("2026-06-03T04:00:00.000Z"),
      readArticlePage: async () => ({
        text: "Poster event\nEmbassy Culture\n2026年6月1日 21:44 北京\n扫码报名",
        html: `
          <img data-src="https://mmbiz.qpic.cn/poster.jpg" alt="活动海报" width="900" height="1200" />
          <img data-src="https://mmbiz.qpic.cn/register-qr.jpg" alt="报名二维码" />
        `,
      }),
      extract: async (input) => {
        calls.push(input);
        return {
          kind: "drafts",
          runId: input.runId,
          failures: [],
          eventDrafts: [],
        };
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].articleSnapshot.captureMode).toBe(
      "image_with_qr_registration",
    );
    expect(calls[0].evidenceAssets.map((asset) => asset.role)).toEqual([
      "poster",
      "qr",
    ]);
    expect(result.articleBundle.images.map((image) => image.role)).toEqual([
      "poster",
      "qr",
    ]);
  });

  it("reads WeChat pages through DOM eval and closes the agent-browser session by default", async () => {
    const commands = [];
    const page = await readWechatArticlePageWithAgentBrowser({
      url: "https://mp.weixin.qq.com/s/dom-eval",
      session: "wechat-dom-test",
      execAgentBrowser: async (args) => {
        commands.push(args);
        const command = args.includes("eval") ? "eval" : args.at(-1);
        if (command === "eval") {
          return {
            data: {
              result: {
                finalUrl: "https://mp.weixin.qq.com/s/dom-eval-final",
                canonicalUrl: "https://mp.weixin.qq.com/s/dom-eval-canonical",
                title: "DOM event",
                authorName: "DOM Source",
                publishedAt: "2026-06-01T13:44:00.000Z",
                text: "DOM event\nDOM Source\n扫码报名",
                html: "<body><img data-src=\"https://mmbiz.qpic.cn/dom-poster.jpg\" alt=\"活动海报\" /></body>",
                links: [{ url: "https://example.com/register", text: "Register" }],
                miniPrograms: [{ appId: "wx-dom", path: "pages/register" }],
                diagnostics: [{ key: "dom_eval", value: "ok" }],
                captureWarnings: [{ code: "html_body_get_skipped", message: "Used DOM eval" }],
              },
            },
          };
        }
        return {};
      },
    });

    expect(page).toMatchObject({
      finalUrl: "https://mp.weixin.qq.com/s/dom-eval-final",
      canonicalUrl: "https://mp.weixin.qq.com/s/dom-eval-canonical",
      text: expect.stringContaining("DOM event"),
      html: expect.stringContaining("dom-poster"),
      links: [{ url: "https://example.com/register", text: "Register" }],
      miniPrograms: [{ appId: "wx-dom", path: "pages/register" }],
      diagnostics: [{ key: "dom_eval", value: "ok" }],
    });
    expect(commands).toEqual([
      ["--session", "wechat-dom-test", "open", "https://mp.weixin.qq.com/s/dom-eval"],
      ["--session", "wechat-dom-test", "wait", "--load", "networkidle"],
      [
        "--session",
        "wechat-dom-test",
        "eval",
        expect.stringContaining("document.body"),
        "--json",
      ],
      ["--session", "wechat-dom-test", "close"],
    ]);
  });

  it("keeps the agent-browser session open only when explicitly requested", async () => {
    const commands = [];
    await readWechatArticlePageWithAgentBrowser({
      url: "https://mp.weixin.qq.com/s/keep-open",
      session: "wechat-keep-open-test",
      keepOpen: true,
      execAgentBrowser: async (args) => {
        commands.push(args);
        if (args.includes("eval")) {
          return { data: { result: { text: "Keep open", html: "<body>Keep open</body>" } } };
        }
        return {};
      },
    });

    expect(commands.some((args) => args.at(-1) === "close")).toBe(false);
  });

  it("closes the agent-browser session when page capture throws", async () => {
    const commands = [];

    await expect(
      readWechatArticlePageWithAgentBrowser({
        url: "https://mp.weixin.qq.com/s/browser-error",
        session: "wechat-error-test",
        execAgentBrowser: async (args) => {
          commands.push(args);
          if (args.includes("eval")) {
            throw Object.assign(new Error("cdp connection lost"), {
              reason: "browser_error",
            });
          }
          return {};
        },
      }),
    ).rejects.toMatchObject({
      reason: "browser_error",
      stage: "page_fetch",
      retryable: true,
    });

    expect(commands.at(-1)).toEqual(["--session", "wechat-error-test", "close"]);
  });

  it("stores URL browser image evidence before extraction when enabled", async () => {
    const calls = [];
    await runWechatUrlExtractionOnce({
      env: { COLLECTOR_ID: "collector-1" },
      url: "https://mp.weixin.qq.com/s/image-page",
      now: new Date("2026-06-03T04:00:00.000Z"),
      storeImages: true,
      readArticlePage: async () => ({
        text: "Poster event\nEmbassy Culture\n2026年6月1日 21:44 北京\n扫码报名",
        html: `
          <img data-src="https://mmbiz.qpic.cn/poster.jpg" alt="活动海报" width="900" height="1200" />
        `,
      }),
      fetchImpl: async () => ({
        ok: true,
        headers: new Map([["content-type", "image/jpeg"]]),
        arrayBuffer: async () => Buffer.from("poster-bytes").buffer,
      }),
      putPublicAsset: async ({ keyHint, role, contentType, bytes }) => ({
        url: `https://blob.example/${role}/${keyHint}.jpg`,
        contentType,
        byteLength: bytes.byteLength,
      }),
      extract: async (input) => {
        calls.push(input);
        return {
          kind: "drafts",
          runId: input.runId,
          failures: [],
          eventDrafts: [],
        };
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].evidenceAssets[0]).toMatchObject({
      role: "poster",
      sourceUrl: "https://mmbiz.qpic.cn/poster.jpg",
      storagePath: expect.stringMatching(/^https:\/\/blob\.example\/poster\//),
    });
  });

  it("uploads through pipeline ingest without passing upload to the extractor", async () => {
    const extractCalls = [];
    const ingestCalls = [];
    const result = await runWechatUrlExtractionOnce({
      env: { COLLECTOR_ID: "collector-1" },
      url: "https://mp.weixin.qq.com/s/example",
      upload: true,
      readArticleText: async () => "Title\nOrg\nBody",
      extract: async (input) => {
        extractCalls.push(input);
        return {
          kind: input.upload ? "uploaded" : "drafts",
          runId: input.runId,
          eventDrafts: [
            {
              payload: {
                draftId: "draft-1",
                title: "Title",
                confidence: 0.9,
              },
            },
          ],
          failures: [],
        };
      },
      ingest: async (input) => {
        ingestCalls.push(input);
        return {
          sourceRunId: "source-run-1",
          uploadedArticleSnapshotIds: ["snapshot-1"],
          uploadedEventDraftCount: input.extractionResults[0].eventDrafts.length,
        };
      },
    });

    expect(extractCalls).toHaveLength(1);
    expect(extractCalls[0].upload).toBe(false);
    expect(ingestCalls).toHaveLength(1);
    expect(ingestCalls[0].sourceRun.payload.status).toBe("success");
    expect(ingestCalls[0].articleSnapshots).toHaveLength(1);
    expect(result.pipelineReport.stageStatuses.ingest).toBe("success");
    expect(result.extraction).toMatchObject({
      kind: "drafts",
      sourceRunId: "source-run-1",
      uploadedArticleSnapshotIds: ["snapshot-1"],
      uploadedEventDraftCount: 1,
    });
  });
});