import { createHash } from "node:crypto";

export const capturedArticleBundleVersion = "captured-article-bundle-v1";
export const captureResultVersion = "capture-result-v1";
export const captureFailureReasons = new Set([
  "login_required",
  "captcha_required",
  "fetch_blocked",
  "not_found",
  "browser_error",
  "source_unhealthy",
]);

export function createCapturedArticleBundle({
  captureId,
  sourceId,
  sourceName,
  provider,
  sourceUrl,
  canonicalUrl,
  finalUrl,
  title,
  authorName,
  publishedAt,
  capturedAt = new Date().toISOString(),
  languageHints = [],
  captureMode = "text_complete",
  text = "",
  html,
  images = [],
  links = [],
  miniPrograms = [],
  diagnostics = [],
  captureWarnings = [],
  contentHash,
}) {
  const requiredSourceUrl = requireUrl(sourceUrl, "sourceUrl");
  const requiredFinalUrl = requireUrl(finalUrl ?? sourceUrl, "finalUrl");
  const normalizedCanonicalUrl = canonicalUrl
    ? requireUrl(canonicalUrl, "canonicalUrl")
    : requiredSourceUrl;
  const normalizedText = String(text ?? "").trim();
  const normalizedHtml = html == null ? undefined : String(html);
  const normalizedImages = images.map(normalizeBundleImage);
  const normalizedLinks = links
    .map((link) => normalizeBundleLink(link, normalizedCanonicalUrl))
    .filter(Boolean);
  const normalizedMiniPrograms = miniPrograms
    .map(normalizeMiniProgram)
    .filter(Boolean);
  const bundle = removeUndefined({
    version: capturedArticleBundleVersion,
    captureId:
      clean(captureId) ??
      createStableId("capture", [requiredSourceUrl, requiredFinalUrl, capturedAt, normalizedText]),
    sourceId: clean(sourceId),
    sourceName: clean(sourceName),
    provider: clean(provider) ?? "unknown",
    sourceUrl: requiredSourceUrl,
    canonicalUrl: normalizedCanonicalUrl,
    finalUrl: requiredFinalUrl,
    title: clean(title),
    authorName: clean(authorName),
    publishedAt: clean(publishedAt),
    capturedAt,
    languageHints: uniqueStrings(languageHints),
    captureMode,
    text: normalizedText,
    html: normalizedHtml,
    images: normalizedImages,
    links: normalizedLinks,
    miniPrograms: normalizedMiniPrograms,
    contentHash:
      clean(contentHash) ??
      hashBundleContent({
        sourceUrl: requiredSourceUrl,
        canonicalUrl: normalizedCanonicalUrl,
        finalUrl: requiredFinalUrl,
        title,
        authorName,
        publishedAt,
        text: normalizedText,
        html: normalizedHtml,
        images: normalizedImages,
        links: normalizedLinks,
        miniPrograms: normalizedMiniPrograms,
      }),
    diagnostics,
    captureWarnings: captureWarnings.map(normalizeCaptureWarning).filter(Boolean),
  });
  validateCapturedArticleBundle(bundle);
  return bundle;
}

export function validateCapturedArticleBundle(bundle) {
  if (bundle?.version !== capturedArticleBundleVersion) {
    throw new Error("captured_bundle_version_invalid");
  }
  if (!clean(bundle.captureId)) throw new Error("captured_bundle_id_required");
  if (!clean(bundle.provider)) throw new Error("captured_bundle_provider_required");
  requireUrl(bundle.sourceUrl, "sourceUrl");
  requireUrl(bundle.canonicalUrl ?? bundle.sourceUrl, "canonicalUrl");
  requireUrl(bundle.finalUrl, "finalUrl");
  if (!clean(bundle.capturedAt)) throw new Error("captured_bundle_captured_at_required");
  if (!hasReadableCaptureMaterial(bundle)) {
    throw new Error("captured_bundle_material_required");
  }
  if (!Array.isArray(bundle.images)) throw new Error("captured_bundle_images_invalid");
  const imageIds = new Set();
  for (const image of bundle.images) {
    if (!clean(image.id)) throw new Error("captured_bundle_image_id_required");
    if (imageIds.has(image.id)) throw new Error("captured_bundle_image_id_duplicate");
    imageIds.add(image.id);
    if (!clean(image.path) && !clean(image.sourceUrl) && !clean(image.storagePath)) {
      throw new Error("captured_bundle_image_location_required");
    }
  }
  if (!Array.isArray(bundle.links)) throw new Error("captured_bundle_links_invalid");
  for (const link of bundle.links) {
    requireUrl(link.url, "linkUrl");
  }
  if (!Array.isArray(bundle.miniPrograms)) {
    throw new Error("captured_bundle_mini_programs_invalid");
  }
  if (!Array.isArray(bundle.diagnostics)) {
    throw new Error("captured_bundle_diagnostics_invalid");
  }
  if (!Array.isArray(bundle.captureWarnings)) {
    throw new Error("captured_bundle_capture_warnings_invalid");
  }
  if (!clean(bundle.contentHash)) throw new Error("captured_bundle_content_hash_required");
  return true;
}

