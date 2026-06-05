#!/usr/bin/env node

import { createHash } from "node:crypto";

import {
  buildLlmUsageEnvelope as buildSharedLlmUsageEnvelope,
  readUsageEnvironment,
} from "../../scripts/llm-usage-ledger.mjs";
import { readVisionModelPolicy } from "../../scripts/vision-model-policy.mjs";

export const promptVersion = "event-extraction-2026-06-02";
export const extractionSchemaVersion = "event-extraction-schema-v1";

const payloadVersion = "2026-05-collector-v1";
const failureReasons = new Set([
  "agent_config_missing",
  "agent_request_failed",
  "agent_response_invalid_schema",
  "not_activity",
  "unsupported",
]);
const draftSignals = new Set([
  "qr_registration",
  "registration_evidence_required",
  "image_dominant",
  "missing_required_public_field",
  "secondary_mention",
  "possible_duplicate",
  "ready_for_review",
]);

export function readLlmExtractorConfig(env = process.env, options = {}) {
  const requireApiKey = options.requireApiKey !== false;
  const collectorId = clean(env.COLLECTOR_ID);
  const agentProvider = clean(env.AGENT_PROVIDER);
  const openaiApiKey = clean(env.OPENAI_API_KEY);
  const visionModelPolicy = readVisionModelPolicy(env);
  const openaiModel = visionModelPolicy.extractionModel;
  const missing = [
    collectorId ? undefined : "COLLECTOR_ID",
    agentProvider ? undefined : "AGENT_PROVIDER",
    requireApiKey && !openaiApiKey ? "OPENAI_API_KEY" : undefined,
  ].filter(Boolean);

  if (missing.length) return { ok: false, missing };

  return {
    ok: true,
    collectorId,
    provider: agentProvider,
    openaiApiKey,
    openaiModel,
    visionModelPolicy,
    openaiApiStyle: normalizeOpenAIApiStyle(clean(env.OPENAI_API_STYLE)),
    agentTimeoutSeconds: readPositiveInteger(env.AGENT_TIMEOUT_SECONDS, 45),
    openaiBaseUrl: normalizeBaseUrl(
      clean(env.OPENAI_BASE_URL) ?? "https://api.openai.com/v1",
    ),
    usageEnvironment: readUsageEnvironment(env),
    collectorBaseUrl: normalizeBaseUrl(
      clean(env.COLLECTOR_BASE_URL) ?? clean(env.APP_BASE_URL) ?? "",
    ),
    collectorApiKey: clean(env.COLLECTOR_API_KEY),
  };
}

export function buildExtractorPromptInput({
  articleSnapshot,
  evidenceAssets = [],
  collectorId,
  runId,
}) {
  return {
    promptVersion,
    schemaVersion: extractionSchemaVersion,
    task:
      "Classify one official Beijing cultural activity article and extract reviewable event drafts. Return JSON only.",
    collector: {
      collectorId,
      runId,
    },
    articleSnapshot: {
      canonicalUrl: articleSnapshot.canonicalUrl,
      finalUrl: articleSnapshot.finalUrl,
      title: articleSnapshot.title,
      authorName: articleSnapshot.authorName,
      publishedAt: articleSnapshot.publishedAt,
      capturedAt: articleSnapshot.capturedAt,
      languageHints: articleSnapshot.languageHints ?? [],
      captureMode: articleSnapshot.captureMode,
      visibleText: articleSnapshot.visibleText,
      evidenceAssetIds: articleSnapshot.evidenceAssetIds ?? [],
      contentHash: articleSnapshot.contentHash,
    },
    evidenceAssets: evidenceAssets.map((asset) => ({
      assetId: asset.assetId,
      role: asset.role,
      mediaType: asset.mediaType,
      sourceUrl: asset.sourceUrl,
      width: asset.width,
      height: asset.height,
      textContent: asset.textContent,
      extractedBy: asset.extractedBy,
      confidence: asset.confidence,
    })),
    outputContract: {
      classification:
        "kind must be activity, not_activity, or cancellation. Use cancellation for cancellation-only posts.",
      events:
        "Return zero or more event draft objects. Include eventKind, scheduleKind, recurrenceRule, occurrenceStartsAt, posterAssetId, registrationQrAssetId, hardBlockers, and softBlockers when supported by evidence. Keep secondary mentions as separate events with secondary_mention signal.",
      signals: [...draftSignals],
      timezone: "Asia/Shanghai",
      city: "Beijing",
    },
  };
}

