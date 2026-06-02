#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadEnvFile, mergeEnvs } from "./env-inventory.mjs";

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
  const openaiModel = clean(env.OPENAI_MODEL);
  const missing = [
    collectorId ? undefined : "COLLECTOR_ID",
    agentProvider ? undefined : "AGENT_PROVIDER",
    requireApiKey && !openaiApiKey ? "OPENAI_API_KEY" : undefined,
    openaiModel ? undefined : "OPENAI_MODEL",
  ].filter(Boolean);

  if (missing.length) return { ok: false, missing };

  return {
    ok: true,
    collectorId,
    provider: agentProvider,
    openaiApiKey,
    openaiModel,
    openaiBaseUrl: normalizeBaseUrl(
      clean(env.OPENAI_BASE_URL) ?? "https://api.openai.com/v1",
    ),
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
        "Return zero or more event draft objects. Keep secondary mentions as separate events with secondary_mention signal.",
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
  let parsed;
  try {
    const raw =
      providerResponse ??
      (await requestProvider({
        config,
        articleSnapshot,
        evidenceAssets,
        fetchImpl,
        now,
        runId,
      }));
    parsed = parseProviderResponse(raw);
  } catch (error) {
    return failureResult({
      collectorId: config.collectorId,
      runId,
      articleUrl: articleSnapshot.canonicalUrl,
      reason: error?.reason ?? "agent_request_failed",
      message: error instanceof Error ? error.message : String(error),
      now,
    });
  }

  if (!parsed.ok) {
    return failureResult({
      collectorId: config.collectorId,
      runId,
      articleUrl: articleSnapshot.canonicalUrl,
      reason: "agent_response_invalid_schema",
      message: parsed.message,
      now,
    });
  }

  const metadata = buildMetadataEvidenceEnvelope({
    collectorId: config.collectorId,
    runId,
    observedAt,
    articleSnapshot,
    config,
    classification: parsed.data.classification,
  });
  const metadataId = metadata.payload.assetId;

  if (parsed.data.classification.kind !== "activity") {
    const reason =
      parsed.data.classification.kind === "not_activity"
        ? "not_activity"
        : "unsupported";
    const result = failureResult({
      collectorId: config.collectorId,
      runId,
      articleUrl: articleSnapshot.canonicalUrl,
      reason,
      message:
        parsed.data.classification.kind === "cancellation"
          ? "Cancellation-only post requires manual matching before publication."
          : "Provider classified this article as not an activity.",
      now,
      kind: "no_draft",
    });
    result.evidenceAssets = [metadata];
    return maybeUploadExtractionResult(result, { config, fetchImpl, upload });
  }

  const eventDrafts = parsed.data.events.map((event, index) =>
    buildEventDraftEnvelope({
      collectorId: config.collectorId,
      runId,
      observedAt,
      articleSnapshot,
      event,
      index,
      metadataId,
      config,
    }),
  );
  const result = {
    kind: eventDrafts.length ? "drafts" : "no_draft",
    runId,
    eventDrafts,
    evidenceAssets: [metadata],
    failures: [],
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
  const body = {
    model: config.openaiModel,
    text: {
      format: responseTextFormat(),
    },
    input: [
      {
        role: "system",
        content:
          "You extract Beijing official cultural activity drafts. Return only JSON matching the schema. Do not invent missing fields.",
      },
      {
        role: "user",
        content: JSON.stringify(
          buildExtractorPromptInput({
            articleSnapshot,
            evidenceAssets,
            collectorId: config.collectorId,
            runId,
          }),
        ),
      },
    ],
  };
  const response = await fetchImpl(`${config.openaiBaseUrl}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.openaiApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(`agent_request_failed:${response.status}`), {
      reason: "agent_request_failed",
    });
  }
  return data;
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
  const classification = content.classification;
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
  return envelope({
    collectorId,
    runId,
    observedAt,
    payload: {
      assetId: `${runId}-metadata`,
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
}) {
  const signals = normalizeSignals(event.signals);
  const evidenceAssetIds = uniqueStrings([
    ...(event.evidenceAssetIds ?? []),
    metadataId,
  ]);
  const fieldEvidence = normalizeFieldEvidence(event.fieldEvidence);
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
      title: clean(event.title),
      originalTitle: clean(event.originalTitle),
      organizer: clean(event.organizer),
      startsAt: clean(event.startsAt),
      endsAt: clean(event.endsAt),
      timezone: "Asia/Shanghai",
      venueName: clean(event.venueName),
      venueAddress: clean(event.venueAddress),
      city: "Beijing",
      reservationStatus: normalizeReservationStatus(event.reservationStatus),
      registrationAction: clean(event.registrationAction),
      registrationUrl: clean(event.registrationUrl),
      scheduleText: clean(event.scheduleText),
      posterImageUrl: clean(event.posterImageUrl),
      posterImageAlt: clean(event.posterImageAlt),
      posterImageSourceUrl: clean(event.posterImageSourceUrl),
      summary: clean(event.summary),
      entryNotes: clean(event.entryNotes),
      signals,
      evidenceAssetIds,
      fieldEvidence,
      confidence: isNumberInRange(event.confidence, 0, 1)
        ? event.confidence
        : 0.5,
    }),
  });
}

function failureResult({
  collectorId,
  runId,
  articleUrl,
  reason,
  message,
  now,
  kind = "failed",
}) {
  const observedAt = now.toISOString();
  return {
    kind,
    runId,
    eventDrafts: [],
    evidenceAssets: [],
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
  return {
    ...result,
    uploadedEvidenceAssetIds,
    uploadedEventDraftIds,
    uploadedFailureIds,
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

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function clean(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function createRunId(now) {
  return `llm-extraction-${now.toISOString().replace(/[:.]/g, "-")}`;
}

function readJsonFile(path) {
  if (!existsSync(path)) throw new Error(`json_file_not_found:${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function usage() {
  return `Usage: pnpm extractor:llm --article-file article.json [--env-file .env.collector] [--response-file fixture.json] [--upload]

Runs lightweight LLM information extraction over one normalized article snapshot.

Default behavior is dry-run and does not upload collector payloads.

Required env for live provider calls:
  COLLECTOR_ID
  AGENT_PROVIDER
  OPENAI_API_KEY
  OPENAI_MODEL

Required env only when --upload is set:
  COLLECTOR_BASE_URL or APP_BASE_URL
  COLLECTOR_API_KEY`;
}

async function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return;
  }
  const options = parseArgs(argv);
  if (!options.articleFile) throw new Error("missing_article_file");
  const env = mergeEnvs(process.env, loadEnvFile(options.envFile));
  const result = await runLlmExtractionOnce({
    env,
    articleSnapshot: readJsonFile(options.articleFile),
    evidenceAssets: options.evidenceFile ? readJsonFile(options.evidenceFile) : [],
    providerResponse: options.responseFile
      ? readJsonFile(options.responseFile)
      : undefined,
    upload: options.upload,
  });
  console.log(formatLlmExtractionSummary(result));
}

function parseArgs(argv) {
  const options = { upload: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env-file") options.envFile = argv[(index += 1)];
    else if (arg === "--article-file") options.articleFile = argv[(index += 1)];
    else if (arg === "--evidence-file") options.evidenceFile = argv[(index += 1)];
    else if (arg === "--response-file") options.responseFile = argv[(index += 1)];
    else if (arg === "--upload") options.upload = true;
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