export function createCaptureSuccessResult({
  bundle,
  diagnostics = [],
  captureWarnings = [],
}) {
  validateCapturedArticleBundle(bundle);
  const result = removeUndefined({
    version: captureResultVersion,
    ok: true,
    bundle,
    diagnostics,
    captureWarnings: captureWarnings.map(normalizeCaptureWarning).filter(Boolean),
  });
  validateCaptureResult(result);
  return result;
}

export function createCaptureFailureResult({
  stage = "page_fetch",
  reason,
  message,
  retryable = true,
  sourceUrl,
  diagnostics = [],
}) {
  const result = {
    version: captureResultVersion,
    ok: false,
    failure: removeUndefined({
      stage: clean(stage) ?? "page_fetch",
      reason: normalizeFailureReason(reason),
      message: clean(message) ?? "Capture failed.",
      retryable: Boolean(retryable),
      sourceUrl: sourceUrl ? requireUrl(sourceUrl, "sourceUrl") : undefined,
      diagnostics,
    }),
  };
  validateCaptureResult(result);
  return result;
}

export function validateCaptureResult(result) {
  if (result?.version !== captureResultVersion) {
    throw new Error("capture_result_version_invalid");
  }
  if (result.ok === true) {
    validateCapturedArticleBundle(result.bundle);
    if (!Array.isArray(result.diagnostics)) {
      throw new Error("capture_result_diagnostics_invalid");
    }
    return true;
  }
  if (result.ok !== false) throw new Error("capture_result_ok_invalid");
  const failure = result.failure;
  if (!clean(failure?.stage)) throw new Error("capture_result_failure_stage_required");
  if (!captureFailureReasons.has(failure?.reason)) {
    throw new Error("capture_result_failure_reason_invalid");
  }
  if (!clean(failure?.message)) {
    throw new Error("capture_result_failure_message_required");
  }
  if (failure.sourceUrl) requireUrl(failure.sourceUrl, "sourceUrl");
  if (!Array.isArray(failure.diagnostics)) {
    throw new Error("capture_result_failure_diagnostics_invalid");
  }
  return true;
}

export function articleBundleToExtractionInput(bundle) {
  validateCapturedArticleBundle(bundle);
  return {
    articleSnapshot: articleBundleToArticleSnapshot(bundle),
    evidenceAssets: articleBundleToEvidenceAssets(bundle),
  };
}

export function articleBundleToArticleSnapshot(bundle) {
  validateCapturedArticleBundle(bundle);
  const text = String(bundle.text ?? "");
  const imageEvidenceAssetIds = bundle.images
    .map((image) => evidenceAssetIdFor(bundle, image))
    .filter(Boolean);
  return removeUndefined({
    sourceId: bundle.sourceId,
    sourceName: bundle.sourceName,
    canonicalUrl: bundle.canonicalUrl ?? bundle.sourceUrl,
    finalUrl: bundle.finalUrl,
    title: bundle.title,
    authorName: bundle.authorName,
    publishedAt: bundle.publishedAt,
    capturedAt: bundle.capturedAt,
    languageHints: bundle.languageHints ?? [],
    captureMode: bundle.captureMode,
    visibleText: text,
    textHash: hashText(text),
    evidenceAssetIds: imageEvidenceAssetIds,
    contentHash: bundle.contentHash,
  });
}

