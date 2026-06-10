import { describe, expect, it, vi } from "vitest";

import {
  createLiveModelBudgetGuard,
  createOpenAICompatibleChatProvider,
  LiveModelProviderError,
} from "./model-provider.mjs";

describe("V5 OpenAI-compatible model provider", () => {
  it("parses JSON from chat completion content and records usage metadata", async () => {
    const fetchImpl = vi.fn(async () => responseJson({
      choices: [
        {
          message: {
            content: "```json\n{\"decision\":\"event\",\"confidence\":0.82}\n```",
          },
        },
      ],
      usage: {
        prompt_tokens: 11,
        completion_tokens: 7,
        total_tokens: 18,
        cost_micro_cny: 230,
      },
    }));
    const provider = createOpenAICompatibleChatProvider({
      provider: "example-gateway",
      model: "extractor-1",
      baseUrl: "https://llm.example/v1",
      apiKey: "test-key",
      fetchImpl,
      defaultHeaders: { "x-test": "yes" },
    });

    const result = await provider.completeJson({
      messages: [{ role: "user", content: "extract" }],
      temperature: 0,
      responseFormat: { type: "json_object" },
      metadata: { promptVersion: "prompt.v1", schemaVersion: "schema.v1" },
    });

    expect(result).toMatchObject({
      json: { decision: "event", confidence: 0.82 },
      provider: "example-gateway",
      model: "extractor-1",
      usage: {
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18,
        costMicroCny: 230,
      },
      raw: expect.any(Object),
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://llm.example/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-key",
          "content-type": "application/json",
          "x-test": "yes",
        }),
      }),
    );
  });

  it("does not fall back to global fetch when fetchImpl is not injected", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() => {
      throw new Error("global fetch should not be called");
    });
    try {
      const provider = createOpenAICompatibleChatProvider({
        provider: "example-gateway",
        model: "extractor-1",
        baseUrl: "https://llm.example/v1",
        apiKey: "test-key",
      });

      await expect(provider.completeJson({
        messages: [{ role: "user", content: "extract" }],
      })).rejects.toMatchObject({
        code: "model_provider_fetch_impl_required",
        provider: "example-gateway",
        model: "extractor-1",
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns a typed malformed-output error with raw provider shape", async () => {
    const fetchImpl = vi.fn(async () => responseJson({
      choices: [{ message: { content: "{not json" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
    const provider = createOpenAICompatibleChatProvider({
      provider: "example-gateway",
      model: "extractor-1",
      baseUrl: "https://llm.example/v1",
      apiKey: "test-key",
      fetchImpl,
    });

    await expect(provider.completeJson({
      messages: [{ role: "user", content: "extract" }],
    })).rejects.toMatchObject({
      name: "LiveModelProviderError",
      code: "model_provider_malformed_json",
      provider: "example-gateway",
      model: "extractor-1",
      raw: expect.objectContaining({
        choices: expect.any(Array),
      }),
    });
  });

  it("preserves provider error response shape", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 429,
      async json() {
        return { error: { type: "rate_limit", message: "slow down" } };
      },
    }));
    const provider = createOpenAICompatibleChatProvider({
      provider: "example-gateway",
      model: "extractor-1",
      baseUrl: "https://llm.example/v1",
      apiKey: "test-key",
      fetchImpl,
    });

    await expect(provider.completeJson({
      messages: [{ role: "user", content: "extract" }],
    })).rejects.toMatchObject({
      code: "model_provider_http_error",
      status: 429,
      raw: { error: { type: "rate_limit", message: "slow down" } },
    });
  });

  it("preserves non-JSON provider error text when JSON parsing fails", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 502,
      async json() {
        throw new Error("not json");
      },
      async text() {
        return "bad gateway";
      },
    }));
    const provider = createOpenAICompatibleChatProvider({
      provider: "example-gateway",
      model: "extractor-1",
      baseUrl: "https://llm.example/v1",
      apiKey: "test-key",
      fetchImpl,
    });

    await expect(provider.completeJson({
      messages: [{ role: "user", content: "extract" }],
    })).rejects.toMatchObject({
      code: "model_provider_http_error",
      status: 502,
      raw: { text: "bad gateway" },
    });
  });

  it("tracks positive live model budget in micro-CNY and refuses over-budget spend", () => {
    expect(() => createLiveModelBudgetGuard()).toThrow("live_model_budget_required");
    expect(() => createLiveModelBudgetGuard({ maxCostMicroCny: 0 })).toThrow("live_model_budget_required");
    expect(() => createLiveModelBudgetGuard({ maxCostCny: 0 })).toThrow("live_model_budget_required");

    const guard = createLiveModelBudgetGuard({ maxCostCny: 0.00001 });
    expect(guard.snapshot()).toMatchObject({
      maxCostMicroCny: 10,
      spentCostMicroCny: 0,
      remainingCostMicroCny: 10,
    });
    expect(guard.recordUsage({ costMicroCny: 4 })).toMatchObject({
      spentCostMicroCny: 4,
      remainingCostMicroCny: 6,
    });
    expect(() => guard.recordUsage({ costMicroCny: 7 })).toThrow("live_model_budget_exceeded");
  });
});

function responseJson(value) {
  return {
    ok: true,
    status: 200,
    async json() {
      return value;
    },
  };
}

expect(LiveModelProviderError).toBeDefined();
