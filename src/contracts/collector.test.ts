import { describe, expect, it } from "vitest";

import {
  captureModeSchema,
  collectorEnvelopeSchema,
  collectorFailureSchema,
  evidenceAssetSchema,
  failureReasonSchema,
  sourceCandidateSchema,
} from "./collector";

describe("capture contracts", () => {
  it("wraps source candidates in versioned capture envelopes", () => {
    const result = collectorEnvelopeSchema(sourceCandidateSchema).parse({
      collectorId: "home-capture-worker",
      runId: "run-source-discovery",
      observedAt: "2026-05-28T07:00:00.000Z",
      payloadVersion: "2026-05-collector-v1",
      payload: {
        sourceKey: "wechat:italian-cultural-institute-beijing",
        name: "意大利驻华使馆文化处",
        homepageUrl: "https://mp.weixin.qq.com/s/example-profile",
        seedUrl: "https://mp.weixin.qq.com/s/example",
        platform: "wechat_official_account",
        confidence: 0.82,
        diagnostics: [
          { key: "source_name_evidence", value: "article author name" },
        ],
      },
    });

    expect(result.payload.platform).toBe("wechat_official_account");
    expect(result.payload.sourceKey).toBe(
      "wechat:italian-cultural-institute-beijing",
    );
  });

  it("rejects unknown capture payload versions", () => {
    expect(() =>
      collectorEnvelopeSchema(evidenceAssetSchema).parse({
        collectorId: "home-capture-worker",
        runId: "run-1",
        observedAt: "2026-05-28T07:00:00.000Z",
        payloadVersion: "older-version",
        payload: {
          assetId: "asset-1",
          articleUrl: "https://example.com/a",
          role: "poster",
          mediaType: "image",
          contentHash: "hash-1",
        },
      }),
    ).toThrow();
  });

  it("keeps capture modes aligned with documented page modes", () => {
    expect(captureModeSchema.options).toEqual([
      "text_complete",
      "text_with_qr_registration",
      "image_dominant",
      "image_with_qr_registration",
      "not_activity",
      "unsupported",
    ]);
  });

  it("accepts structured capture and analysis failures", () => {
    expect(failureReasonSchema.parse("analysis_response_invalid_schema")).toBe(
      "analysis_response_invalid_schema",
    );
    expect(
      collectorFailureSchema.parse({
        articleUrl: "https://mp.weixin.qq.com/s/bad-analysis",
        stage: "analysis",
        reason: "analysis_response_invalid_schema",
        message: "Analysis response did not match schema.",
        retryable: true,
      }),
    ).toMatchObject({
      stage: "analysis",
      reason: "analysis_response_invalid_schema",
    });
  });
});
