#!/usr/bin/env node

import { createHash } from "node:crypto";

import { createCollectorHeaders } from "./collector-fixture-run.mjs";

const payloadVersion = "2026-05-collector-v1";
const maxVisibleTextLength = 40_000;
const failureReasons = new Set([
  "fetch_blocked",
  "fetch_timeout",
  "login_required",
  "captcha_required",
  "parser_mismatch",
  "source_identity_missing",
  "activity_fields_missing",
  "image_download_failed",
  "ocr_failed",
  "vision_failed",
  "not_activity",
  "unsupported",
]);
const failureStages = new Set([
  "source_discovery",
  "page_fetch",
  "dom_parse",
  "image_capture",
  "ocr",
  "vision_extraction",
  "draft_extraction",
  "upload",
]);

export async function capturePage({
  seedUrl,
  fetchImpl = fetch,
  now = new Date(),
}) {
  const response = await fetchImpl(seedUrl, {
    headers: {
      "user-agent":
        "Mozilla/5.0 LocalActivitiesCollector/0.1 (+https://local-activities)",
    },
  });

  if (!response.ok) {
    return {
      kind: "failure",
      seedUrl,
      finalUrl: response.url || seedUrl,
      stage: "page_fetch",
      reason: mapFetchFailure(response.status),
      message: `HTTP ${response.status}`,
      retryable: response.status >= 500 || response.status === 408,
      capturedAt: now.toISOString(),
    };
  }

  const html = await response.text();
  const title = extractTitle(html);
  const visibleText = extractVisibleText(html).slice(0, maxVisibleTextLength);
  const images = extractImages(html, response.url || seedUrl);
  const captureModeHint = classifyCaptureMode({ visibleText, images });
  const finalUrl = response.url || seedUrl;
  const pageFailure = detectPageFailure(visibleText);
  if (pageFailure) {
    return {
      kind: "failure",
      seedUrl,
      finalUrl,
      stage: "page_fetch",
      reason: pageFailure.reason,
      message: pageFailure.message,
      retryable: true,
      capturedAt: now.toISOString(),
    };
  }

  return {
    kind: "captured",
    seedUrl,
    finalUrl,
    title,
    visibleText,
    languageHints: inferLanguageHints(visibleText),
    images,
    capturedAt: now.toISOString(),
    captureModeHint,
    contentHash: hash([finalUrl, title, visibleText, JSON.stringify(images)]),
  };
}

export async function capturePageWithBrowser({
  seedUrl,
  browserAdapter,
  imageAnalyzer,
  profileDir = ".collector-profile",
  now = new Date(),
}) {
  try {
    const page = await (browserAdapter ?? defaultBrowserAdapter)({
      seedUrl,
      profileDir,
      now,
    });
    const finalUrl = page.finalUrl || seedUrl;
    const title = page.title || undefined;
    const visibleText = (page.visibleText ?? "").slice(0, maxVisibleTextLength);
    const images = normalizeBrowserImages(page.images ?? [], finalUrl);
    const pageFailure = detectPageFailure(visibleText);
    if (pageFailure) {
      return {
        kind: "failure",
        seedUrl,
        finalUrl,
        stage: "page_fetch",
        reason: pageFailure.reason,
        message: pageFailure.message,
        retryable: true,
        capturedAt: now.toISOString(),
      };
    }

    const analyzed = imageAnalyzer
      ? await imageAnalyzer({ seedUrl, finalUrl, title, visibleText, images })
      : {};
    const evidenceTexts = normalizeEvidenceTexts(
      analyzed?.evidenceTexts ?? page.evidenceTexts ?? [],
    );

    return {
      kind: "captured",
      seedUrl,
      finalUrl,
      title,
      visibleText,
      languageHints: inferLanguageHints(visibleText),
      images,
      evidenceTexts,
      capturedAt: now.toISOString(),
      captureModeHint: classifyCaptureMode({ visibleText, images }),
      contentHash: hash([
        finalUrl,
        title,
        visibleText,
        JSON.stringify(images),
        JSON.stringify(evidenceTexts),
      ]),
    };
  } catch (error) {
    return captureFailureFromError({ error, seedUrl, now });
  }
}

