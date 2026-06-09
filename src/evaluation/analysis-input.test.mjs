import { describe, expect, it } from "vitest";

import {
  analysisInputToLiveProviderParts,
  buildEvaluationAnalysisInput,
} from "./analysis-input.mjs";

describe("evaluation analysis input", () => {
  it("separates raw image references from provider-consumable assets", () => {
    const input = buildEvaluationAnalysisInput({
      caseItem: {
        case: { id: "asset-separation", labels: [] },
        expected: { action: "exclude", eventCount: 0, evidence: {} },
      },
      bundle: {
        sourceUrl: "https://mp.weixin.qq.com/s/article",
        provider: "local_fixture",
        text: "Article text",
        html: "<article><img src=\"https://upstream.example/poster.jpg\"></article>",
        links: [],
        diagnostics: [],
        images: [{
          id: "raw-reference",
          sourceUrl: "https://upstream.example/poster.jpg",
          role: "poster",
        }, {
          id: "resolved-asset",
          sourceUrl: "https://upstream.example/resolved.jpg",
          publicUrl: "https://cdn.example/resolved.jpg",
          role: "poster",
        }, {
          id: "inline-asset",
          sourceUrl: "https://upstream.example/inline.jpg",
          dataUrl: "data:image/png;base64,aGVsbG8=",
          role: "registration_qr",
        }],
      },
    });

    expect(input.images).toMatchObject([
      {
        imageId: "raw-reference",
        metadata: { sourceUrl: "https://upstream.example/poster.jpg" },
      },
      {
        imageId: "resolved-asset",
        metadata: { sourceUrl: "https://upstream.example/resolved.jpg" },
        asset: { kind: "public_url", url: "https://cdn.example/resolved.jpg" },
      },
      {
        imageId: "inline-asset",
        metadata: { sourceUrl: "https://upstream.example/inline.jpg" },
        asset: { kind: "data_url", url: "data:image/png;base64,aGVsbG8=" },
      },
    ]);

    const imageUrls = analysisInputToLiveProviderParts(input)
      .filter((part) => part.type === "image_url")
      .map((part) => part.imageUrl);
    expect(imageUrls).toEqual([
      "https://cdn.example/resolved.jpg",
      "data:image/png;base64,aGVsbG8=",
    ]);
  });
});
