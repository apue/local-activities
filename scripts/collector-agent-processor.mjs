#!/usr/bin/env node

import { createCollectorHeaders } from "./collector-fixture-run.mjs";

const payloadVersion = "2026-05-collector-v1";
const captureModes = new Set([
  "text_complete",
  "text_with_qr_registration",
  "image_dominant",
  "image_with_qr_registration",
  "not_activity",
  "unsupported",
]);
const dispositions = new Set([
  "ready_for_review",
  "needs_review",
  "needs_info",
  "not_activity",
  "failed",
]);
const failureReasons = new Set([
  "fetch_blocked",
  "fetch_timeout",
  "region_network_failed",
  "sandbox_runtime_timeout",
  "login_required",
  "captcha_required",
  "parser_mismatch",
  "source_identity_missing",
  "activity_fields_missing",
  "image_download_failed",
  "ocr_failed",
  "vision_failed",
  "agent_config_missing",
  "agent_request_failed",
  "agent_response_invalid_schema",
  "not_activity",
  "unsupported",
]);
const failureStages = new Set([
  "source_discovery",
  "page_fetch",
  "image_capture",
  "ocr",
  "vision_extraction",
  "agent_extraction",
  "draft_extraction",
  "upload",
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
const evidenceRoles = new Set([
  "cover",
  "poster",
  "qr",
  "registration",
  "screenshot",
  "article_image",
  "ocr_text",
  "vision_summary",
]);

export async function runCollectorAgent({
  env = process.env,
  seedUrl,
  runId,
  vercelJobId,
  fetchImpl = fetch,
  now = new Date(),
}) {
  const config = readAgentConfig(env);
  if (!seedUrl) throw new Error("missing_seed_url");
  if (!runId) throw new Error("missing_run_id");

  const response = await requestAgentWithRetries({
    config,
    seedUrl,
    runId,
    vercelJobId,
    fetchImpl,
    now,
  });
  const payloads = response.ok
    ? buildAgentSuccessPayloads({
        config,
        seedUrl,
        runId,
        response: response.data,
        now,
      })
    : buildAgentFailurePayloads({
        config,
        seedUrl,
        runId,
        reason: response.reason,
        stage: response.stage,
        message: response.message,
        retryable: response.retryable,
        now,
      });

  return uploadAgentPayloads({ config, fetchImpl, payloads, runId });
}

async function requestAgentWithRetries({
  config,
  seedUrl,
  runId,
  vercelJobId,
  fetchImpl,
}) {
  let lastError = {
    reason: "agent_response_invalid_schema",
    stage: "agent_extraction",
    message: "Agent response did not match the expected schema.",
    retryable: true,
  };

  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    try {
      const data = await requestAgent({
        config,
        seedUrl,
        runId,
        vercelJobId,
        fetchImpl,
        attempt,
      });
      const parsed = parseAgentResponse(data);
      if (parsed.ok) return parsed;
      if (parsed.retryable === false) return parsed;
      lastError = parsed;
    } catch (error) {
      lastError = {
        reason: error?.reason ?? "agent_request_failed",
        stage: "agent_extraction",
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      };
    }
  }

  return {
    ok: false,
    reason: lastError.reason,
    stage: lastError.stage,
    message: lastError.message,
    retryable: lastError.retryable,
  };
}

async function requestAgent({
  config,
  seedUrl,
  runId,
  vercelJobId,
  fetchImpl,
  attempt,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(`${config.agentBaseUrl}/extract`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${config.agentApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(
        removeUndefined({
          seedUrl,
          runId,
          collectorId: config.collectorId,
          vercelJobId,
          model: config.agentModel,
          attempt,
        }),
      ),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error(`agent_request_failed:${response.status}`), {
        reason: "agent_request_failed",
      });
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw Object.assign(new Error("agent_request_failed:timeout"), {
        reason: "agent_request_failed",
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseAgentResponse(data) {
  if (!data || typeof data !== "object") {
    return invalidAgentResponse("Agent response was not an object.");
  }
  if (data.status === "failure") {
    const failure = data.failure;
    if (!failure || typeof failure !== "object") {
      return invalidAgentResponse("Agent failure response missed failure object.");
    }
    return {
      ok: false,
      reason: normalizeFailureReason(failure.reason),
      message: String(failure.message ?? "Agent reported failure."),
      retryable: failure.retryable !== false,
      stage: normalizeFailureStage(failure.stage),
    };
  }
  if (data.status !== "success" || !dispositions.has(data.disposition)) {
    return invalidAgentResponse("Agent response missed status or disposition.");
  }
  if (!isNumberInRange(data.confidence, 0, 1)) {
    return invalidAgentResponse("Agent response missed confidence.");
  }
  const articleSnapshot = normalizeArticleSnapshot(data.articleSnapshot);
  if (!articleSnapshot) {
    return invalidAgentResponse("Agent response missed article snapshot.");
  }

  if (!["not_activity", "failed"].includes(data.disposition)) {
    const eventDraft = normalizeEventDraft(
      data.eventDraft,
      data.missingFields,
    );
    if (!eventDraft) {
      return invalidAgentResponse("Agent response missed valid event draft.");
    }
    return {
      ok: true,
      data: {
        disposition: data.disposition,
        confidence: data.confidence,
        articleSnapshot,
        evidenceAssets: normalizeEvidenceAssets(data.evidenceAssets ?? []),
        eventDraft,
      },
    };
  }

  return {
    ok: true,
    data: {
      disposition: data.disposition,
      confidence: data.confidence,
      articleSnapshot,
      evidenceAssets: normalizeEvidenceAssets(data.evidenceAssets ?? []),
      failure: data.failure,
    },
  };
}

function normalizeArticleSnapshot(input) {
  if (!input || typeof input !== "object") return undefined;
  if (
    !isUrl(input.canonicalUrl) ||
    !isUrl(input.finalUrl) ||
    !isDateTime(input.capturedAt) ||
    !captureModes.has(input.captureMode) ||
    !input.contentHash
  ) {
    return undefined;
  }
  return removeUndefined({
    sourceId: nonEmpty(input.sourceId),
    sourceName: nonEmpty(input.sourceName),
    canonicalUrl: input.canonicalUrl,
    finalUrl: input.finalUrl,
    title: nonEmpty(input.title),
    authorName: nonEmpty(input.authorName),
    publishedAt: isDateTime(input.publishedAt) ? input.publishedAt : undefined,
    capturedAt: input.capturedAt,
    languageHints: Array.isArray(input.languageHints)
      ? input.languageHints.filter(nonEmpty)
      : [],
    captureMode: input.captureMode,
    visibleText: nonEmpty(input.visibleText),
    textHash: nonEmpty(input.textHash),
    screenshotAssetId: nonEmpty(input.screenshotAssetId),
    evidenceAssetIds: Array.isArray(input.evidenceAssetIds)
      ? input.evidenceAssetIds.filter(nonEmpty)
      : [],
    contentHash: String(input.contentHash),
  });
}

function normalizeEvidenceAssets(inputs) {
  if (!Array.isArray(inputs)) return [];
  return inputs
    .map((input) => {
      if (
        !input ||
        typeof input !== "object" ||
        !nonEmpty(input.assetId) ||
        !isUrl(input.articleUrl) ||
        !evidenceRoles.has(input.role) ||
        !["image", "text", "html_summary"].includes(input.mediaType) ||
        !nonEmpty(input.contentHash)
      ) {
        return undefined;
      }
      return removeUndefined({
        assetId: input.assetId,
        articleUrl: input.articleUrl,
        role: input.role,
        mediaType: input.mediaType,
        sourceUrl: isUrl(input.sourceUrl) ? input.sourceUrl : undefined,
        storagePath: nonEmpty(input.storagePath),
        width: positiveInt(input.width),
        height: positiveInt(input.height),
        contentHash: String(input.contentHash),
        textContent: nonEmpty(input.textContent),
        extractedBy: ["ocr", "vision", "manual"].includes(input.extractedBy)
          ? input.extractedBy
          : undefined,
        confidence: isNumberInRange(input.confidence, 0, 1)
          ? input.confidence
          : undefined,
      });
    })
    .filter(Boolean);
}

function normalizeEventDraft(input, missingFields) {
  if (!input || typeof input !== "object") return undefined;
  if (
    !isUrl(input.articleUrl) ||
    !nonEmpty(input.extractionAttemptId) ||
    !captureModes.has(input.captureMode) ||
    input.timezone !== "Asia/Shanghai" ||
    input.city !== "Beijing" ||
    !isNumberInRange(input.confidence, 0, 1)
  ) {
    return undefined;
  }
  const signals = new Set(
    Array.isArray(input.signals)
      ? input.signals.filter((signal) => draftSignals.has(signal))
      : [],
  );
  const normalizedMissingFields = Array.isArray(missingFields)
    ? missingFields.filter(nonEmpty)
    : [];
  if (normalizedMissingFields.length > 0) {
    signals.add("missing_required_public_field");
  }
  return removeUndefined({
    articleUrl: input.articleUrl,
    sourceId: nonEmpty(input.sourceId),
    extractionAttemptId: input.extractionAttemptId,
    captureMode: input.captureMode,
    title: nonEmpty(input.title),
    originalTitle: nonEmpty(input.originalTitle),
    organizer: nonEmpty(input.organizer),
    startsAt: isDateTime(input.startsAt) ? input.startsAt : undefined,
    endsAt: isDateTime(input.endsAt) ? input.endsAt : undefined,
    timezone: input.timezone,
    venueName: nonEmpty(input.venueName),
    venueAddress: nonEmpty(input.venueAddress),
    city: input.city,
    reservationStatus: ["required", "not_required", "unknown"].includes(
      input.reservationStatus,
    )
      ? input.reservationStatus
      : undefined,
    registrationAction: nonEmpty(input.registrationAction),
    registrationUrl: isUrl(input.registrationUrl)
      ? input.registrationUrl
      : undefined,
    summary: nonEmpty(input.summary),
    entryNotes: nonEmpty(input.entryNotes),
    signals: [...signals],
    evidenceAssetIds: Array.isArray(input.evidenceAssetIds)
      ? input.evidenceAssetIds.filter(nonEmpty)
      : [],
    fieldEvidence: normalizeFieldEvidence(input.fieldEvidence),
    confidence: input.confidence,
  });
}

function buildAgentSuccessPayloads({ config, seedUrl, runId, response, now }) {
  const observedAt = now.toISOString();
  const sourceRun = envelope({
    collectorId: config.collectorId,
    runId,
    observedAt,
    payload: {
      seedUrl,
      status: ["not_activity", "failed"].includes(response.disposition)
        ? "partial"
        : "success",
      startedAt: new Date(now.getTime() - 60_000).toISOString(),
      finishedAt: observedAt,
      checkedUrlCount: 1,
      articleCount: 1,
      draftCount: response.eventDraft ? 1 : 0,
      failureCount: response.eventDraft ? 0 : 1,
      failureReason: response.eventDraft ? undefined : "not_activity",
      diagnostics: [
        { key: "processor", value: "agent" },
        { key: "disposition", value: response.disposition },
        { key: "confidence", value: String(response.confidence) },
      ],
    },
  });

  const articleSnapshot = envelope({
    collectorId: config.collectorId,
    runId,
    observedAt,
    payload: response.articleSnapshot,
  });
  const evidenceAssets = response.evidenceAssets.map((payload) =>
    envelope({ collectorId: config.collectorId, runId, observedAt, payload }),
  );
  const eventDraft = response.eventDraft
    ? envelope({
        collectorId: config.collectorId,
        runId,
        observedAt,
        payload: response.eventDraft,
      })
    : undefined;
  const collectorFailure = response.eventDraft
    ? undefined
    : buildFailureEnvelope({
        collectorId: config.collectorId,
        runId,
        observedAt,
        articleUrl: response.articleSnapshot.finalUrl,
        reason: response.disposition === "not_activity"
          ? "not_activity"
          : "activity_fields_missing",
        message: response.failure?.message ?? "Agent did not return a draft.",
        retryable: false,
      });

  return removeUndefined({
    sourceRun,
    evidenceAssets,
    articleSnapshot,
    eventDraft,
    collectorFailure,
  });
}

function buildAgentFailurePayloads({
  config,
  seedUrl,
  runId,
  reason,
  stage,
  message,
  retryable,
  now,
}) {
  const observedAt = now.toISOString();
  return {
    sourceRun: envelope({
      collectorId: config.collectorId,
      runId,
      observedAt,
      payload: {
        seedUrl,
        status: "failed",
        startedAt: new Date(now.getTime() - 60_000).toISOString(),
        finishedAt: observedAt,
        checkedUrlCount: 1,
        articleCount: 0,
        draftCount: 0,
        failureCount: 1,
        failureReason: reason,
        diagnostics: [{ key: "processor", value: "agent" }],
      },
    }),
    collectorFailure: buildFailureEnvelope({
      collectorId: config.collectorId,
      runId,
      observedAt,
      articleUrl: seedUrl,
      reason,
      stage,
      message,
      retryable,
    }),
  };
}

function buildFailureEnvelope({
  collectorId,
  runId,
  observedAt,
  articleUrl,
  reason,
  stage = "agent_extraction",
  message,
  retryable,
}) {
  return envelope({
    collectorId,
    runId,
    observedAt,
    payload: {
      articleUrl,
      stage: normalizeFailureStage(stage),
      reason: normalizeFailureReason(reason),
      message: String(message ?? "Agent extraction failed.").slice(0, 2_000),
      retryable: retryable !== false,
    },
  });
}

async function uploadAgentPayloads({ config, fetchImpl, payloads, runId }) {
  const sourceRun = await postJson({
    baseUrl: config.baseUrl,
    path: "/api/collector/source-run",
    headers: config.headers,
    fetchImpl,
    body: payloads.sourceRun,
  });
  const uploadedIds = { sourceRunId: sourceRun.id };

  for (const asset of payloads.evidenceAssets ?? []) {
    const uploaded = await postJson({
      baseUrl: config.baseUrl,
      path: "/api/collector/evidence-asset",
      headers: config.headers,
      fetchImpl,
      body: asset,
    });
    uploadedIds.evidenceAssetIds = [
      ...(uploadedIds.evidenceAssetIds ?? []),
      uploaded.id,
    ];
  }

  if (payloads.articleSnapshot) {
    const articleSnapshot = await postJson({
      baseUrl: config.baseUrl,
      path: "/api/collector/article-snapshot",
      headers: config.headers,
      fetchImpl,
      body: payloads.articleSnapshot,
    });
    uploadedIds.articleSnapshotId = articleSnapshot.id;
  }

  if (payloads.eventDraft) {
    const eventDraft = await postJson({
      baseUrl: config.baseUrl,
      path: "/api/collector/event-draft",
      headers: config.headers,
      fetchImpl,
      body: payloads.eventDraft,
    });
    uploadedIds.eventDraftId = eventDraft.id;
  }

  if (payloads.collectorFailure) {
    const failure = await postJson({
      baseUrl: config.baseUrl,
      path: "/api/collector/failure",
      headers: config.headers,
      fetchImpl,
      body: payloads.collectorFailure,
    });
    uploadedIds.failureId = failure.id;
  }

  return {
    kind: "uploaded",
    runId,
    uploadedIds,
  };
}

async function postJson({ baseUrl, path, headers, fetchImpl, body }) {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`upload_failed:${path}:${response.status}`);
  return data;
}

function readAgentConfig(env) {
  const baseUrl = normalizeBaseUrl(env.COLLECTOR_BASE_URL ?? env.APP_BASE_URL);
  const collectorId = env.COLLECTOR_ID?.trim();
  const collectorApiKey = env.COLLECTOR_API_KEY?.trim();
  const agentBaseUrl = normalizeBaseUrl(env.AGENT_API_BASE_URL);
  const agentApiKey = env.AGENT_API_KEY?.trim();
  if (!baseUrl || !collectorId || !collectorApiKey) {
    throw new Error("missing_collector_config");
  }
  if (!agentBaseUrl || !agentApiKey) throw new Error("agent_config_missing");

  return {
    baseUrl,
    collectorId,
    collectorApiKey,
    headers: createCollectorHeaders({
      collectorId,
      collectorApiKey,
      collectorJobId: env.COLLECTOR_JOB_ID?.trim() || undefined,
    }),
    agentBaseUrl,
    agentApiKey,
    agentModel: env.AGENT_MODEL?.trim() || undefined,
    timeoutMs: Math.max(
      1_000,
      Number.parseInt(env.AGENT_TIMEOUT_SECONDS ?? "120", 10) * 1000,
    ),
    maxAttempts: Math.max(
      1,
      Number.parseInt(env.AGENT_MAX_ATTEMPTS ?? "3", 10) || 3,
    ),
  };
}

function invalidAgentResponse(message) {
  return {
    ok: false,
    reason: "agent_response_invalid_schema",
    stage: "agent_extraction",
    message,
    retryable: true,
  };
}

function envelope({ collectorId, runId, observedAt, payload }) {
  return {
    collectorId,
    runId,
    observedAt,
    payloadVersion,
    payload: removeUndefined(payload),
  };
}

function normalizeBaseUrl(value) {
  return value?.trim().replace(/\/+$/, "") || undefined;
}

function normalizeFailureReason(reason) {
  return failureReasons.has(reason) ? reason : "agent_response_invalid_schema";
}

function normalizeFailureStage(stage) {
  return failureStages.has(stage) ? stage : "agent_extraction";
}

function nonEmpty(value) {
  const stringValue = typeof value === "string" ? value.trim() : "";
  return stringValue || undefined;
}

function isUrl(value) {
  if (!nonEmpty(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isDateTime(value) {
  return (
    typeof value === "string" &&
    /(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isNumberInRange(value, min, max) {
  return typeof value === "number" && value >= min && value <= max;
}

function positiveInt(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function normalizeFieldEvidence(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key, value]) => nonEmpty(key) && Array.isArray(value))
      .map(([key, value]) => [key, value.filter(nonEmpty)]),
  );
}

function removeUndefined(value) {
  if (Array.isArray(value)) return value.map(removeUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, removeUndefined(entryValue)]),
  );
}