export function createVisionImageAnalyzer({
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const config = readVisionAnalyzerConfig(env);
  if (!config) return undefined;

  return async ({ finalUrl, title, visibleText, images = [] }) => {
    const imageInputs = images
      .filter((image) => ["poster", "qr", "article_image"].includes(image.role))
      .slice(0, 6);
    if (imageInputs.length === 0) return { evidenceTexts: [] };

    const prompt = buildVisionAnalyzerPrompt({
      finalUrl,
      title,
      visibleText,
      images: imageInputs,
    });
    const response = await fetchImpl(
      `${config.apiBaseUrl}/${config.endpointStyle === "chat_completions" ? "chat/completions" : "responses"}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(
          config.endpointStyle === "chat_completions"
            ? buildVisionChatBody({ config, prompt, imageInputs })
            : buildVisionResponsesBody({ config, prompt, imageInputs }),
        ),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw visionAnalyzerError(`vision_request_failed:${response.status}`);
    }

    return {
      evidenceTexts: parseVisionAnalyzerResponse(data),
    };
  };
}

export function mapInferenceToCollectorPayloads({
  collectorId,
  runId,
  now = new Date(),
  capture,
  inference,
}) {
  const observedAt = now.toISOString();
  const sourceRun = envelope({
    collectorId,
    runId,
    observedAt,
    payload: {
      seedUrl: capture.seedUrl,
      status: isFailureDisposition(inference.disposition) ? "partial" : "success",
      startedAt: new Date(now.getTime() - 60_000).toISOString(),
      finishedAt: observedAt,
      checkedUrlCount: 1,
      articleCount: 1,
      draftCount: isFailureDisposition(inference.disposition) ? 0 : 1,
      failureCount: isFailureDisposition(inference.disposition) ? 1 : 0,
      failureReason: isFailureDisposition(inference.disposition)
        ? "not_activity"
        : undefined,
      diagnostics: [
        {
          key: "processor",
          value: "extract",
        },
        {
          key: "disposition",
          value: inference.disposition,
        },
      ],
    },
  });

  const evidenceAssets = buildEvidenceAssets({
    collectorId,
    runId,
    capture,
  });
  const articleSnapshot = envelope({
    collectorId,
    runId,
    observedAt,
    payload: {
      canonicalUrl: capture.seedUrl,
      finalUrl: capture.finalUrl,
      title: capture.title,
      capturedAt: capture.capturedAt,
      languageHints: capture.languageHints,
      captureMode: normalizeCaptureMode(
        inference.captureMode ?? capture.captureModeHint,
      ),
      visibleText: capture.visibleText || undefined,
      textHash: capture.visibleText ? hash(capture.visibleText) : undefined,
      evidenceAssetIds: evidenceAssets.map((asset) => asset.payload.assetId),
      contentHash: capture.contentHash,
    },
  });

  if (isFailureDisposition(inference.disposition)) {
    return {
      sourceRun,
      articleSnapshot,
      evidenceAssets,
      collectorFailure: envelope({
        collectorId,
        runId,
        observedAt,
        payload: {
          articleUrl: capture.finalUrl,
          stage: "draft_extraction",
          reason: "not_activity",
          message:
            inference.disposition === "expired"
              ? "Source appears expired for default public listing."
              : "Source is not an activity.",
          retryable: false,
          diagnostics: [
            {
              key: "disposition",
              value: inference.disposition,
            },
          ],
        },
      }),
    };
  }

  return {
    sourceRun,
    articleSnapshot,
    evidenceAssets,
    eventDraft: envelope({
      collectorId,
      runId,
      observedAt,
      payload: {
        articleUrl: capture.finalUrl,
        extractionAttemptId: `${runId}-extract`,
        captureMode: normalizeCaptureMode(
          inference.captureMode ?? capture.captureModeHint,
        ),
        title: inference.title,
        originalTitle: inference.originalTitle ?? inference.title,
        organizer: inference.organizer,
        startsAt: inference.startsAt,
        endsAt: inference.endsAt,
        timezone: inference.timezone ?? "Asia/Shanghai",
        venueName: inference.venueName,
        venueAddress: inference.venueAddress,
        city: inference.city ?? "Beijing",
        reservationStatus: inference.reservationStatus,
        registrationAction: inference.registrationAction,
        registrationUrl: inference.registrationUrl,
        summary: inference.summary,
        entryNotes: inference.entryNotes,
        signals: normalizeSignals(inference),
        evidenceAssetIds: evidenceAssets.map((asset) => asset.payload.assetId),
        fieldEvidence: inference.fieldEvidence ?? {},
        confidence: clampConfidence(inference.confidence),
      },
    }),
  };
}

export function buildExtractionFailure({
  collectorId,
  runId,
  articleUrl,
  stage,
  reason,
  message,
  retryable,
  now = new Date(),
}) {
  return envelope({
    collectorId,
    runId,
    observedAt: now.toISOString(),
    payload: {
      articleUrl,
      stage,
      reason,
      message,
      retryable,
    },
  });
}

export async function runCollectorExtract({
  env = process.env,
  seedUrl,
  runId,
  fetchImpl = fetch,
  inference,
  browserAdapter,
  imageAnalyzer,
  now = new Date(),
}) {
  const config = readExtractConfig(env);
  if (!seedUrl) throw new Error("missing_seed_url");
  if (!runId) throw new Error("missing_run_id");

  const capture = config.captureAdapter === "browser"
    ? await capturePageWithBrowser({
        seedUrl,
        browserAdapter,
        imageAnalyzer: imageAnalyzer
          ?? createVisionImageAnalyzer({ env, fetchImpl }),
        profileDir: config.browserProfileDir,
        now,
      })
    : await capturePage({ seedUrl, fetchImpl, now });
  if (capture.kind === "failure") {
    const failure = buildExtractionFailure({
      collectorId: config.collectorId,
      runId,
      articleUrl: capture.finalUrl,
      stage: capture.stage,
      reason: capture.reason,
      message: capture.message,
      retryable: capture.retryable,
      now,
    });
    return uploadExtractPayloads({
      config,
      fetchImpl,
      payloads: {
        sourceRun: buildFailedSourceRun({
          collectorId: config.collectorId,
          runId,
          seedUrl,
          reason: capture.reason,
          now,
        }),
        collectorFailure: failure,
      },
      runId,
    });
  }

  const inferenceResult = inference
    ? await inference({ capture, env, now })
    : await inferWithTextProvider({ capture, env, fetchImpl });
  const payloads = mapInferenceToCollectorPayloads({
    collectorId: config.collectorId,
    runId,
    now,
    capture,
    inference: inferenceResult,
  });

  return uploadExtractPayloads({ config, fetchImpl, payloads, runId });
}

async function uploadExtractPayloads({ config, fetchImpl, payloads, runId }) {
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

async function inferWithTextProvider({ capture, env, fetchImpl }) {
  const apiBaseUrl = env.TEXT_INFERENCE_API_BASE_URL?.trim();
  const apiKey = env.TEXT_INFERENCE_API_KEY?.trim();
  const model = env.TEXT_INFERENCE_MODEL?.trim();
  if (!apiBaseUrl || !apiKey || !model) throw new Error("agent_config_missing");

  const endpointStyle = normalizeEndpointStyle(
    env.TEXT_INFERENCE_ENDPOINT_STYLE,
  );
  const prompt = buildInferencePrompt(capture);
  const response = await fetchImpl(`${apiBaseUrl.replace(/\/+$/, "")}/${endpointStyle === "chat_completions" ? "chat/completions" : "responses"}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(
      endpointStyle === "chat_completions"
        ? {
            model,
            messages: [{ role: "user", content: prompt }],
          }
        : {
            model,
            input: prompt,
          },
    ),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`agent_request_failed:${response.status}`);

  return parseInferenceResponse(data);
}

function buildInferencePrompt(capture) {
  return [
    "Extract one Beijing cultural activity from this source page.",
    "Return strict JSON with disposition, captureMode, fields, fieldEvidence, confidence.",
    `URL: ${capture.finalUrl}`,
    `Title: ${capture.title ?? ""}`,
    `Text: ${capture.visibleText ?? ""}`,
    `Images: ${JSON.stringify(capture.images)}`,
    `Image evidence text: ${JSON.stringify(capture.evidenceTexts ?? [])}`,
  ].join("\n\n");
}

function parseInferenceResponse(data) {
  if (typeof data === "object" && data?.disposition) return data;
  const text =
    data.output_text
    ?? data.choices?.[0]?.message?.content
    ?? data.output?.[0]?.content?.[0]?.text;
  if (!text) throw new Error("agent_response_missing_text");

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("agent_response_invalid_json");
  }
}

function normalizeEndpointStyle(value) {
  const style = value?.trim() || "responses";
  if (style === "chat-completions") return "chat_completions";
  return style;
}

function readVisionAnalyzerConfig(env) {
  const visionConfig = normalizeVisionProviderConfig({
    apiBaseUrl: env.VISION_INFERENCE_API_BASE_URL,
    apiKey: env.VISION_INFERENCE_API_KEY,
    model: env.VISION_INFERENCE_MODEL,
    endpointStyle: env.VISION_INFERENCE_ENDPOINT_STYLE,
  });
  if (visionConfig) return visionConfig;

  const textConfig = normalizeVisionProviderConfig({
    apiBaseUrl: env.TEXT_INFERENCE_API_BASE_URL,
    apiKey: env.TEXT_INFERENCE_API_KEY,
    model: env.TEXT_INFERENCE_MODEL,
    endpointStyle: env.TEXT_INFERENCE_ENDPOINT_STYLE,
  });
  if (textConfig) return textConfig;

  return undefined;
}

function normalizeVisionProviderConfig({
  apiBaseUrl: rawApiBaseUrl,
  apiKey: rawApiKey,
  model: rawModel,
  endpointStyle: rawEndpointStyle,
}) {
  const apiBaseUrl = (rawApiBaseUrl ?? "").trim().replace(/\/+$/, "");
  const apiKey = (rawApiKey ?? "").trim();
  const model = (rawModel ?? "").trim();
  if (!apiBaseUrl || !apiKey || !model) return undefined;
  if (
    isPlaceholder(apiBaseUrl) ||
    isPlaceholder(apiKey) ||
    isPlaceholder(model)
  ) {
    return undefined;
  }

  return {
    apiBaseUrl,
    apiKey,
    model,
    endpointStyle: normalizeEndpointStyle(rawEndpointStyle),
  };
}

function buildVisionAnalyzerPrompt({ finalUrl, title, visibleText, images }) {
  return [
    "Analyze captured event images for a Beijing cultural activity.",
    "Return strict JSON with optional keys: ocrText and visionSummary.",
    "Only summarize visible event facts and registration evidence.",
    `URL: ${finalUrl}`,
    `Title: ${title ?? ""}`,
    `Page text: ${visibleText ?? ""}`,
    `Images: ${JSON.stringify(images.map((image) => ({
      sourceUrl: image.sourceUrl,
      role: image.role,
      alt: image.alt,
    })))}`,
  ].join("\n\n");
}

function buildVisionResponsesBody({ config, prompt, imageInputs }) {
  return {
    model: config.model,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: prompt,
          },
          ...imageInputs.map((image) => ({
            type: "input_image",
            image_url: image.sourceUrl,
            detail: "auto",
          })),
        ],
      },
    ],
  };
}