export function articleBundleToEvidenceAssets(bundle) {
  validateCapturedArticleBundle(bundle);
  return bundle.images.map((image) =>
    removeUndefined({
      assetId: evidenceAssetIdFor(bundle, image),
      articleUrl: bundle.sourceUrl,
      role: normalizeImageRole(image.role),
      mediaType: "image",
      sourceUrl: clean(image.sourceUrl),
      storagePath: clean(image.storagePath) ?? clean(image.path),
      width: positiveInteger(image.width),
      height: positiveInteger(image.height),
      contentHash:
        clean(image.contentHash) ??
        hashText(
          [
            bundle.sourceUrl,
            image.id,
            image.sourceUrl ?? "",
            image.storagePath ?? "",
            image.path ?? "",
          ].join("\n"),
        ),
      textContent: clean(image.textContent) ?? clean(image.alt),
      extractedBy: image.extractedBy ?? "dom",
      confidence: boundedNumber(image.confidence),
    }),
  );
}

function normalizeBundleImage(image, index) {
  return removeUndefined({
    id: clean(image.id) ?? `image-${String(index + 1).padStart(3, "0")}`,
    path: clean(image.path),
    sourceUrl: clean(image.sourceUrl),
    storagePath: clean(image.storagePath),
    role: clean(image.role) ?? "article_image",
    width: positiveInteger(image.width),
    height: positiveInteger(image.height),
    contentHash: clean(image.contentHash),
    assetId: clean(image.assetId),
    alt: clean(image.alt),
    textContent: clean(image.textContent),
    extractedBy: image.extractedBy,
    confidence: boundedNumber(image.confidence),
  });
}

function normalizeBundleLink(link, baseUrl) {
  if (!link) return undefined;
  const url = normalizeUrl(link.url ?? link.href, baseUrl);
  if (!url) return undefined;
  return removeUndefined({
    url,
    text: clean(link.text) ?? clean(link.label),
    role: clean(link.role),
    source: clean(link.source),
  });
}

function normalizeMiniProgram(entry) {
  if (!entry) return undefined;
  const appId = clean(entry.appId) ?? clean(entry.appid);
  const path = clean(entry.path);
  const url = clean(entry.url);
  if (!appId && !path && !url) return undefined;
  return removeUndefined({
    appId,
    path,
    url,
    text: clean(entry.text) ?? clean(entry.label),
    actionType: clean(entry.actionType) ?? clean(entry.role),
    source: clean(entry.source),
  });
}

function hasReadableCaptureMaterial(bundle) {
  return Boolean(
    String(bundle.text ?? "").trim() ||
      String(bundle.html ?? "").trim() ||
      bundle.images?.length ||
      bundle.links?.length ||
      bundle.miniPrograms?.length,
  );
}

function normalizeCaptureWarning(warning) {
  if (!warning) return undefined;
  const code = clean(warning.code) ?? clean(warning.key);
  if (!code) return undefined;
  return removeUndefined({
    code,
    message: clean(warning.message) ?? code,
    severity: clean(warning.severity),
  });
}

function normalizeFailureReason(reason) {
  const value = clean(reason);
  return captureFailureReasons.has(value) ? value : "browser_error";
}

function evidenceAssetIdFor(bundle, image) {
  return (
    image.assetId ??
    createStableId("asset", [
      bundle.sourceUrl,
      image.id,
      image.contentHash,
      image.sourceUrl,
      image.storagePath,
      image.path,
    ])
  );
}

function normalizeImageRole(role) {
  const value = clean(role);
  return [
    "cover",
    "poster",
    "qr",
    "registration",
    "screenshot",
    "article_image",
    "ocr_text",
    "visual_analysis_summary",
  ].includes(value)
    ? value
    : "article_image";
}

function createStableId(prefix, parts) {
  return `${prefix}-${hashText(parts.map((part) => String(part ?? "")).join("\u001f")).slice(0, 24)}`;
}

function hashBundleContent(value) {
  return hashText(JSON.stringify(value));
}

function hashText(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function normalizeUrl(value, baseUrl) {
  const text = clean(value);
  if (!text) return undefined;
  try {
    return new URL(text, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function requireUrl(value, field) {
  const text = clean(value);
  if (!text) throw new Error(`captured_bundle_${field}_required`);
  try {
    return new URL(text).toString();
  } catch {
    throw new Error(`captured_bundle_${field}_invalid`);
  }
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function boundedNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1
    ? number
    : undefined;
}

function uniqueStrings(values) {
  return [...new Set((values ?? []).filter((value) => clean(value)).map(String))];
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function removeUndefined(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}
