#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

import { createCollectorHeaders } from "./collector-fixture-run.mjs";

const execFileAsync = promisify(execFile);
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
const eventResolutionDecisions = new Set([
  "new_event",
  "same_event",
  "update_existing",
  "cancel_existing",
  "withdraw_existing",
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
  browserObserver,
  reportVercelJob = true,
  now = new Date(),
}) {
  const config = readAgentConfig(env);
  if (!seedUrl) throw new Error("missing_seed_url");
  if (!runId) throw new Error("missing_run_id");
  const runStartedAt = Date.now();

  const observationResult = await observePageWithFailure({
    seedUrl,
    browserObserver,
    now,
    config,
  });
  if (!observationResult.ok) {
    const payloads = buildAgentFailurePayloads({
      config,
      seedUrl,
      runId,
      reason: observationResult.reason,
      stage: observationResult.stage,
      message: observationResult.message,
      retryable: observationResult.retryable,
      now,
      diagnostics: observationResult.diagnostics,
      runStartedAt,
    });
    return uploadAgentPayloads({
      config,
      fetchImpl,
      payloads,
      runId,
      vercelJobId: reportVercelJob ? vercelJobId : undefined,
    });
  }

  if (config.browserSmokeOnly) {
    const payloads = buildBrowserSmokePayloads({
      config,
      seedUrl,
      runId,
      observation: observationResult.observation,
      now,
      diagnostics: observationResult.diagnostics,
      runStartedAt,
    });
    return uploadAgentPayloads({
      config,
      fetchImpl,
      payloads,
      runId,
      vercelJobId: reportVercelJob ? vercelJobId : undefined,
    });
  }

  const agentStartedAt = Date.now();
  const response = await requestModelWithRetries({
    config,
    seedUrl,
    runId,
    vercelJobId,
    observation: observationResult.observation,
    fetchImpl,
  });
  const agentElapsedDiagnostic = {
    key: "timing_agent_request_elapsed_ms",
    value: String(Date.now() - agentStartedAt),
  };
  const diagnostics = [
    ...observationResult.diagnostics,
    agentElapsedDiagnostic,
  ];
  const payloads = response.ok
    ? buildAgentSuccessPayloads({
        config,
        seedUrl,
        runId,
        response: response.data,
        observation: observationResult.observation,
        now,
        diagnostics,
        runStartedAt,
      })
    : buildAgentFailurePayloads({
        config,
        seedUrl,
        runId,
        sourceCandidate: observationResult.observation.sourceCandidate,
        reason: response.reason,
        stage: response.stage,
        message: response.message,
        retryable: response.retryable,
        now,
        diagnostics,
        runStartedAt,
      });

  return uploadAgentPayloads({
    config,
    fetchImpl,
    payloads,
    runId,
    vercelJobId: reportVercelJob ? vercelJobId : undefined,
  });
}

export async function observePageForBenchmark({
  seedUrl,
  runner = "playwright",
  browserObserver,
  now = new Date(),
}) {
  if (!seedUrl) throw new Error("missing_seed_url");
  const startedAt = Date.now();
  const result = await observePageWithFailure({
    seedUrl,
    browserObserver,
    now,
    config: {
      browserRunner: runner === "agent_browser" ? "agent_browser" : "playwright",
    },
  });
  const elapsedMs = Date.now() - startedAt;
  return result.ok
    ? {
        runner,
        ok: true,
        elapsedMs,
        finalUrl: result.observation.finalUrl,
        title: result.observation.title,
        visibleTextLength: result.observation.visibleText?.length ?? 0,
        imageCandidateCount: result.observation.imageCandidates?.length ?? 0,
        diagnostics: [
          ...result.diagnostics,
          { key: "benchmark_total_elapsed_ms", value: String(elapsedMs) },
        ],
      }
    : {
        runner,
        ok: false,
        elapsedMs,
        reason: result.reason,
        stage: result.stage,
        message: result.message,
        retryable: result.retryable,
        diagnostics: [
          ...result.diagnostics,
          { key: "benchmark_total_elapsed_ms", value: String(elapsedMs) },
        ],
      };
}

async function observePageWithFailure({ seedUrl, browserObserver, now, config }) {
  const startedAt = Date.now();
  try {
    const result = await observePage({ seedUrl, browserObserver, now, config });
    return {
      ok: true,
      observation: result.observation,
      diagnostics: [
        { key: "browser_runner", value: config.browserRunner },
        {
          key: "timing_page_observe_elapsed_ms",
          value: String(Date.now() - startedAt),
        },
        ...sandboxSetupDiagnostics(config),
        ...(result.diagnostics ?? []),
      ],
    };
  } catch (error) {
    return {
      ok: false,
      reason: error?.reason ?? "fetch_blocked",
      stage: error?.stage ?? "page_fetch",
      message: error instanceof Error ? error.message : String(error),
      retryable: error?.retryable !== false,
      diagnostics: [
        { key: "browser_runner", value: config.browserRunner },
        {
          key: "timing_page_observe_elapsed_ms",
          value: String(Date.now() - startedAt),
        },
        ...sandboxSetupDiagnostics(config),
      ],
    };
  }
}