function buildVisionChatBody({ config, prompt, imageInputs }) {
  return {
    model: config.model,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt,
          },
          ...imageInputs.map((image) => ({
            type: "image_url",
            image_url: {
              url: image.sourceUrl,
            },
          })),
        ],
      },
    ],
  };
}

function parseVisionAnalyzerResponse(data) {
  const text =
    data.output_text
    ?? data.choices?.[0]?.message?.content
    ?? data.output?.[0]?.content?.[0]?.text;
  if (!text) throw visionAnalyzerError("vision_response_missing_text");

  let parsed;
  try {
    parsed = typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    throw visionAnalyzerError("vision_response_invalid_json");
  }

  const evidenceTexts = [];
  if (Array.isArray(parsed.evidenceTexts)) {
    evidenceTexts.push(...parsed.evidenceTexts);
  }
  if (parsed.ocrText) {
    evidenceTexts.push({
      role: "ocr_text",
      textContent: parsed.ocrText,
      extractedBy: "ocr",
      confidence: parsed.ocrConfidence,
    });
  }
  if (parsed.visionSummary) {
    evidenceTexts.push({
      role: "vision_summary",
      textContent: parsed.visionSummary,
      extractedBy: "vision",
      confidence: parsed.visionConfidence,
    });
  }
  if (evidenceTexts.length === 0) {
    throw visionAnalyzerError("vision_response_empty");
  }

  return evidenceTexts;
}

