import { describe, expect, it } from "vitest";

import {
  createMemoryLlmCallLedger,
  filterLlmCallLedgerRows,
  normalizeLlmCallLedgerRow,
} from "./llm-call-ledger.mjs";

describe("V5 LLM call ledger contract", () => {
  it("normalizes success rows with call metadata, usage, params, and artifact paths", async () => {
    const ledger = createMemoryLlmCallLedger();

    const row = await ledger.recordCall({
      callId: "call-1",
      pipelineRunId: "pipe-1",
      pipelineStepId: "step-1",
      dataClass: "eval",
      operation: "full_extract",
      provider: "dashscope",
      model: "qwen3-vl-plus",
      promptVersion: "prompt-v1",
      schemaVersion: "schema-v1",
      params: { temperature: 0, responseFormat: { type: "json_object" } },
      status: "succeeded",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costMicroCny: 20, latencyMs: 900 },
      requestArtifactPath: "runs/pipe-1/request.json",
      responseArtifactPath: "runs/pipe-1/response.json",
      sourceId: "source-1",
      sourceUrl: "https://mp.weixin.qq.com/s/example",
      articleBundleId: "bundle-1",
      recordedAt: "2026-06-11T08:00:00.000Z",
    });

    expect(row).toMatchObject({
      callId: "call-1",
      pipelineRunId: "pipe-1",
      pipelineStepId: "step-1",
      dataClass: "eval",
      operation: "full_extract",
      provider: "dashscope",
      model: "qwen3-vl-plus",
      promptVersion: "prompt-v1",
      schemaVersion: "schema-v1",
      params: { temperature: 0, responseFormat: { type: "json_object" } },
      status: "succeeded",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costMicroCny: 20, latencyMs: 900 },
      requestArtifactPath: "runs/pipe-1/request.json",
      responseArtifactPath: "runs/pipe-1/response.json",
      sourceId: "source-1",
      sourceUrl: "https://mp.weixin.qq.com/s/example",
      articleBundleId: "bundle-1",
      recordedAt: "2026-06-11T08:00:00.000Z",
    });
    expect(ledger.rows).toHaveLength(1);
  });

  it("normalizes provider failure rows without throwing away usage or error code", () => {
    expect(normalizeLlmCallLedgerRow({
      callId: "call-http",
      dataClass: "eval",
      operation: "full_extract",
      provider: "dashscope",
      model: "qwen3-vl-plus",
      promptVersion: "prompt-v1",
      schemaVersion: "schema-v1",
      status: "failed",
      errorCode: "model_provider_http_error",
      usage: { inputTokens: 100, outputTokens: 0, totalTokens: 100, latencyMs: 1500 },
    })).toMatchObject({
      callId: "call-http",
      status: "failed",
      errorCode: "model_provider_http_error",
      usage: { inputTokens: 100, outputTokens: 0, totalTokens: 100, costMicroCny: 0, latencyMs: 1500 },
    });

    expect(normalizeLlmCallLedgerRow({
      callId: "call-json",
      dataClass: "eval",
      operation: "full_extract",
      provider: "dashscope",
      model: "qwen3-vl-plus",
      promptVersion: "prompt-v1",
      schemaVersion: "schema-v1",
      status: "failed",
      errorCode: "model_provider_malformed_json",
    })).toMatchObject({
      callId: "call-json",
      status: "failed",
      errorCode: "model_provider_malformed_json",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costMicroCny: 0, latencyMs: 0 },
    });
  });

  it("filters rows by agent audit dimensions", () => {
    const rows = [
      normalizeLlmCallLedgerRow({
        callId: "call-1",
        dataClass: "eval",
        operation: "full_extract",
        provider: "dashscope",
        model: "qwen3-vl-plus",
        status: "failed",
        errorCode: "model_provider_timeout",
        sourceId: "source-1",
        articleBundleId: "bundle-1",
        recordedAt: "2026-06-11T08:00:00.000Z",
      }),
      normalizeLlmCallLedgerRow({
        callId: "call-2",
        dataClass: "production",
        operation: "editor_pass",
        provider: "siliconflow",
        model: "qwen3-vl-plus",
        status: "succeeded",
        sourceId: "source-2",
        articleBundleId: "bundle-2",
        recordedAt: "2026-06-09T08:00:00.000Z",
      }),
    ];

    expect(filterLlmCallLedgerRows(rows, {
      dataClass: "eval",
      provider: "dashscope",
      model: "qwen3-vl-plus",
      operation: "full_extract",
      status: "failed",
      sourceId: "source-1",
      articleBundleId: "bundle-1",
      startsAt: "2026-06-10T00:00:00.000Z",
      endsAt: "2026-06-12T00:00:00.000Z",
    })).toEqual([rows[0]]);
  });
});