export async function runLlmExtractionOnce({
  env = process.env,
  articleSnapshot,
  evidenceAssets = [],
  fetchImpl = fetch,
  now = new Date(),
  runId = createRunId(now),
  providerResponse,
  upload = false,
}) {
  const config = readLlmExtractorConfig(env, {
    requireApiKey: providerResponse === undefined,
  });
  if (!config.ok) {
    return failureResult({
      collectorId: clean(env.COLLECTOR_ID) ?? "unknown-collector",
      runId,
      articleUrl: articleSnapshot?.canonicalUrl,
      reason: "agent_config_missing",
      message: `Missing LLM extractor env: ${config.missing.join(",")}`,
      now,
    });
  }

  const observedAt = now.toISOString();
  const providerResult = await requestAndParseProvider({
    config,
    articleSnapshot,
    evidenceAssets,
    fetchImpl,
    runId,
    observedAt,
    providerResponse,
  });
  if (!providerResult.ok && providerResult.reason === "agent_request_failed") {
    return failureResult({
      collectorId: config.collectorId,
      runId,
      articleUrl: articleSnapshot.canonicalUrl,
      reason: providerResult.reason,
      message: providerResult.message,
      now,
      llmUsage: providerResult.llmUsage,
    });
  }

  if (!providerResult.ok) {
    return failureResult({
      collectorId: config.collectorId,
      runId,
      articleUrl: articleSnapshot.canonicalUrl,
      reason: "agent_response_invalid_schema",
      message: providerResult.message,
      now,
      llmUsage: providerResult.llmUsage,
    });
  }

  const metadata = buildMetadataEvidenceEnvelope({
    collectorId: config.collectorId,
    runId,
    observedAt,
    articleSnapshot,
    config,
    classification: providerResult.data.classification,
  });
  const metadataId = metadata.payload.assetId;

  if (providerResult.data.classification.kind !== "activity") {
    const reason =
      providerResult.data.classification.kind === "not_activity"
        ? "not_activity"
        : "unsupported";
    const result = failureResult({
      collectorId: config.collectorId,
      runId,
      articleUrl: articleSnapshot.canonicalUrl,
      reason,
      message:
        providerResult.data.classification.kind === "cancellation"
          ? "Cancellation-only post requires manual matching before publication."
          : "Provider classified this article as not an activity.",
      now,
      kind: "no_draft",
    });
    result.evidenceAssets = [metadata];
    result.llmUsage = providerResult.llmUsage;
    return maybeUploadExtractionResult(result, { config, fetchImpl, upload });
  }

  const eventDrafts = providerResult.data.events.map((event, index) =>
    buildEventDraftEnvelope({
      collectorId: config.collectorId,
      runId,
      observedAt,
      articleSnapshot,
      event,
      index,
      metadataId,
      config,
      evidenceAssets,
    }),
  );
  const result = {
    kind: eventDrafts.length ? "drafts" : "no_draft",
    runId,
    eventDrafts,
    evidenceAssets: [metadata],
    failures: [],
    llmUsage: providerResult.llmUsage,
  };
  if (!eventDrafts.length) {
    result.failures.push(
      failureEnvelope({
        collectorId: config.collectorId,
        runId,
        observedAt,
        articleUrl: articleSnapshot.canonicalUrl,
        reason: "not_activity",
        message: "Provider returned no events for an activity classification.",
        retryable: false,
      }),
    );
  }

  return maybeUploadExtractionResult(result, { config, fetchImpl, upload });
}

export function formatLlmExtractionSummary(result) {
  const parts = [
    `LLM extraction kind=${result.kind}`,
    `run=${result.runId}`,
    `drafts=${result.eventDrafts?.length ?? 0}`,
    `failures=${result.failures?.length ?? 0}`,
  ];
  const failureReasons = uniqueStrings(
    (result.failures ?? []).map((failure) => failure.payload?.reason),
  );
  if (failureReasons.length) parts.push(`failureReasons=${failureReasons.join(",")}`);
  if (result.uploadedEventDraftIds) {
    parts.push(`uploadedDrafts=${result.uploadedEventDraftIds.length}`);
  }
  return parts.join(" ");
}