function visionAnalyzerError(message) {
  return Object.assign(new Error(message), {
    reason: "vision_failed",
    stage: "vision_extraction",
    retryable: true,
  });
}

function isPlaceholder(value) {
  return [
    /^replace-with-/i,
    /^https:\/\/your-/i,
    /^provider(?:-[a-z0-9]+)?-model-name$/i,
    /^collector-side-provider-secret$/i,
  ].some((pattern) => pattern.test(value));
}

function buildFailedSourceRun({ collectorId, runId, seedUrl, reason, now }) {
  return envelope({
    collectorId,
    runId,
    observedAt: now.toISOString(),
    payload: {
      seedUrl,
      status: "failed",
      startedAt: new Date(now.getTime() - 60_000).toISOString(),
      finishedAt: now.toISOString(),
      checkedUrlCount: 1,
      articleCount: 0,
      draftCount: 0,
      failureCount: 1,
      failureReason: reason,
    },
  });
}

function buildEvidenceAssets({ collectorId, runId, capture }) {
  const imageAssets = capture.images.map((image, index) =>
    envelope({
      collectorId,
      runId,
      observedAt: capture.capturedAt,
      payload: {
        assetId: `asset-${hash(`${capture.finalUrl}:${image.sourceUrl}:${index}`).slice(0, 16)}`,
        articleUrl: capture.finalUrl,
        role: image.role,
        mediaType: "image",
        sourceUrl: image.sourceUrl,
        width: image.width,
        height: image.height,
        contentHash: hash(`${image.sourceUrl}:${image.alt ?? ""}`),
        confidence: image.role === "qr" ? 0.8 : 0.65,
      },
    }),
  );
  const textAssets = (capture.evidenceTexts ?? []).map((evidence, index) =>
    envelope({
      collectorId,
      runId,
      observedAt: capture.capturedAt,
      payload: {
        assetId: `asset-${hash(`${capture.finalUrl}:${evidence.role}:${evidence.textContent}:${index}`).slice(0, 16)}`,
        articleUrl: capture.finalUrl,
        role: evidence.role,
        mediaType: "text",
        contentHash: hash(evidence.textContent),
        textContent: evidence.textContent,
        extractedBy: evidence.extractedBy,
        confidence: evidence.confidence,
      },
    }),
  );

  return [...imageAssets, ...textAssets];
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

function extractTitle(html) {
  return decodeHtml(matchFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i))
    || decodeHtml(matchFirst(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i))
    || undefined;
}

