import { describe, expect, it } from "vitest";

import {
  buildVisionEvalRequest,
  buildVisionEvalArticleFromHtml,
  defaultVisionEvalModels,
  evaluateVisionCaseResult,
  estimateVisionEvalCostCny,
  formatVisionEvalMarkdownReport,
  normalizeVisionEvalCaseFile,
  parseModelJson,
  parseVisionEvalArgs,
  scoreVisionEvalOutput,
  summarizeVisionCaseMetrics,
  selectArticleImages,
} from "./siliconflow-vision-eval.mjs";

describe("parseVisionEvalArgs", () => {
  it("parses repeated env files and bounded defaults", () => {
    const args = parseVisionEvalArgs([
      "--",
      "--env-file",
      ".env.local",
      "--env-file",
      ".env.collector",
      "--sample-size",
      "4",
      "--max-images",
      "3",
      "--detail",
      "high",
      "--max-output-tokens",
      "4096",
      "--timeout-ms",
      "45000",
      "--case-file",
      "tests/eval/vision-cases.json",
      "--live",
    ]);

    expect(args.envFiles).toEqual([".env.local", ".env.collector"]);
    expect(args.articleUrls).toEqual([]);
    expect(args.sampleSize).toBe(4);
    expect(args.maxImages).toBe(3);
    expect(args.detail).toBe("high");
    expect(args.maxOutputTokens).toBe(4096);
    expect(args.timeoutMs).toBe(45000);
    expect(args.caseFile).toBe("tests/eval/vision-cases.json");
    expect(args.live).toBe(true);
    expect(args.models).toEqual(defaultVisionEvalModels.map((model) => model.id));
  });

  it("accepts explicit comma-separated models", () => {
    const args = parseVisionEvalArgs([
      "--models",
      "Qwen/Qwen3-VL-8B-Instruct,zai-org/GLM-4.5V",
    ]);

    expect(args.models).toEqual([
      "Qwen/Qwen3-VL-8B-Instruct",
      "zai-org/GLM-4.5V",
    ]);
  });

  it("allows full persistent case-file runs", () => {
    const args = parseVisionEvalArgs(["--sample-size", "29"]);

    expect(args.sampleSize).toBe(29);
  });

  it("parses explicit article URLs for direct page evaluation", () => {
    const args = parseVisionEvalArgs([
      "--article-url",
      "https://mp.weixin.qq.com/s/example",
    ]);

    expect(args.articleUrls).toEqual(["https://mp.weixin.qq.com/s/example"]);
  });
});

describe("buildVisionEvalArticleFromHtml", () => {
  it("extracts stable article metadata and visible text", () => {
    const article = buildVisionEvalArticleFromHtml({
      url: "https://mp.weixin.qq.com/s/example",
      html: `
        <html>
          <head>
            <meta property="og:title" content="活动标题" />
            <meta property="og:description" content="活动摘要" />
            <meta property="og:article:author" content="文化中心" />
            <meta property="article:published_time" content="2026-06-01T10:00:00+08:00" />
          </head>
          <body><script>ignore()</script><h1>活动标题</h1><p>地点：798</p></body>
        </html>`,
    });

    expect(article.title).toBe("活动标题");
    expect(article.sourceName).toBe("文化中心");
    expect(article.summary).toBe("活动摘要");
    expect(article.publishedAt).toBe("2026-06-01T10:00:00+08:00");
    expect(article.contentText).toContain("地点：798");
    expect(article.contentText).not.toContain("ignore()");
  });
});

