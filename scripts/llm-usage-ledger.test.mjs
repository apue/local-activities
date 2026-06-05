import { describe, expect, it } from "vitest";

import {
  buildLlmUsageEnvelope,
  normalizeProviderUsage,
  normalizeUsageEnvironment,
  readProductionSeedUsageEnvironment,
  readUsageEnvironment,
} from "./llm-usage-ledger.mjs";

describe("LLM usage ledger", () => {
  it("normalizes provider token fields from common OpenAI-compatible shapes", () => {
    expect(
      normalizeProviderUsage({
        prompt_tokens: 100,
        completion_tokens: 25,
        prompt_tokens_details: { cached_tokens: 10 },
        completion_tokens_details: { reasoning_tokens: 5 },
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 25,
      totalTokens: 125,
      cachedInputTokens: 10,
      reasoningOutputTokens: 5,
    });
  });

  it("builds chargeable usage metadata with stable environment and batch labels", () => {
    const envelope = buildLlmUsageEnvelope({
      collectorId: "collector-local",
      runId: "run-1",
      observedAt: "2026-06-05T03:00:00.000Z",
      operation: "event_extraction",
      provider: "Bailian",
      model: "qwen3-vl-plus",
      status: "succeeded",
      usage: { input_tokens: 1000, output_tokens: 200 },
      latencyMs: 1234,
      metadata: {
        workload: "event_extraction",
        environment: "production collector",
        batchLabel: "wechat2rss daily",
        schemaVersion: "event-extraction-v2-schema-v1",
      },
      usageIdParts: ["https://mp.weixin.qq.com/s/example", "1"],
    });

    expect(envelope.payload).toMatchObject({
      operation: "event_extraction",
      provider: "Bailian",
      model: "qwen3-vl-plus",
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
      metadata: {
        workload: "event_extraction",
        environment: "production_collector",
        batchLabel: "wechat2rss daily",
        usageSource: "provider_usage",
        pricingSource: "known_model_pricing",
        schemaVersion: "event-extraction-v2-schema-v1",
      },
    });
    expect(envelope.payload.usageId).toMatch(/^usage-/);
  });

  it("labels eval and production seed usage separately from production collector usage", () => {
    expect(readUsageEnvironment({ USAGE_ENVIRONMENT: "production_collector" }))
      .toBe("production_collector");
    expect(readUsageEnvironment({ VERCEL_ENV: "preview" })).toBe("preview");
    expect(readProductionSeedUsageEnvironment({})).toBe(
      "production_seed_acceptance",
    );
    expect(
      readProductionSeedUsageEnvironment({
        PRODUCTION_SEED_USAGE_ENVIRONMENT: "prod seed / public acceptance",
      }),
    ).toBe("prod_seed___public_acceptance");
  });

  it("sanitizes environment labels for admin grouping", () => {
    expect(normalizeUsageEnvironment("eval:model benchmark")).toBe(
      "eval:model_benchmark",
    );
    expect(normalizeUsageEnvironment("")).toBe("local");
  });
});