function extractVisibleText(html) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function extractImages(html, baseUrl) {
  return [...html.matchAll(/<img\b([^>]*)>/gi)]
    .map((match, index) => {
      const attrs = parseAttributes(match[1]);
      const src = attrs.src || attrs["data-src"] || attrs["data-original"];
      if (!src) return undefined;
      const sourceUrl = new URL(src, baseUrl).toString();
      const alt = attrs.alt ?? "";
      return removeUndefined({
        sourceUrl,
        alt,
        role: classifyImageRole({ sourceUrl, alt, index }),
        width: toPositiveNumber(attrs.width),
        height: toPositiveNumber(attrs.height),
      });
    })
    .filter(Boolean);
}

function classifyImageRole({ sourceUrl, alt }) {
  const text = `${sourceUrl} ${alt}`.toLowerCase();
  if (text.includes("qr") || text.includes("二维码")) return "qr";
  if (
    text.includes("poster") ||
    text.includes("invitation") ||
    text.includes("海报")
  ) return "poster";
  return "article_image";
}

function classifyCaptureMode({ visibleText, images }) {
  const hasQr = images.some((image) => image.role === "qr");
  const hasPoster = images.some((image) => image.role === "poster");
  const textLength = visibleText.trim().length;

  if (hasQr && textLength < 80) return "image_with_qr_registration";
  if (hasQr) return "text_with_qr_registration";
  if (hasPoster && textLength < 120) return "image_dominant";
  return "text_complete";
}