describe("vision eval cases", () => {
  it("normalizes labeled case files", () => {
    const cases = normalizeVisionEvalCaseFile({
      cases: [
        {
          id: "negative-news",
          source: {
            type: "supabase_snapshot",
            snapshotId: 87,
          },
          tags: ["negative"],
          label: {
            expectedAction: "exclude",
            triageDecision: "non_public_news",
            publicEligibility: "not_public",
            expectedEventCount: 0,
          },
          rationale: "News, not an event.",
        },
      ],
    });

    expect(cases).toEqual([
      {
        id: "negative-news",
        title: "",
        source: {
          type: "supabase_snapshot",
          snapshotId: 87,
          articleUrl: "",
        },
        tags: ["negative"],
        label: {
          expectedAction: "exclude",
          triageDecision: "non_public_news",
          publicEligibility: "not_public",
          expectedEventCount: 0,
          requiresReservation: false,
          expectsQrEvidence: false,
        },
        rationale: "News, not an event.",
      },
    ]);
  });

  it("calculates action, false-positive, event-count, and QR metrics", () => {
    const positiveCase = normalizeVisionEvalCaseFile([
      {
        id: "positive-qr",
        source: {
          type: "live_url",
          url: "https://mp.weixin.qq.com/s/example",
        },
        label: {
          expectedAction: "extract",
          publicEligibility: "public",
          expectedEventCount: 1,
          requiresReservation: true,
          expectsQrEvidence: true,
        },
      },
    ])[0];
    const negativeCase = normalizeVisionEvalCaseFile([
      {
        id: "negative-news",
        source: {
          type: "supabase_snapshot",
          snapshotId: 35,
        },
        label: {
          expectedAction: "exclude",
          publicEligibility: "not_public",
          expectedEventCount: 0,
        },
      },
    ])[0];

    const positiveResult = evaluateVisionCaseResult({
      visionCase: positiveCase,
      parsed: {
        classification: {
          kind: "activity",
          publicEligibility: "public",
        },
        events: [
          {
            qrEvidence: "yes",
            reservationStatus: "required",
          },
        ],
      },
    });
    const falsePositive = evaluateVisionCaseResult({
      visionCase: negativeCase,
      parsed: {
        classification: {
          kind: "activity",
          publicEligibility: "public",
        },
        events: [{}],
      },
    });

    expect(positiveResult).toMatchObject({
      predictedAction: "extract",
      actionMatch: true,
      eventCountMatch: true,
      qrMatch: true,
      reservationMatch: true,
      falseNegative: false,
      falsePositive: false,
    });
    expect(falsePositive).toMatchObject({
      predictedAction: "extract",
      actionMatch: false,
      falsePositive: true,
    });
    expect(summarizeVisionCaseMetrics([positiveResult, falsePositive])).toEqual({
      caseCount: 2,
      actionAccuracy: 0.5,
      falsePositiveCount: 1,
      falseNegativeCount: 0,
      publicEligibilityAccuracy: 0.5,
      eventCountAccuracy: 0.5,
      qrRecall: 1,
      reservationRecall: 1,
    });
  });
});

describe("selectArticleImages", () => {
  it("ranks likely visual evidence before ordinary article images", () => {
    const selected = selectArticleImages(
      [
        {
          url: "https://mp.weixin.qq.com/s/').concat(r,'",
          source: "css_background",
        },
        {
          url: "https://example.com/body.jpg",
          width: 320,
          height: 180,
          source: "html_img",
        },
        {
          url: "https://example.com/signup-qr.jpg",
          alt: "报名二维码",
          width: 260,
          height: 260,
          source: "html_img",
        },
        {
          url: "https://example.com/event-poster.jpg",
          alt: "活动海报",
          width: 900,
          height: 1200,
          source: "html_img",
        },
      ],
      { maxImages: 2 },
    );

    expect(selected.map((image) => image.role)).toEqual(["qr", "poster"]);
  });

  it("preserves evidence roles loaded from Supabase assets", () => {
    const selected = selectArticleImages(
      [
        {
          url: "https://example.com/follow-account.png",
          role: "qr",
          source: "supabase_evidence_asset",
        },
        {
          url: "https://example.com/plain.jpg",
          role: "article_image",
          source: "supabase_evidence_asset",
        },
      ],
      { maxImages: 1 },
    );

    expect(selected).toEqual([
      {
        url: "https://example.com/follow-account.png",
        role: "qr",
        source: "supabase_evidence_asset",
      },
    ]);
  });
});