async function requestProvider({
  config,
  articleSnapshot,
  evidenceAssets,
  fetchImpl,
  runId,
}) {
  const request = providerRequest({
    config,
    articleSnapshot,
    evidenceAssets,
    runId,
  });
  const startedAt = Date.now();
  const response = await fetchImpl(`${config.openaiBaseUrl}${request.path}`, {
    method: "POST",
    signal: AbortSignal.timeout(config.agentTimeoutSeconds * 1000),
    headers: {
      authorization: `Bearer ${config.openaiApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(request.body),
  });
  const data = await response.json().catch(() => ({}));
  const latencyMs = Math.max(0, Date.now() - startedAt);
  if (!response.ok) {
    throw Object.assign(new Error(`agent_request_failed:${response.status}`), {
      reason: "agent_request_failed",
      statusCode: response.status,
      data,
      latencyMs,
    });
  }
  return {
    data,
    latencyMs,
  };
}

async function requestAndParseProvider({
  config,
  articleSnapshot,
  evidenceAssets,
  fetchImpl,
  runId,
  observedAt,
  providerResponse,
}) {
  if (providerResponse !== undefined) {
    const parsed = parseProviderResponse(providerResponse);
    return parsed.ok
      ? { ok: true, data: parsed.data }
      : {
          ok: false,
          reason: "agent_response_invalid_schema",
          message: parsed.message,
        };
  }

  let lastFailure;
  const llmUsage = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await requestProvider({
        config,
        articleSnapshot,
        evidenceAssets,
        fetchImpl,
        runId,
      });
      const parsed = parseProviderResponse(raw.data);
      llmUsage.push(
        buildLlmUsageEnvelope({
          config,
          articleSnapshot,
          runId,
          observedAt,
          status: parsed.ok ? "succeeded" : "failed",
          providerResponse: raw.data,
          latencyMs: raw.latencyMs,
          failureReason: parsed.ok ? undefined : "agent_response_invalid_schema",
          attemptNumber: attempt + 1,
        }),
      );
      if (parsed.ok) return { ok: true, data: parsed.data, llmUsage };
      lastFailure = {
        ok: false,
        reason: "agent_response_invalid_schema",
        message: parsed.message,
        llmUsage,
      };
    } catch (error) {
      llmUsage.push(
        buildLlmUsageEnvelope({
          config,
          articleSnapshot,
          runId,
          observedAt,
          status: "failed",
          providerResponse: error?.data,
          latencyMs: error?.latencyMs,
          failureReason: error?.reason ?? "agent_request_failed",
          statusCode: error?.statusCode,
          attemptNumber: attempt + 1,
        }),
      );
      lastFailure = {
        ok: false,
        reason: error?.reason ?? "agent_request_failed",
        message: error instanceof Error ? error.message : String(error),
        llmUsage,
      };
    }
  }
  return lastFailure;
}

function buildLlmUsageEnvelope({
  config,
  articleSnapshot,
  runId,
  observedAt,
  status,
  providerResponse,
  latencyMs,
  failureReason,
  statusCode,
  attemptNumber,
}) {
  const metadata = removeUndefined({
    extractorVersion: promptVersion,
    schemaVersion: extractionSchemaVersion,
    apiStyle: config.openaiApiStyle,
    workload: "event_extraction",
    environment: config.usageEnvironment,
    chargeable: true,
    articleUrl: articleSnapshot.canonicalUrl,
    failureReason,
    statusCode,
    attemptNumber,
    usageSource: providerResponse?.usage ? "provider_usage" : "missing_usage",
  });

  return buildSharedLlmUsageEnvelope({
    collectorId: config.collectorId,
    runId,
    observedAt,
    operation: "event_extraction",
    provider: config.provider,
    model: config.openaiModel,
    status,
    usage: providerResponse?.usage,
    latencyMs,
    sourceRunId: runId,
    metadata,
    usageIdParts: [
      articleSnapshot.canonicalUrl,
      String(attemptNumber ?? 1),
    ],
  });
}

function providerRequest({ config, articleSnapshot, evidenceAssets, runId }) {
  const systemPrompt =
    "You extract Beijing official cultural activity drafts. Return only JSON matching the schema. Do not invent missing fields.";
  const userPrompt = JSON.stringify(
    buildExtractorPromptInput({
      articleSnapshot,
      evidenceAssets,
      collectorId: config.collectorId,
      runId,
    }),
  );

  if (config.openaiApiStyle === "chat_completions") {
    return {
      path: "/chat/completions",
      body: {
        model: config.openaiModel,
        messages: [
          {
            role: "user",
            content: compactChatPrompt({
              articleSnapshot,
              evidenceAssets,
              collectorId: config.collectorId,
              runId,
            }),
          },
        ],
        max_tokens: 800,
        temperature: 0,
      },
    };
  }

  return {
    path: "/responses",
    body: {
      model: config.openaiModel,
      text: {
        format: responseTextFormat(),
      },
      input: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
    },
  };
}

function compactChatPrompt({
  articleSnapshot,
  evidenceAssets,
  collectorId,
  runId,
}) {
  const evidenceText = evidenceAssets.length
    ? `\n\nEVIDENCE_ASSETS:\n${JSON.stringify(
        buildExtractorPromptInput({
          articleSnapshot,
          evidenceAssets,
          collectorId,
          runId,
        }).evidenceAssets,
      )}`
    : "";
  return [
    "Extract Beijing cultural events from this article.",
    'Return ONLY compact JSON: {"classification":{"kind":"activity|not_activity|cancellation","confidence":0.0,"signals":[],"missingFields":[]},"events":[{"title":"","startsAt":"","endsAt":"","venueName":"","summary":"","confidence":0.0,"signals":[]}]}',
    `ARTICLE:\n${articleSnapshot.visibleText ?? ""}${evidenceText}`,
  ]
    .join("\n\n");
}

function responseTextFormat() {
  return {
    type: "json_schema",
    name: "event_extraction_result",
    strict: false,
    schema: {
      type: "object",
      additionalProperties: true,
      required: ["classification", "events"],
      properties: {
        classification: {
          type: "object",
          additionalProperties: true,
          required: ["kind", "confidence", "signals", "missingFields"],
          properties: {
            kind: {
              type: "string",
              enum: ["activity", "not_activity", "cancellation"],
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            signals: { type: "array", items: { type: "string" } },
            missingFields: { type: "array", items: { type: "string" } },
          },
        },
        events: {
          type: "array",
          items: { type: "object", additionalProperties: true },
        },
      },
    },
  };
}

function parseProviderResponse(data) {
  const content = parseOpenAIJson(data);
  if (!content || typeof content !== "object") {
    return { ok: false, message: "Provider response was not a JSON object." };
  }
  const classification = normalizeClassification(content.classification, content);
  if (!classification || typeof classification !== "object") {
    return { ok: false, message: "Provider response missed classification." };
  }
  if (
    !["activity", "not_activity", "cancellation"].includes(classification.kind)
  ) {
    return { ok: false, message: "Provider classification kind was invalid." };
  }
  if (!isNumberInRange(classification.confidence, 0, 1)) {
    return {
      ok: false,
      message: "Provider classification confidence was invalid.",
    };
  }
  if (!Array.isArray(classification.signals)) {
    return { ok: false, message: "Provider classification signals missing." };
  }
  if (!Array.isArray(classification.missingFields)) {
    return {
      ok: false,
      message: "Provider classification missingFields missing.",
    };
  }
  if (!Array.isArray(content.events)) {
    return { ok: false, message: "Provider response missed events array." };
  }
  return {
    ok: true,
    data: {
      classification,
      events: content.events,
    },
  };
}

function normalizeClassification(classification, content) {
  if (
    typeof classification === "string" &&
    ["activity", "not_activity", "cancellation"].includes(classification)
  ) {
    return {
      kind: classification,
      confidence: 0.5,
      signals: Array.isArray(content.signals) ? content.signals : [],
      missingFields: Array.isArray(content.missingFields)
        ? content.missingFields
        : [],
    };
  }
  return classification;
}

function parseOpenAIJson(data) {
  if (data?.classification) return data;
  const text =
    typeof data?.output_text === "string"
      ? data.output_text
      : extractOpenAIOutputText(data);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function extractOpenAIOutputText(data) {
  if (Array.isArray(data?.choices)) {
    for (const choice of data.choices) {
      if (typeof choice?.message?.content === "string") {
        return choice.message.content;
      }
    }
  }
  if (!Array.isArray(data?.output)) return undefined;
  for (const item of data.output) {
    if (!Array.isArray(item?.content)) continue;
    for (const content of item.content) {
      if (typeof content?.text === "string") return content.text;
      if (typeof content?.content === "string") return content.content;
    }
  }
  return undefined;
}

function buildMetadataEvidenceEnvelope({
  collectorId,
  runId,
  observedAt,
  articleSnapshot,
  config,
  classification,
}) {
  const textContent = JSON.stringify({
    promptVersion,
    schemaVersion: extractionSchemaVersion,
    provider: config.provider,
    model: config.openaiModel,
    classification,
  });
  const articleKey = hashText(
    `${articleSnapshot.canonicalUrl ?? articleSnapshot.finalUrl ?? ""}:${articleSnapshot.contentHash ?? ""}`,
  ).slice(0, 16);
  return envelope({
    collectorId,
    runId,
    observedAt,
    payload: {
      assetId: `${runId}-${articleKey}-metadata`,
      articleUrl: articleSnapshot.canonicalUrl,
      role: "vision_summary",
      mediaType: "text",
      contentHash: hashText(textContent),
      textContent,
      extractedBy: "vision",
      confidence: classification.confidence,
    },
  });
}

function buildEventDraftEnvelope({
  collectorId,
  runId,
  observedAt,
  articleSnapshot,
  event,
  index,
  metadataId,
  config,
  evidenceAssets,
}) {
  const signals = normalizeSignals(event.signals ?? []);
  const posterEvidence = findEvidenceAssetByRole(evidenceAssets, ["poster"]);
  const qrEvidence = findEvidenceAssetByRole(evidenceAssets, [
    "registration",
    "qr",
  ]);
  const posterAssetId = clean(event.posterAssetId) ?? posterEvidence?.assetId;
  const qrAssetId = clean(event.qrAssetId) ?? qrEvidence?.assetId;
  const registrationQrAssetId =
    clean(event.registrationQrAssetId) ?? qrEvidence?.assetId;
  const posterImageUrl =
    clean(event.posterImageUrl) ?? publicStorageUrl(posterEvidence);
  const posterImageSourceUrl =
    clean(event.posterImageSourceUrl) ??
    (posterEvidence?.sourceUrl && posterImageUrl
      ? posterEvidence.sourceUrl
      : undefined);
  const evidenceAssetIds = uniqueStrings([
    ...(event.evidenceAssetIds ?? []),
    posterAssetId,
    qrAssetId,
    registrationQrAssetId,
    metadataId,
  ]);
  const fieldEvidence = normalizeFieldEvidence(event.fieldEvidence);
  const startsAt = normalizeDateTime(event.startsAt);
  const endsAt = normalizeDateTime(event.endsAt);
  fieldEvidence._extraction = [
    `prompt:${promptVersion}`,
    `schema:${extractionSchemaVersion}`,
    `provider:${config.provider}`,
    `model:${config.openaiModel}`,
  ];

  return envelope({
    collectorId,
    runId,
    observedAt,
    payload: removeUndefined({
      articleUrl: articleSnapshot.canonicalUrl,
      sourceId: articleSnapshot.sourceId,
      extractionAttemptId: `${runId}-activity-${index + 1}`,
      captureMode: articleSnapshot.captureMode,
      publicEligibility: normalizePublicEligibility(event.publicEligibility),
      eventKind: normalizeEventKind(event.eventKind),
      scheduleKind: normalizeScheduleKind(event.scheduleKind),
      title: clean(event.title),
      originalTitle: clean(event.originalTitle),
      organizer: clean(event.organizer),
      startsAt,
      endsAt,
      recurrenceRule: clean(event.recurrenceRule),
      occurrenceStartsAt: normalizeOccurrenceStartsAt(event.occurrenceStartsAt),
      timezone: "Asia/Shanghai",
      venueName: clean(event.venueName),
      venueAddress: clean(event.venueAddress),
      city: "Beijing",
      reservationStatus: normalizeReservationStatus(event.reservationStatus),
      registrationRequirement: normalizeRegistrationRequirement(
        event.registrationRequirement,
      ),
      registrationAction: clean(event.registrationAction),
      registrationUrl: clean(event.registrationUrl),
      scheduleText: clean(event.scheduleText) ?? scheduleTextFallback(event),
      posterAssetId,
      qrAssetId,
      registrationQrAssetId,
      posterImageUrl,
      posterImageAlt: clean(event.posterImageAlt),
      posterImageSourceUrl,
      summary: clean(event.summary),
      entryNotes: clean(event.entryNotes),
      signals,
      evidenceAssetIds,
      fieldEvidence,
      confidence: isNumberInRange(event.confidence, 0, 1)
        ? event.confidence
        : 0.5,
      hardBlockers: normalizeBlockers(event.hardBlockers),
      softBlockers: normalizeBlockers(event.softBlockers),
    }),
  });
}

function normalizeDateTime(value) {
  const text = clean(value);
  if (!text) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text)) return undefined;
  const utcLike = text.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|\+00:00)$/,
  );
  if (utcLike) {
    return `${utcLike[1]}:${utcLike[2] ?? "00"}+08:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) {
    return `${text}:00+08:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)) {
    return `${text}+08:00`;
  }
  return text;
}

function scheduleTextFallback(event) {
  const values = [clean(event.startsAt), clean(event.endsAt)].filter(
    (value) => value && !normalizeDateTime(value),
  );
  return values.length ? values.join(" - ") : undefined;
}

function failureResult({
  collectorId,
  runId,
  articleUrl,
  reason,
  message,
  now,
  kind = "failed",
  llmUsage = [],
}) {
  const observedAt = now.toISOString();
  return {
    kind,
    runId,
    eventDrafts: [],
    evidenceAssets: [],
    llmUsage,
    failures: [
      failureEnvelope({
        collectorId,
        runId,
        observedAt,
        articleUrl,
        reason,
        message,
        retryable:
          reason === "agent_request_failed" ||
          reason === "agent_config_missing",
      }),
    ],
  };
}

function failureEnvelope({
  collectorId,
  runId,
  observedAt,
  articleUrl,
  reason,
  message,
  retryable,
}) {
  return envelope({
    collectorId,
    runId,
    observedAt,
    payload: removeUndefined({
      articleUrl,
      stage: "draft_extraction",
      reason: failureReasons.has(reason)
        ? reason
        : "agent_response_invalid_schema",
      message,
      retryable,
    }),
  });
}

async function maybeUploadExtractionResult(result, { config, fetchImpl, upload }) {
  if (!upload) return result;
  if (!config.collectorBaseUrl || !config.collectorApiKey) {
    throw new Error("collector_upload_config_missing");
  }

  const headers = {
    authorization: `Bearer ${config.collectorApiKey}`,
    "content-type": "application/json",
    "x-collector-id": config.collectorId,
  };
  const uploadedEvidenceAssetIds = [];
  for (const evidence of result.evidenceAssets ?? []) {
    const response = await postJson({
      baseUrl: config.collectorBaseUrl,
      path: "/api/collector/evidence-asset",
      headers,
      fetchImpl,
      body: evidence,
    });
    uploadedEvidenceAssetIds.push(response.id);
  }
  const uploadedEventDraftIds = [];
  for (const draft of result.eventDrafts ?? []) {
    const response = await postJson({
      baseUrl: config.collectorBaseUrl,
      path: "/api/collector/event-draft",
      headers,
      fetchImpl,
      body: draft,
    });
    uploadedEventDraftIds.push(response.id);
  }
  const uploadedFailureIds = [];
  for (const failure of result.failures ?? []) {
    const response = await postJson({
      baseUrl: config.collectorBaseUrl,
      path: "/api/collector/failure",
      headers,
      fetchImpl,
      body: failure,
    });
    uploadedFailureIds.push(response.id);
  }
  const uploadedLlmUsageIds = [];
  for (const usageRecord of result.llmUsage ?? []) {
    const response = await postJson({
      baseUrl: config.collectorBaseUrl,
      path: "/api/collector/llm-usage",
      headers,
      fetchImpl,
      body: usageRecord,
    });
    uploadedLlmUsageIds.push(response.id);
  }
  return {
    ...result,
    uploadedEvidenceAssetIds,
    uploadedEventDraftIds,
    uploadedFailureIds,
    uploadedLlmUsageIds,
  };
}

async function postJson({ baseUrl, path, headers, fetchImpl, body }) {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`collector_upload_failed:${path}:${response.status}`);
  }
  return data;
}

function envelope({ collectorId, runId, observedAt, payload }) {
  return {
    collectorId,
    runId,
    observedAt,
    payloadVersion,
    payload,
  };
}

function normalizeSignals(signals) {
  const normalized = uniqueStrings(Array.isArray(signals) ? signals : []);
  return normalized.filter((signal) => draftSignals.has(signal));
}

function normalizeFieldEvidence(fieldEvidence) {
  if (!fieldEvidence || typeof fieldEvidence !== "object") return {};
  const normalized = {};
  for (const [key, value] of Object.entries(fieldEvidence)) {
    if (!key || !Array.isArray(value)) continue;
    const evidence = uniqueStrings(value.map((entry) => clean(entry)).filter(Boolean));
    if (evidence.length) normalized[key] = evidence;
  }
  return normalized;
}

function normalizeReservationStatus(value) {
  return ["required", "not_required", "unknown"].includes(value)
    ? value
    : "unknown";
}

function normalizeRegistrationRequirement(value) {
  return ["required", "not_required", "unknown"].includes(value)
    ? value
    : undefined;
}

function normalizePublicEligibility(value) {
  return ["public", "not_public", "unclear"].includes(value)
    ? value
    : undefined;
}

function normalizeEventKind(value) {
  return [
    "single",
    "multi_day",
    "long_running",
    "recurring",
    "news",
    "visit",
    "cancellation",
    "unsupported",
  ].includes(value)
    ? value
    : undefined;
}

function normalizeScheduleKind(value) {
  return [
    "single",
    "multi_day",
    "long_running",
    "recurring",
    "unsupported",
  ].includes(value)
    ? value
    : undefined;
}

function normalizeOccurrenceStartsAt(value) {
  if (!Array.isArray(value)) return undefined;
  const normalized = value.map(normalizeDateTime).filter(Boolean);
  return normalized.length ? normalized : undefined;
}

function normalizeBlockers(value) {
  if (!Array.isArray(value)) return undefined;
  const blockers = value
    .map((blocker) => ({
      code: clean(blocker?.code),
      message: clean(blocker?.message),
      severity: ["hard", "soft"].includes(blocker?.severity)
        ? blocker.severity
        : undefined,
    }))
    .filter((blocker) => blocker.code && blocker.message);
  return blockers.length ? blockers : undefined;
}

function findEvidenceAssetByRole(evidenceAssets, roles) {
  return evidenceAssets.find(
    (asset) =>
      roles.includes(asset?.role) &&
      typeof asset?.assetId === "string" &&
      asset.assetId,
  );
}

function publicStorageUrl(evidenceAsset) {
  const value = clean(evidenceAsset?.storagePath);
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value))];
}

function isNumberInRange(value, min, max) {
  return typeof value === "number" && value >= min && value <= max;
}

function removeUndefined(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

function hashText(text) {
  return createHash("sha256").update(text).digest("hex");
}

function createStableCollectorObjectId(prefix, parts) {
  const hash = createHash("sha256")
    .update(parts.join("\u001f"))
    .digest("hex")
    .slice(0, 24);
  return `${prefix}-${hash}`;
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function normalizeOpenAIApiStyle(value) {
  if (value === "chat_completions") return "chat_completions";
  return "responses";
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function clean(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function createRunId(now) {
  return `llm-extraction-${now.toISOString().replace(/[:.]/g, "-")}`;
}