function normalizeCaptureMode(value) {
  if (
    [
      "text_complete",
      "text_with_qr_registration",
      "image_dominant",
      "image_with_qr_registration",
      "not_activity",
      "unsupported",
    ].includes(value)
  ) {
    return value;
  }
  return "unsupported";
}

function normalizeSignals(inference) {
  const signals = new Set(inference.signals ?? []);
  if (inference.disposition === "ready_for_review") {
    signals.add("ready_for_review");
  }
  if (inference.disposition === "needs_info") {
    signals.add("missing_required_public_field");
  }
  if (["image_dominant", "image_with_qr_registration"].includes(
    inference.captureMode,
  )) {
    signals.add("image_dominant");
  }
  if (["text_with_qr_registration", "image_with_qr_registration"].includes(
    inference.captureMode,
  )) {
    signals.add("qr_registration");
    signals.add("registration_evidence_required");
  }
  if (inference.secondaryMentions?.length) {
    signals.add("secondary_mention");
  }

  return [...signals];
}

function isFailureDisposition(disposition) {
  return ["not_activity", "expired"].includes(disposition);
}

function mapFetchFailure(status) {
  if (status === 401) return "login_required";
  if (status === 403) return "fetch_blocked";
  if (status === 408 || status === 504) return "fetch_timeout";
  return "fetch_blocked";
}

function detectPageFailure(visibleText) {
  const text = visibleText.toLowerCase();
  if (text.includes("captcha") || visibleText.includes("验证码")) {
    return {
      reason: "captcha_required",
      message: "Page requires captcha verification.",
    };
  }
  if (text.includes("login required") || visibleText.includes("请登录")) {
    return {
      reason: "login_required",
      message: "Page requires login.",
    };
  }
  return undefined;
}

function readExtractConfig(env) {
  const baseUrl = normalizeBaseUrl(
    env.COLLECTOR_BASE_URL ?? env.APP_BASE_URL ?? "",
  );
  const collectorId = env.COLLECTOR_ID?.trim();
  const collectorApiKey = env.COLLECTOR_API_KEY?.trim();
  if (!baseUrl) throw new Error("missing_collector_base_url");
  if (!collectorId) throw new Error("missing_collector_id");
  if (!collectorApiKey) throw new Error("missing_collector_api_key");

  return {
    baseUrl,
    collectorId,
    captureAdapter: normalizeCaptureAdapter(env.COLLECTOR_CAPTURE_ADAPTER),
    browserProfileDir: env.COLLECTOR_BROWSER_PROFILE_DIR?.trim()
      || ".collector-profile",
    headers: createCollectorHeaders({ collectorId, collectorApiKey }),
  };
}