describe("buildVisionEvalRequest", () => {
  it("builds an OpenAI-compatible multimodal chat request", () => {
    const request = buildVisionEvalRequest({
      model: "Qwen/Qwen3-VL-8B-Instruct",
      article: {
        title: "展览 | Sonic Other__lands",
        sourceName: "Example Center",
        publishedAt: "2026-06-01T10:00:00.000Z",
        url: "https://mp.weixin.qq.com/s/example",
        summary: "长期展览",
        contentText: "展期：6月1日-7月30日，每天10:00-19:00。地点：798。",
      },
      images: [
        {
          url: "https://example.com/poster.jpg",
          role: "poster",
          dataUrl: "data:image/jpeg;base64,AAAA",
        },
      ],
      detail: "low",
    });

    expect(request.model).toBe("Qwen/Qwen3-VL-8B-Instruct");
    expect(request.response_format).toEqual({ type: "json_object" });
    expect(request.messages[1].content[0].type).toBe("text");
    expect(request.messages[1].content[1]).toEqual({
      type: "image_url",
      image_url: {
        url: "data:image/jpeg;base64,AAAA",
        detail: "low",
      },
    });
  });
});

describe("parseModelJson", () => {
  it("parses fenced JSON", () => {
    expect(parseModelJson("```json\n{\"classification\":{\"kind\":\"activity\"}}\n```"))
      .toEqual({ classification: { kind: "activity" } });
  });
});

describe("estimateVisionEvalCostCny", () => {
  it("uses model-specific input and output token pricing", () => {
    const cost = estimateVisionEvalCostCny({
      model: "Qwen/Qwen3-VL-8B-Instruct",
      usage: {
        prompt_tokens: 1_000_000,
        completion_tokens: 500_000,
      },
    });

    expect(cost.costCny).toBeCloseTo(1.5, 6);
    expect(cost.source).toBe("provider_usage");
  });
});

describe("scoreVisionEvalOutput", () => {
  it("rewards valid public event extraction with schedule and venue", () => {
    const score = scoreVisionEvalOutput({
      parsed: {
        classification: {
          kind: "activity",
          publicEligibility: "public",
          confidence: 0.91,
        },
        events: [
          {
            title: "周末电影放映",
            eventKind: "single",
            scheduleText: "6月8日 19:00",
            venueName: "文化中心",
            reservationStatus: "required",
            posterEvidence: "yes",
            qrEvidence: "yes",
            confidence: 0.88,
          },
        ],
      },
      images: [{ role: "poster" }, { role: "qr" }],
    });

    expect(score.score).toBeGreaterThanOrEqual(85);
    expect(score.reasons).toContain("visual_evidence_accounted_for");
  });
});

describe("formatVisionEvalMarkdownReport", () => {
  it("includes model summary rows and recommendation", () => {
    const markdown = formatVisionEvalMarkdownReport({
      generatedAt: "2026-06-03T00:00:00.000Z",
      sampleSize: 1,
      maxImages: 2,
      detail: "low",
      totals: [
        {
          model: "Qwen/Qwen3-VL-8B-Instruct",
          ok: 1,
          failed: 0,
          averageScore: 88,
          totalCostCny: 0.001,
          averageLatencyMs: 1200,
        },
      ],
      labelMetrics: {
        "Qwen/Qwen3-VL-8B-Instruct": {
          caseCount: 2,
          actionAccuracy: 0.5,
          falsePositiveCount: 1,
          falseNegativeCount: 0,
          publicEligibilityAccuracy: 0.5,
          eventCountAccuracy: 0.5,
          qrRecall: 1,
          reservationRecall: 1,
        },
      },
      recommendation: "Qwen/Qwen3-VL-8B-Instruct",
      cases: [],
    });

    expect(markdown).toContain("| Qwen/Qwen3-VL-8B-Instruct | 1 | 0 | 88.0 |");
    expect(markdown).toContain("Recommended model: `Qwen/Qwen3-VL-8B-Instruct`");
    expect(markdown).toContain("| Qwen/Qwen3-VL-8B-Instruct | 2 | 50.0% | 1 | 0 |");
  });
});
