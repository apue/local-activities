import { createUsagePlaceholder } from "./contracts.mjs";

export class LiveModelProviderError extends Error {
  constructor({
    code,
    message,
    provider,
    model,
    status,
    raw,
    cause,
  } = {}) {
    super(message ?? code ?? "live_model_provider_error");
    this.name = "LiveModelProviderError";
    this.code = code ?? "live_model_provider_error";
    this.provider = provider;
    this.model = model;
    this.status = status;
    this.raw = raw;
    if (cause) this.cause = cause;
  }
}

export function createOpenAICompatibleChatProvider({
  provider = "openai-compatible",
  model,
  baseUrl,
  apiKey,
  fetchImpl,
  defaultHeaders = {},
  maxTokens,
  extraBody = {},
} = {}) {
  const cleanProvider = clean(provider) ?? "openai-compatible";
  const cleanModel = clean(model) ?? "configured-live-model";
  const endpoint = `${String(baseUrl ?? "").replace(/\/+$/g, "")}/chat/completions`;
  const cleanMaxTokens = positiveInteger(maxTokens);
  const cleanExtraBody = extraBody && typeof extraBody === "object" && !Array.isArray(extraBody)
    ? extraBody
    : {};

  return {
    provider: cleanProvider,
    model: cleanModel,
    async completeJson({
      messages,
      temperature = 0,
      responseFormat,
      metadata = {},
    } = {}) {
      if (typeof fetchImpl !== "function") {
        throw new LiveModelProviderError({
          code: "model_provider_fetch_impl_required",
          provider: cleanProvider,
          model: cleanModel,
        });
      }
      if (!Array.isArray(messages)) {
        throw new LiveModelProviderError({
          code: "model_provider_messages_required",
          provider: cleanProvider,
          model: cleanModel,
        });
      }

      const startedAt = Date.now();
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          ...defaultHeaders,
        },
        body: JSON.stringify({
          ...cleanExtraBody,
          model: cleanModel,
          messages,
          temperature,
          ...(cleanMaxTokens ? { max_tokens: cleanMaxTokens } : {}),
          ...(responseFormat ? { response_format: responseFormat } : {}),
          ...(metadata ? { metadata } : {}),
        }),
      });
      const latencyMs = Math.max(Date.now() - startedAt, 0);
      const raw = await readResponseBody(response);

      if (!response?.ok) {
        throw new LiveModelProviderError({
          code: "model_provider_http_error",
          provider: cleanProvider,
          model: cleanModel,
          status: response?.status,
          raw,
        });
      }

      const content = raw?.choices?.[0]?.message?.content;
      const json = parseJsonContent(content, {
        provider: cleanProvider,
        model: cleanModel,
        raw,
      });
      const usage = usageFromOpenAI(raw?.usage, { latencyMs });
      return {
        json,
        provider: cleanProvider,
        model: cleanModel,
        usage,
        latencyMs,
        raw,
      };
    },
  };
}

export function createLiveModelBudgetGuard({ maxCostMicroCny, maxCostCny } = {}) {
  const max = positiveMicroCny({ maxCostMicroCny, maxCostCny });
  if (!max) throw new Error("live_model_budget_required");
  let spentCostMicroCny = 0;
  return {
    assertCanSpend() {
      if (spentCostMicroCny >= max) throw new Error("live_model_budget_exceeded");
      return true;
    },
    recordUsage(usage = {}) {
      const cost = nonNegativeInteger(usage?.costMicroCny);
      if (spentCostMicroCny + cost > max) throw new Error("live_model_budget_exceeded");
      spentCostMicroCny += cost;
      return this.snapshot();
    },
    snapshot() {
      return {
        maxCostMicroCny: max,
        spentCostMicroCny,
        remainingCostMicroCny: Math.max(max - spentCostMicroCny, 0),
      };
    },
    getSpentCostMicroCny() {
      return spentCostMicroCny;
    },
  };
}

function parseJsonContent(content, { provider, model, raw }) {
  const text = extractJsonText(content);
  if (!text) {
    throw new LiveModelProviderError({
      code: "model_provider_malformed_json",
      provider,
      model,
      raw,
    });
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new LiveModelProviderError({
      code: "model_provider_malformed_json",
      provider,
      model,
      raw,
      cause,
    });
  }
}

function extractJsonText(content) {
  const text = clean(content);
  if (!text) return undefined;
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : text;
}

async function readResponseBody(response) {
  if (response && typeof response.json === "function") {
    try {
      return await response.json();
    } catch {
      if (typeof response.text !== "function") return undefined;
    }
  }
  if (response && typeof response.text === "function") {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  }
  return undefined;
}

function usageFromOpenAI(usage = {}, { latencyMs } = {}) {
  const inputTokens = nonNegativeInteger(usage?.prompt_tokens ?? usage?.inputTokens);
  const outputTokens = nonNegativeInteger(usage?.completion_tokens ?? usage?.outputTokens);
  const totalTokens = nonNegativeInteger(usage?.total_tokens ?? usage?.totalTokens);
  return createUsagePlaceholder({
    inputTokens,
    outputTokens,
    totalTokens: totalTokens || inputTokens + outputTokens,
    costMicroCny: nonNegativeInteger(usage?.cost_micro_cny ?? usage?.costMicroCny),
    latencyMs,
  });
}

function positiveMicroCny({ maxCostMicroCny, maxCostCny }) {
  if (maxCostMicroCny !== undefined) {
    const value = Number(maxCostMicroCny);
    return Number.isInteger(value) && value > 0 ? value : undefined;
  }
  if (maxCostCny !== undefined) {
    const value = Number(maxCostCny);
    if (!Number.isFinite(value) || value <= 0) return undefined;
    const micro = Math.round(value * 1_000_000);
    return micro > 0 ? micro : undefined;
  }
  return undefined;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function nonNegativeInteger(value) {
  const number = Number(value ?? 0);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}