async function observePage({ seedUrl, browserObserver, now, config }) {
  if (browserObserver) {
    return {
      observation: normalizePageObservation(
        await browserObserver({ seedUrl, now }),
        {
          seedUrl,
          now,
        },
      ),
      diagnostics: [],
    };
  }

  if (config.browserRunner === "agent_browser") {
    return observePageWithAgentBrowser({ seedUrl, now });
  }

  return observePageWithPlaywright({ seedUrl, now });
}

async function observePageWithPlaywright({ seedUrl, now }) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 1200 } });
    const pageLoadStartedAt = Date.now();
    await page.goto(seedUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const pageLoadElapsedMs = Date.now() - pageLoadStartedAt;
    await autoScroll(page);
    const raw = await page.evaluate(() => {
      const meta = (name) =>
        document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)
          ?.getAttribute("content") || undefined;
      const images = [...document.images]
        .map((image) => ({
          url: image.currentSrc || image.src,
          width: image.naturalWidth || image.width || undefined,
          height: image.naturalHeight || image.height || undefined,
        }))
        .filter((image) => image.url);
      return {
        canonicalUrl:
          document.querySelector('link[rel="canonical"]')?.href || location.href,
        finalUrl: location.href,
        title: document.title || meta("og:title"),
        authorName:
          meta("article:author") ||
          document.querySelector("#js_name")?.textContent?.trim(),
        publishedAt:
          meta("article:published_time") ||
          document.querySelector("#publish_time")?.textContent?.trim(),
        visibleText: document.body?.innerText || "",
        imageCandidates: images.slice(0, 24),
      };
    });
    return {
      observation: normalizePageObservation(raw, { seedUrl, now }),
      diagnostics: [
        { key: "timing_page_load_elapsed_ms", value: String(pageLoadElapsedMs) },
      ],
    };
  } finally {
    await browser.close();
  }
}

async function observePageWithAgentBrowser({ seedUrl, now }) {
  const session = `collector-${process.pid}-${Date.now()}`;
  const pageLoadStartedAt = Date.now();
  await runAgentBrowser(["--session", session, "open", seedUrl, "--json"]);
  await runAgentBrowser([
    "--session",
    session,
    "wait",
    "--load",
    "domcontentloaded",
    "--json",
  ]);
  const pageLoadElapsedMs = Date.now() - pageLoadStartedAt;
  await runAgentBrowser(["--session", session, "eval", autoScrollScript(), "--json"]);
  const extracted = await runAgentBrowser([
    "--session",
    session,
    "eval",
    pageExtractionScript(),
    "--json",
  ]);
  const raw = extracted?.data?.result ?? extracted?.result ?? {};
  return {
    observation: normalizePageObservation(raw, { seedUrl, now }),
    diagnostics: [
      { key: "timing_page_load_elapsed_ms", value: String(pageLoadElapsedMs) },
    ],
  };
}

async function runAgentBrowser(args) {
  try {
    const { stdout } = await execFileAsync("agent-browser", args, {
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const data = JSON.parse(stdout || "{}");
    if (data?.success === false) {
      throw new Error(data.error ?? "agent_browser_command_failed");
    }
    return data;
  } catch (error) {
    throw Object.assign(
      new Error(`agent_browser_failed:${error instanceof Error ? error.message : String(error)}`),
      {
        reason: "fetch_blocked",
        stage: "page_fetch",
        retryable: true,
      },
    );
  }
}

function autoScrollScript() {
  return `(async () => {
  const delay = (ms) => new Promise((innerResolve) => setTimeout(innerResolve, ms));
  const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
  for (let y = 0; y < document.body.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await delay(150);
  }
  window.scrollTo(0, 0);
  return true;
})()`;
}

function pageExtractionScript() {
  return `(() => {
  const meta = (name) =>
    document.querySelector(\`meta[property="\${name}"], meta[name="\${name}"]\`)
      ?.getAttribute("content") || undefined;
  const images = [...document.images]
    .map((image) => ({
      url: image.currentSrc || image.src,
      width: image.naturalWidth || image.width || undefined,
      height: image.naturalHeight || image.height || undefined,
    }))
    .filter((image) => image.url);
  return {
    canonicalUrl:
      document.querySelector('link[rel="canonical"]')?.href || location.href,
    finalUrl: location.href,
    title: document.title || meta("og:title"),
    authorName:
      meta("article:author") ||
      document.querySelector("#js_name")?.textContent?.trim(),
    publishedAt:
      meta("article:published_time") ||
      document.querySelector("#publish_time")?.textContent?.trim(),
    visibleText: document.body?.innerText || "",
    imageCandidates: images.slice(0, 24),
  };
})()`;
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await delay(150);
    }
    window.scrollTo(0, 0);
  });
}

