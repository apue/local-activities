/// <reference lib="deno.ns" />

import {
  createMockProvider,
  createOpenAiCompatibleProvider,
} from "./provider.ts";
import { authenticateCollector, parseAnalyzeRequest } from "./request.ts";
import {
  createSupabaseDatabaseWriter,
  createSupabaseStorageReader,
} from "./db.ts";
import {
  readAnalysisTimeoutMs,
  readAnalysisTokenPricing,
  readBooleanEnv,
  readNumberEnv,
  readRequiredEnv,
  readServiceRoleKey,
} from "./env.ts";
import { runAnalysisPipeline } from "./pipeline.ts";

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  if (
    !authenticateCollector(request, {
      collectorEdgeToken: Deno.env.get("COLLECTOR_EDGE_TOKEN"),
    })
  ) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    const payload = await parseAnalyzeRequest(request);
    const supabaseUrl = readRequiredEnv("SUPABASE_URL");
    const serviceRoleKey = readServiceRoleKey();
    const provider = createProviderFromEnv();
    const result = await runAnalysisPipeline({
      request: payload,
      storage: createSupabaseStorageReader({
        url: supabaseUrl,
        serviceRoleKey,
      }),
      db: createSupabaseDatabaseWriter({ url: supabaseUrl, serviceRoleKey }),
      provider,
      env: { provider: provider.name, model: provider.model },
    });
    return json(
      { ok: result.status !== "failed", ...result },
      result.status === "failed" ? 500 : 200,
    );
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : String(error),
    }, 400);
  }
});

function createProviderFromEnv() {
  if (Deno.env.get("ANALYSIS_LLM_PROVIDER") === "mock") {
    return createMockProvider({
      output: {
        decision: "needs_info",
        reason:
          "Mock provider requires fixture injection for meaningful output",
        confidence: 0.1,
        events: [],
        dedupe: { decision: "insufficient_info", confidence: 0.1 },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      },
    });
  }
  return createOpenAiCompatibleProvider({
    baseUrl: readRequiredEnv("ANALYSIS_LLM_BASE_URL"),
    apiKey: readRequiredEnv("ANALYSIS_LLM_API_KEY"),
    model: readRequiredEnv("ANALYSIS_LLM_MODEL"),
    maxOutputTokens: readNumberEnv("ANALYSIS_LLM_MAX_OUTPUT_TOKENS"),
    enableThinking: readBooleanEnv("ANALYSIS_LLM_ENABLE_THINKING"),
    tokenPricing: readAnalysisTokenPricing(),
    timeoutMs: readAnalysisTimeoutMs(),
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
