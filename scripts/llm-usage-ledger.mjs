import { createHash } from "node:crypto";

const payloadVersion = "2026-05-collector-v1";

export const knownModelPricingCnyPerMillion = new Map(
  [
    ["Qwen/Qwen3-VL-8B-Instruct", { input: 0.5, output: 2 }],
    ["Qwen/Qwen3-VL-30B-A3B-Instruct", { input: 0.7, output: 2.8 }],
    ["zai-org/GLM-4.5V", { input: 1, output: 6 }],
    ["qwen3-vl-flash", { input: 0.15, output: 1.5 }],
    ["qwen3-vl-plus", { input: 1, output: 10 }],
    ["qwen-vl-plus", { input: 0.8, output: 2 }],
    ["qwen-vl-max", { input: 1.6, output: 4 }],
  ].map(([model, pricing]) => [normalizeModelKey(model), pricing]),
);

export function normalizeProviderUsage(usage) {
  const inputTokens = integerOrZero(
    usage?.input_tokens ??
      usage?.prompt_tokens ??
      usage?.inputTokens ??
      usage?.promptTokens,
  );
  const outputTokens = integerOrZero(
    usage?.output_tokens ??
      usage?.completion_tokens ??
      usage?.outputTokens ??
      usage?.completionTokens,
  );
  const totalTokens = integerOrZero(
    usage?.total_tokens ?? usage?.totalTokens ?? inputTokens + outputTokens,
  );
  const cachedInputTokens = integerOrZero(
    usage?.cached_input_tokens ??
      usage?.cachedInputTokens ??
      usage?.input_tokens_details?.cached_tokens ??
      usage?.prompt_tokens_details?.cached_tokens,
  );
  const reasoningOutputTokens = integerOrZero(
    usage?.reasoning_output_tokens ??
      usage?.reasoningOutputTokens ??
      usage?.output_tokens_details?.reasoning_tokens ??
      usage?.completion_tokens_details?.reasoning_tokens,
  );

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    reasoningOutputTokens,
  };
}

export function estimateLlmCostMicroCny({ model, usage, pricing } = {}) {
  const tokens = normalizeProviderUsage(usage);
  const modelPricing =
    pricing ?? knownModelPricingCnyPerMillion.get(normalizeModelKey(model));
  if (!modelPricing) {
    return {
      costMicroCny: 0,
      pricingSource: "pricing_unknown",
      ...tokens,
    };
  }

  const costCny =
    (tokens.inputTokens / 1_000_000) * modelPricing.input +
    (tokens.outputTokens / 1_000_000) * modelPricing.output;
  return {
    costMicroCny: Math.round(costCny * 1_000_000),
    pricingSource: "known_model_pricing",
    ...tokens,
  };
}

export function buildLlmUsageEnvelope({
  collectorId,
  runId,
  observedAt,
  operation,
  provider,
  model,
  status,
  usage,
  latencyMs,
  sourceRunId = runId,
  articleSnapshotId,
  eventDraftId,
  excludedArticleId,
  metadata = {},
  usageIdParts = [],
}) {
  const normalizedUsage = normalizeProviderUsage(usage);
  const cost = estimateLlmCostMicroCny({ model, usage });
  const usageSource = usage ? "provider_usage" : "missing_usage";
  const environment = normalizeUsageEnvironment(metadata.environment);
  const batchLabel = clean(metadata.batchLabel);
  const safeMetadata = removeUndefined({
    ...metadata,
    environment,
    batchLabel,
    usageSource: metadata.usageSource ?? usageSource,
    pricingSource: metadata.pricingSource ?? cost.pricingSource,
  });
  return {
    collectorId,
    runId,
    observedAt,
    payloadVersion,
    payload: removeUndefined({
      usageId: createStableCollectorObjectId("usage", [
        collectorId,
        runId,
        operation,
        provider,
        model,
        status,
        ...usageIdParts.map((part) => String(part ?? "")),
      ]),
      recordedAt: observedAt,
      operation,
      provider,
      model,
      status,
      ...normalizedUsage,
      costMicroCny: cost.costMicroCny,
      latencyMs,
      sourceRunId,
      articleSnapshotId,
      eventDraftId,
      excludedArticleId,
      metadata: safeMetadata,
    }),
  };
}

export function readUsageEnvironment(env = process.env) {
  return normalizeUsageEnvironment(
    clean(env.USAGE_ENVIRONMENT) ??
      clean(env.VERCEL_ENV) ??
      clean(env.NODE_ENV) ??
      "local",
  );
}

export function readProductionSeedUsageEnvironment(env = process.env) {
  return normalizeUsageEnvironment(
    clean(env.PRODUCTION_SEED_USAGE_ENVIRONMENT) ??
      clean(env.USAGE_ENVIRONMENT) ??
      "production_seed_acceptance",
  );
}

export function readCollectorUsageUploadConfig(env = process.env) {
  const collectorId = clean(env.COLLECTOR_ID);
  const collectorBaseUrl = normalizeBaseUrl(
    clean(env.COLLECTOR_BASE_URL) ?? clean(env.APP_BASE_URL) ?? "",
  );
  const collectorApiKey = clean(env.COLLECTOR_API_KEY);
  if (!collectorId || !collectorBaseUrl || !collectorApiKey) {
    return {
      ok: false,
      missing: [
        collectorId ? undefined : "COLLECTOR_ID",
        collectorBaseUrl ? undefined : "COLLECTOR_BASE_URL",
        collectorApiKey ? undefined : "COLLECTOR_API_KEY",
      ].filter(Boolean),
    };
  }
  return {
    ok: true,
    collectorId,
    collectorBaseUrl,
    collectorApiKey,
  };
}

export async function uploadLlmUsageEnvelopes({
  config,
  envelopes,
  fetchImpl = fetch,
}) {
  if (!config?.ok || !envelopes.length) return [];
  const headers = {
    authorization: `Bearer ${config.collectorApiKey}`,
    "content-type": "application/json",
    "x-collector-id": config.collectorId,
  };
  const uploadedIds = [];
  for (const envelope of envelopes) {
    const response = await fetchImpl(
      `${config.collectorBaseUrl}/api/collector/llm-usage`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(envelope),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`llm_usage_upload_failed:${response.status}`);
    }
    uploadedIds.push(data.id);
  }
  return uploadedIds;
}

function createStableCollectorObjectId(prefix, parts) {
  const hash = createHash("sha256")
    .update(parts.join("\u001f"))
    .digest("hex")
    .slice(0, 24);
  return `${prefix}-${hash}`;
}

function normalizeModelKey(model) {
  return String(model ?? "").trim().toLowerCase();
}

function integerOrZero(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text ? text : undefined;
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

export function normalizeUsageEnvironment(value) {
  const environment = clean(value) ?? "local";
  return environment.replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 80);
}

function removeUndefined(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}