async function requestModelWithRetries({
  config,
  seedUrl,
  runId,
  vercelJobId,
  observation,
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
      const data = await requestOpenAI({
        config,
        seedUrl,
        runId,
        vercelJobId,
        observation,
        fetchImpl,
        attempt,
      });
      const parsed = parseAgentResponse(parseOpenAIJson(data), {
        publicAssetUrlPrefixes: config.publicAssetUrlPrefixes,
        articleSnapshotFallback: articleSnapshotFromObservation(observation),
        eventDraftDefaults: {
          extractionAttemptId: `${runId}-agent`,
          timezone: "Asia/Shanghai",
          city: "Beijing",
        },
      });
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

async function requestOpenAI({
  config,
  seedUrl,
  runId,
  vercelJobId,
  observation,
  fetchImpl,
  attempt,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const request = buildAgentModelRequest({
      config,
      seedUrl,
      runId,
      vercelJobId,
      observation,
      attempt,
    });
    const response = await fetchImpl(request.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${config.openaiApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request.body),
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

function buildAgentModelRequest({
  config,
  seedUrl,
  runId,
  vercelJobId,
  observation,
  attempt,
}) {
  const messages = buildAgentMessages({
    config,
    seedUrl,
    runId,
    vercelJobId,
    observation,
    attempt,
  });
  if (config.agentApiStyle === "chat_completions") {
    return {
      url: `${config.openaiBaseUrl}/chat/completions`,
      body: removeUndefined({
        model: config.openaiModel,
        response_format: { type: "json_object" },
        messages,
      }),
    };
  }

  return {
    url: `${config.openaiBaseUrl}/responses`,
    body: removeUndefined({
      model: config.openaiModel,
      text: {
        format: collectorAgentResponseTextFormat(),
      },
      input: messages,
    }),
  };
}

function buildAgentMessages({
  config,
  seedUrl,
  runId,
  vercelJobId,
  observation,
  attempt,
}) {
  return [
    {
      role: "system",
      content:
        "Extract admin-curated Beijing activity data. Return only JSON matching the collector agent response contract. Preserve multi-day or repeated daily hours in eventDraft.scheduleText when the source describes them. If an image is an event poster or campaign visual containing the activity title, date, venue, or main promotional artwork, preserve the original article image URL in eventDraft.posterImageSourceUrl and add useful poster evidence. Only set eventDraft.posterImageUrl when the URL is an app-owned public asset URL that was already uploaded to the configured public asset store; never put WeChat/source-site image URLs in posterImageUrl. Do not classify QR-only images, account avatars, decorative dividers, emoji art, or unrelated article images as posters.",
    },
    {
      role: "user",
      content: JSON.stringify({
        seedUrl,
        runId,
        collectorId: config.collectorId,
        vercelJobId,
        attempt,
        observation,
      }),
    },
  ];
}

function collectorAgentResponseTextFormat() {
  return {
    type: "json_schema",
    name: "collector_agent_response",
    description:
      "Normalized collector response for one Beijing activity source page.",
    strict: false,
    schema: {
      type: "object",
      additionalProperties: true,
      required: ["status", "disposition"],
      properties: {
        status: { type: "string", enum: ["success", "failure"] },
        disposition: { type: "string", enum: [...dispositions] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        missingFields: { type: "array", items: { type: "string" } },
        sourceCandidate: {
          type: "object",
          additionalProperties: true,
        },
        articleSnapshot: {
          type: "object",
          additionalProperties: true,
        },
        evidenceAssets: {
          type: "array",
          items: { type: "object", additionalProperties: true },
        },
        eventDraft: {
          type: "object",
          additionalProperties: true,
        },
        failure: {
          type: "object",
          additionalProperties: true,
        },
      },
    },
  };
}

function parseOpenAIJson(data) {
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

function parseAgentResponse(data, options = {}) {
  data = normalizeAgentResponseEnvelope(data);
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
  const articleSnapshot =
    normalizeArticleSnapshot(data.articleSnapshot) ??
    (data.eventDraft
      ? normalizeArticleSnapshot(options.articleSnapshotFallback)
      : undefined);
  if (!articleSnapshot) {
    return invalidAgentResponse("Agent response missed article snapshot.");
  }

  if (!["not_activity", "failed"].includes(data.disposition)) {
    const eventDraft = normalizeEventDraft(
      data.eventDraft,
      data.missingFields,
      {
        ...options,
        eventDraftDefaults: {
          ...options.eventDraftDefaults,
          articleUrl: articleSnapshot.finalUrl,
          captureMode: articleSnapshot.captureMode,
          confidence: data.confidence,
        },
      },
    );
    if (!eventDraft) {
      return invalidAgentResponse("Agent response missed valid event draft.");
    }
    return {
      ok: true,
      data: {
        disposition: data.disposition,
        confidence: data.confidence,
        sourceCandidate: normalizeSourceCandidate(data.sourceCandidate),
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
        sourceCandidate: normalizeSourceCandidate(data.sourceCandidate),
        articleSnapshot,
        evidenceAssets: normalizeEvidenceAssets(data.evidenceAssets ?? []),
        failure: data.failure,
    },
  };
}

function normalizeAgentResponseEnvelope(data) {
  if (!data || typeof data !== "object") return data;
  const normalized = { ...data };
  if (!normalized.status) {
    if (normalized.failure) {
      normalized.status = "failure";
    } else if (normalized.articleSnapshot || normalized.eventDraft) {
      normalized.status = "success";
    }
  }
  if (
    normalized.status === "success" &&
    !dispositions.has(normalized.disposition)
  ) {
    normalized.disposition = normalized.eventDraft
      ? "ready_for_review"
      : "not_activity";
  }
  if (
    normalized.status === "success" &&
    !isNumberInRange(normalized.confidence, 0, 1)
  ) {
    if (isNumberInRange(normalized.eventDraft?.confidence, 0, 1)) {
      normalized.confidence = normalized.eventDraft.confidence;
    } else if (isNumberInRange(normalized.sourceCandidate?.confidence, 0, 1)) {
      normalized.confidence = normalized.sourceCandidate.confidence;
    } else {
      normalized.confidence = 0.5;
    }
  }
  return normalized;
}

function normalizePageObservation(input, { seedUrl, now }) {
  const finalUrl = isUrl(input?.finalUrl) ? input.finalUrl : seedUrl;
  const canonicalUrl = isUrl(input?.canonicalUrl) ? input.canonicalUrl : finalUrl;
  const capturedAt = isDateTime(input?.capturedAt)
    ? input.capturedAt
    : now.toISOString();
  const visibleText = String(input?.visibleText ?? "").slice(0, 40_000);
  const authorName = nonEmpty(input?.authorName);
  const sourceCandidate =
    input?.sourceCandidate && typeof input.sourceCandidate === "object"
      ? normalizeSourceCandidate(input.sourceCandidate, { seedUrl, authorName })
      : inferSourceCandidate({ seedUrl, authorName });

  return removeUndefined({
    canonicalUrl,
    finalUrl,
    title: nonEmpty(input?.title),
    authorName,
    publishedAt: isDateTime(input?.publishedAt) ? input.publishedAt : undefined,
    capturedAt,
    visibleText,
    languageHints: Array.isArray(input?.languageHints)
      ? input.languageHints.filter(nonEmpty)
      : inferLanguageHints(visibleText),
    imageCandidates: Array.isArray(input?.imageCandidates)
      ? input.imageCandidates
          .filter((image) => isUrl(image?.url))
          .slice(0, 24)
          .map((image) =>
            removeUndefined({
              url: image.url,
              width: positiveInt(image.width),
              height: positiveInt(image.height),
            }),
          )
      : [],
    sourceCandidate,
  });
}

function normalizeSourceCandidate(input, fallback = {}) {
  if (!input || typeof input !== "object") return undefined;
  const sourceKey = nonEmpty(input.sourceKey) ?? sourceKeyFromName(fallback.authorName);
  const platform = nonEmpty(input.platform) ?? inferPlatform(fallback.seedUrl);
  if (!sourceKey || !platform) return undefined;
  return removeUndefined({
    sourceKey,
    name: nonEmpty(input.name) ?? nonEmpty(fallback.authorName),
    homepageUrl: isUrl(input.homepageUrl) ? input.homepageUrl : undefined,
    seedUrl: isUrl(input.seedUrl)
      ? input.seedUrl
      : isUrl(fallback.seedUrl)
        ? fallback.seedUrl
        : undefined,
    platform,
    confidence: isNumberInRange(input.confidence, 0, 1)
      ? input.confidence
      : undefined,
    diagnostics: Array.isArray(input.diagnostics)
      ? input.diagnostics
          .filter((item) => nonEmpty(item?.key) && nonEmpty(item?.value))
          .map((item) => ({ key: item.key, value: item.value }))
      : undefined,
  });
}

function inferSourceCandidate({ seedUrl, authorName }) {
  const sourceKey = sourceKeyFromName(authorName);
  if (!sourceKey) return undefined;
  return {
    sourceKey,
    name: authorName,
    seedUrl,
    platform: inferPlatform(seedUrl),
    confidence: 0.65,
    diagnostics: [{ key: "source_name_evidence", value: "article author name" }],
  };
}

function sourceKeyFromName(name) {
  const value = nonEmpty(name);
  if (!value) return undefined;
  return `wechat:${value.toLowerCase().replace(/\s+/g, "-")}`;
}

function inferPlatform(url) {
  return String(url ?? "").includes("mp.weixin.qq.com")
    ? "wechat_official_account"
    : "official_website";
}

function inferLanguageHints(text) {
  return /[\u4e00-\u9fff]/.test(text) ? ["zh-CN"] : [];
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

function normalizeEventDraft(input, missingFields, options = {}) {
  if (!input || typeof input !== "object") return undefined;
  input = applyEventDraftDefaults(input, options.eventDraftDefaults);
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
  const posterImageUrl = normalizePublicPosterImageUrl(
    input.posterImageUrl,
    options.publicAssetUrlPrefixes,
  );
  const posterImageSourceUrl =
    isUrl(input.posterImageSourceUrl)
      ? input.posterImageSourceUrl
      : isUrl(input.posterImageUrl) && !posterImageUrl
        ? input.posterImageUrl
        : undefined;

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
    scheduleText: nonEmpty(input.scheduleText),
    posterImageUrl,
    posterImageAlt: nonEmpty(input.posterImageAlt),
    posterImageSourceUrl,
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

function applyEventDraftDefaults(input, defaults = {}) {
  return {
    ...input,
    articleUrl: isUrl(input.articleUrl)
      ? input.articleUrl
      : defaults.articleUrl,
    extractionAttemptId:
      nonEmpty(input.extractionAttemptId) ?? defaults.extractionAttemptId,
    captureMode: nonEmpty(input.captureMode) ?? defaults.captureMode,
    timezone: nonEmpty(input.timezone) ?? defaults.timezone,
    city: nonEmpty(input.city) ?? defaults.city,
    confidence: isNumberInRange(input.confidence, 0, 1)
      ? input.confidence
      : defaults.confidence,
  };
}

function normalizePublicPosterImageUrl(value, publicAssetUrlPrefixes = []) {
  if (!isUrl(value)) return undefined;
  if (isTrustedPublicAssetUrl(value, publicAssetUrlPrefixes)) return value;
  return undefined;
}

function isTrustedPublicAssetUrl(value, publicAssetUrlPrefixes = []) {
  const normalizedPrefixes = publicAssetUrlPrefixes
    .map((prefix) => normalizeBaseUrl(prefix))
    .filter(Boolean);
  if (normalizedPrefixes.some((prefix) => value.startsWith(`${prefix}/`))) {
    return true;
  }

  try {
    const url = new URL(value);
    return url.hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

function buildBrowserSmokePayloads({
  config,
  seedUrl,
  runId,
  observation,
  now,
  diagnostics = [],
  runStartedAt,
}) {
  const observedAt = now.toISOString();
  return removeUndefined({
    sourceCandidate: observation.sourceCandidate
      ? envelope({
          collectorId: config.collectorId,
          runId,
          observedAt,
          payload: observation.sourceCandidate,
        })
      : undefined,
    sourceRun: envelope({
      collectorId: config.collectorId,
      runId,
      observedAt,
      payload: {
        seedUrl,
        status: "partial",
        startedAt: new Date(now.getTime() - 60_000).toISOString(),
        finishedAt: observedAt,
        checkedUrlCount: 1,
        articleCount: 1,
        draftCount: 0,
        failureCount: 0,
        diagnostics: [
          { key: "processor", value: "sandbox-browser" },
          { key: "mode", value: "browser_smoke_only" },
          ...withTotalElapsedDiagnostic(diagnostics, runStartedAt),
        ],
      },
    }),
    articleSnapshot: envelope({
      collectorId: config.collectorId,
      runId,
      observedAt,
      payload: articleSnapshotFromObservation(observation),
    }),
  });
}

function buildAgentSuccessPayloads({
  config,
  seedUrl,
  runId,
  response,
  observation,
  now,
  diagnostics = [],
  runStartedAt,
}) {
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
        { key: "processor", value: "sandbox-agent" },
        { key: "disposition", value: response.disposition },
        { key: "confidence", value: String(response.confidence) },
        ...withTotalElapsedDiagnostic(diagnostics, runStartedAt),
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
      diagnostics,
    });

  return removeUndefined({
    sourceCandidate: (response.sourceCandidate ?? observation?.sourceCandidate)
      ? envelope({
          collectorId: config.collectorId,
          runId,
          observedAt,
          payload: response.sourceCandidate ?? observation.sourceCandidate,
        })
      : undefined,
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
  sourceCandidate,
  reason,
  stage,
  message,
  retryable,
  now,
  diagnostics = [],
  runStartedAt,
}) {
  const observedAt = now.toISOString();
  return {
    sourceCandidate: sourceCandidate
      ? envelope({
          collectorId: config.collectorId,
          runId,
          observedAt,
          payload: sourceCandidate,
        })
      : undefined,
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
        diagnostics: [
          { key: "processor", value: "sandbox-agent" },
          ...withTotalElapsedDiagnostic(diagnostics, runStartedAt),
        ],
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
      diagnostics,
    }),
  };
}

function withTotalElapsedDiagnostic(diagnostics, runStartedAt) {
  const values = [...diagnostics];
  if (runStartedAt) {
    values.push({
      key: "timing_total_elapsed_ms",
      value: String(Date.now() - runStartedAt),
    });
  }
  return values;
}

function articleSnapshotFromObservation(observation) {
  return {
    canonicalUrl: observation.canonicalUrl,
    finalUrl: observation.finalUrl,
    title: observation.title,
    authorName: observation.authorName,
    publishedAt: observation.publishedAt,
    capturedAt: observation.capturedAt,
    languageHints: observation.languageHints ?? [],
    captureMode: "text_complete",
    visibleText: observation.visibleText,
    textHash: hashText(observation.visibleText ?? ""),
    evidenceAssetIds: [],
    contentHash: hashText(
      [
        observation.canonicalUrl,
        observation.title ?? "",
        observation.visibleText ?? "",
        JSON.stringify(observation.imageCandidates ?? []),
      ].join("\n"),
    ),
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
  diagnostics = [],
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
      diagnostics,
    },
  });
}

async function uploadAgentPayloads({
  config,
  fetchImpl,
  payloads,
  runId,
  vercelJobId,
}) {
  const uploadedIds = {};
  if (payloads.sourceCandidate) {
    const source = await postJson({
      baseUrl: config.baseUrl,
      path: "/api/collector/source",
      headers: config.headers,
      fetchImpl,
      body: payloads.sourceCandidate,
    });
    uploadedIds.sourceId = source.id;
    attachSourceId(payloads, source.id);
  }

  const sourceRun = await postJson({
    baseUrl: config.baseUrl,
    path: "/api/collector/source-run",
    headers: config.headers,
    fetchImpl,
    body: payloads.sourceRun,
  });
  uploadedIds.sourceRunId = sourceRun.id;

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

  if (payloads.eventDraft && config.eventCandidateLookupEnabled) {
    const lookup = await lookupEventCandidates({
      config,
      fetchImpl,
      eventDraft: payloads.eventDraft.payload,
    });
    if (lookup.ok) {
      uploadedIds.eventCandidateCount = lookup.candidates.length;
    } else {
      uploadedIds.eventCandidateLookupError = lookup.error;
    }
    payloads.eventCandidates = lookup.ok ? lookup.candidates : undefined;
    if (
      config.eventResolutionEnabled &&
      payloads.eventCandidates?.length > 0
    ) {
      const resolution = await resolveEventWithCandidates({
        config,
        fetchImpl,
        eventDraft: payloads.eventDraft.payload,
        eventCandidates: payloads.eventCandidates,
      });
      if (resolution.ok) {
        payloads.eventResolutionDecision = resolution.decision;
        uploadedIds.eventResolutionDecision = resolution.decision.decision;
        if (resolution.decision.decision !== "new_event") {
          addDraftSignal(payloads.eventDraft.payload, "possible_duplicate");
        }
      } else {
        uploadedIds.eventResolutionError = resolution.error;
      }
    }
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

  if (
    payloads.eventDraft &&
    payloads.eventResolutionDecision &&
    payloads.eventResolutionDecision.decision !== "new_event"
  ) {
    const resolution = await postEventResolution({
      config,
      fetchImpl,
      eventDraft: payloads.eventDraft.payload,
      decision: payloads.eventResolutionDecision,
    });
    if (resolution.ok) {
      payloads.eventResolution = resolution.resolution;
      uploadedIds.eventResolutionId = resolution.resolution.id;
      uploadedIds.eventResolutionKind = resolution.resolution.kind;
      if (resolution.resolution.revisionType) {
        uploadedIds.eventResolutionRevisionType =
          resolution.resolution.revisionType;
      }
    } else {
      uploadedIds.eventResolutionError = resolution.error;
    }
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

  if (vercelJobId) {
    await postJson({
      baseUrl: config.baseUrl,
      path: `/api/collector/jobs/${vercelJobId}/report`,
      headers: config.headers,
      fetchImpl,
      body: buildJobReport({
        collectorId: config.collectorId,
        runId,
        uploadedIds,
      }),
    });
  }

  return {
    kind: "uploaded",
    runId,
    uploadedIds,
    ...(payloads.eventCandidates
      ? { eventCandidates: payloads.eventCandidates }
      : {}),
    ...(payloads.eventResolution
      ? { eventResolution: payloads.eventResolution }
      : {}),
  };
}

async function resolveEventWithCandidates({
  config,
  fetchImpl,
  eventDraft,
  eventCandidates,
}) {
  try {
    const data = await requestEventResolutionModel({
      config,
      fetchImpl,
      eventDraft,
      eventCandidates,
    });
    const parsed = parseEventResolutionResponse(parseOpenAIJson(data));
    if (!parsed.ok) return parsed;
    return {
      ok: true,
      decision: parsed.data,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function requestEventResolutionModel({
  config,
  fetchImpl,
  eventDraft,
  eventCandidates,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const request = buildEventResolutionModelRequest({
      config,
      eventDraft,
      eventCandidates,
    });
    const response = await fetchImpl(request.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${config.openaiApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request.body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`event_resolution_request_failed:${response.status}`);
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("event_resolution_request_failed:timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildEventResolutionModelRequest({
  config,
  eventDraft,
  eventCandidates,
}) {
  const messages = [
    {
      role: "system",
      content:
        "Decide whether the extracted Beijing activity draft is a new event or matches an existing candidate. Return only JSON matching the event resolution contract.",
    },
    {
      role: "user",
      content: JSON.stringify({
        eventDraft,
        eventCandidates,
        decisions: [...eventResolutionDecisions],
      }),
    },
  ];

  if (config.agentApiStyle === "chat_completions") {
    return {
      url: `${config.openaiBaseUrl}/chat/completions`,
      body: removeUndefined({
        model: config.openaiModel,
        response_format: { type: "json_object" },
        messages,
      }),
    };
  }

  return {
    url: `${config.openaiBaseUrl}/responses`,
    body: removeUndefined({
      model: config.openaiModel,
      text: {
        format: eventResolutionResponseTextFormat(),
      },
      input: messages,
    }),
  };
}

function eventResolutionResponseTextFormat() {
  return {
    type: "json_schema",
    name: "collector_event_resolution",
    description: "Semantic resolution for one extracted event draft.",
    strict: false,
    schema: {
      type: "object",
      additionalProperties: true,
      required: ["decision", "confidence", "rationale"],
      properties: {
        decision: {
          type: "string",
          enum: [...eventResolutionDecisions],
        },
        canonicalEventId: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        rationale: { type: "string" },
        proposedChanges: {
          type: "object",
          additionalProperties: true,
        },
        sourceEvidence: {
          type: "object",
          additionalProperties: true,
        },
      },
    },
  };
}

function parseEventResolutionResponse(data) {
  if (!data || typeof data !== "object") {
    return { ok: false, error: "event_resolution_invalid_response" };
  }
  if (!eventResolutionDecisions.has(data.decision)) {
    return { ok: false, error: "event_resolution_invalid_decision" };
  }
  if (!isNumberInRange(data.confidence, 0, 1) || !nonEmpty(data.rationale)) {
    return { ok: false, error: "event_resolution_invalid_metadata" };
  }
  if (data.decision !== "new_event" && !nonEmpty(data.canonicalEventId)) {
    return { ok: false, error: "event_resolution_missing_target" };
  }

  return {
    ok: true,
    data: removeUndefined({
      decision: data.decision,
      canonicalEventId: nonEmpty(data.canonicalEventId),
      confidence: data.confidence,
      rationale: String(data.rationale).slice(0, 2_000),
      proposedChanges: isPlainObject(data.proposedChanges)
        ? data.proposedChanges
        : undefined,
      sourceEvidence: isPlainObject(data.sourceEvidence)
        ? data.sourceEvidence
        : undefined,
    }),
  };
}

async function postEventResolution({ config, fetchImpl, eventDraft, decision }) {
  try {
    const data = await postJson({
      baseUrl: config.baseUrl,
      path: "/api/collector/event-resolution",
      headers: config.headers,
      fetchImpl,
      body: buildEventResolutionUploadBody({ eventDraft, decision }),
    });
    return {
      ok: true,
      resolution: data.resolution,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildEventResolutionUploadBody({ eventDraft, decision }) {
  return removeUndefined({
    decision: decision.decision,
    eventDraftId: createStableCollectorObjectId("draft", [
      eventDraft.articleUrl,
      eventDraft.extractionAttemptId,
    ]),
    canonicalEventId: decision.canonicalEventId,
    confidence: decision.confidence,
    rationale: decision.rationale,
    proposedChanges: decision.proposedChanges,
    sourceEvidence: decision.sourceEvidence,
  });
}

function addDraftSignal(eventDraft, signal) {
  const signals = new Set(eventDraft.signals ?? []);
  signals.add(signal);
  eventDraft.signals = [...signals].filter((value) => draftSignals.has(value));
}

async function lookupEventCandidates({ config, fetchImpl, eventDraft }) {
  try {
    const data = await postJson({
      baseUrl: config.baseUrl,
      path: "/api/collector/event-candidates",
      headers: config.headers,
      fetchImpl,
      body: buildEventCandidateLookupRequest(eventDraft),
    });
    return {
      ok: true,
      candidates: Array.isArray(data.candidates) ? data.candidates : [],
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildEventCandidateLookupRequest(eventDraft) {
  return removeUndefined({
    title: eventDraft.title,
    organizer: eventDraft.organizer,
    startsAt: eventDraft.startsAt,
    endsAt: eventDraft.endsAt,
    venueName: eventDraft.venueName,
    venueAddress: eventDraft.venueAddress,
    sourceUrl: eventDraft.articleUrl,
    limit: 10,
  });
}

function createStableCollectorObjectId(prefix, parts) {
  const hash = createHash("sha256")
    .update(parts.join("\u001f"))
    .digest("hex")
    .slice(0, 24);
  return `${prefix}-${hash}`;
}

function buildJobReport({ collectorId, runId, uploadedIds }) {
  const failed = Boolean(uploadedIds.failureId && !uploadedIds.eventDraftId);
  return removeUndefined({
    collectorId,
    localRunId: runId,
    status: failed ? "failed" : "completed",
    sourceRunId: uploadedIds.sourceRunId,
    articleSnapshotIds: uploadedIds.articleSnapshotId
      ? [uploadedIds.articleSnapshotId]
      : undefined,
    eventDraftIds: uploadedIds.eventDraftId
      ? [uploadedIds.eventDraftId]
      : undefined,
    evidenceAssetIds: uploadedIds.evidenceAssetIds,
    failureIds: uploadedIds.failureId ? [uploadedIds.failureId] : undefined,
    suggestedDisposition: failed ? "failed" : "ready_for_review",
  });
}

function attachSourceId(payloads, sourceId) {
  for (const key of [
    "sourceRun",
    "articleSnapshot",
    "eventDraft",
    "collectorFailure",
  ]) {
    if (payloads[key]?.payload && !payloads[key].payload.sourceId) {
      payloads[key].payload.sourceId = sourceId;
    }
  }
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
  const browserSmokeOnly = env.COLLECTOR_BROWSER_SMOKE_ONLY === "true";
  const browserRunner =
    env.COLLECTOR_BROWSER_RUNNER?.trim() === "playwright"
      ? "playwright"
      : "agent_browser";
  const agentProvider = env.AGENT_PROVIDER?.trim();
  const openaiApiKey = env.OPENAI_API_KEY?.trim();
  const openaiModel = env.OPENAI_MODEL?.trim();
  const configuredApiStyle =
    env.AGENT_API_STYLE?.trim() || env.OPENAI_API_STYLE?.trim();
  const agentApiStyle =
    configuredApiStyle === "chat_completions"
      ? "chat_completions"
      : "responses";
  if (!baseUrl || !collectorId || !collectorApiKey) {
    throw new Error("missing_collector_config");
  }
  if (!browserSmokeOnly) {
    if (agentProvider !== "openai" || !openaiApiKey || !openaiModel) {
      throw new Error("agent_config_missing");
    }
  }

  return {
    baseUrl,
    collectorId,
    collectorApiKey,
    headers: createCollectorHeaders({
      collectorId,
      collectorApiKey,
      collectorJobId: env.COLLECTOR_JOB_ID?.trim() || undefined,
    }),
    browserSmokeOnly,
    browserRunner,
    eventCandidateLookupEnabled: env.AGENT_EVENT_CANDIDATE_LOOKUP === "true",
    eventResolutionEnabled: env.AGENT_EVENT_RESOLUTION_ENABLED === "true",
    publicAssetUrlPrefixes: parseCsv(env.PUBLIC_ASSET_URL_PREFIXES),
    sandboxSetupStartedAt: parseTimestampMs(env.SANDBOX_SETUP_STARTED_AT),
    sandboxBrowserReadyAt: parseTimestampMs(env.SANDBOX_BROWSER_READY_AT),
    agentProvider,
    agentApiStyle,
    openaiBaseUrl: normalizeBaseUrl(
      env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    ),
    openaiApiKey,
    openaiModel,
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

function sandboxSetupDiagnostics(config) {
  if (!config.sandboxSetupStartedAt || !config.sandboxBrowserReadyAt) return [];
  const elapsed = String(
    config.sandboxBrowserReadyAt - config.sandboxSetupStartedAt,
  );
  return [
    { key: "timing_sandbox_setup_elapsed_ms", value: elapsed },
    { key: "timing_browser_ready_elapsed_ms", value: elapsed },
  ];
}

function parseTimestampMs(value) {
  const number = Number.parseInt(value ?? "", 10);
  return Number.isFinite(number) && number > 0 ? number : undefined;
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

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeFailureReason(reason) {
  if (failureReasons.has(reason)) return reason;
  const normalized = String(reason ?? "").toLowerCase();
  if (
    normalized.includes("captcha") ||
    normalized.includes("verification") ||
    normalized.includes("verify")
  ) {
    return "captcha_required";
  }
  if (normalized.includes("block") || normalized.includes("forbidden")) {
    return "fetch_blocked";
  }
  return "agent_response_invalid_schema";
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

function hashText(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function isNumberInRange(value, min, max) {
  return typeof value === "number" && value >= min && value <= max;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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