async function defaultBrowserAdapter({ seedUrl, profileDir }) {
  let context;
  try {
    const { chromium } = await import("playwright");
    context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      viewport: { width: 1280, height: 1600 },
    });
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(seedUrl, {
      waitUntil: "networkidle",
      timeout: 45_000,
    });
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        window.scrollTo(0, document.body?.scrollHeight ?? 0);
        setTimeout(resolve, 500);
      });
    });

    return page.evaluate(() => ({
      finalUrl: window.location.href,
      title: document.title || document.querySelector("h1")?.textContent || "",
      visibleText: document.body?.innerText || "",
      images: Array.from(document.images)
        .map((image) => ({
          sourceUrl:
            image.currentSrc ||
            image.src ||
            image.dataset.src ||
            image.dataset.original ||
            "",
          alt: image.alt || "",
          width: image.naturalWidth || image.width || undefined,
          height: image.naturalHeight || image.height || undefined,
        }))
        .filter((image) => image.sourceUrl),
    }));
  } catch (error) {
    if (error?.code === "MODULE_NOT_FOUND" || error?.code === "ERR_MODULE_NOT_FOUND") {
      throw Object.assign(new Error("Playwright is not installed."), {
        reason: "unsupported",
        stage: "page_fetch",
      });
    }
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      reason: error?.name === "TimeoutError" ? "fetch_timeout" : "fetch_blocked",
      stage: "page_fetch",
    });
  } finally {
    await context?.close?.();
  }
}

function normalizeBrowserImages(images, baseUrl) {
  return images
    .map((image, index) => {
      const source = image.sourceUrl || image.src;
      if (!source) return undefined;
      const sourceUrl = new URL(source, baseUrl).toString();
      const alt = image.alt ?? "";
      return removeUndefined({
        sourceUrl,
        alt,
        role: image.role ?? classifyImageRole({ sourceUrl, alt, index }),
        width: toPositiveNumber(image.width),
        height: toPositiveNumber(image.height),
        storagePath: image.storagePath,
      });
    })
    .filter(Boolean);
}

function normalizeEvidenceTexts(evidenceTexts) {
  return evidenceTexts
    .map((evidence) =>
      removeUndefined({
        role: ["ocr_text", "vision_summary"].includes(evidence.role)
          ? evidence.role
          : "vision_summary",
        textContent: String(evidence.textContent ?? "").slice(0, 20_000),
        extractedBy: ["ocr", "vision", "dom", "manual"].includes(
          evidence.extractedBy,
        )
          ? evidence.extractedBy
          : undefined,
        confidence: clampConfidence(evidence.confidence),
      }),
    )
    .filter((evidence) => evidence.textContent);
}

function captureFailureFromError({ error, seedUrl, now }) {
  const reason = failureReasons.has(error?.reason)
    ? error.reason
    : "fetch_blocked";
  const stage = failureStages.has(error?.stage) ? error.stage : "page_fetch";
  return {
    kind: "failure",
    seedUrl,
    finalUrl: error?.finalUrl || seedUrl,
    stage,
    reason,
    message: error instanceof Error ? error.message : String(error),
    retryable: error?.retryable ?? true,
    capturedAt: now.toISOString(),
  };
}

function normalizeCaptureAdapter(value) {
  return value?.trim() === "browser" ? "browser" : "http";
}

async function postJson({ baseUrl, path, headers, fetchImpl, body }) {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `collector_request_failed:${path}:${response.status}:${data.error ?? "unknown"}`,
    );
  }
  return data;
}

function parseAttributes(text) {
  return Object.fromEntries(
    [
      ...text.matchAll(
        /([:@\w-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g,
      ),
    ].map((match) => [
      match[1].toLowerCase(),
      match[3] ?? match[4] ?? match[5] ?? "",
    ]),
  );
}

function matchFirst(text, pattern) {
  return text.match(pattern)?.[1]?.trim() ?? "";
}

function decodeHtml(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function inferLanguageHints(text) {
  const hints = [];
  if (/[a-z]/i.test(text)) hints.push("en");
  if (/[\u4e00-\u9fff]/.test(text)) hints.push("zh");
  return hints.length ? hints : ["und"];
}

function clampConfidence(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function toPositiveNumber(value) {
  const number = Number.parseInt(value ?? "", 10);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function removeUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}
