import { createHash } from "node:crypto";

export const capturedArticleBundleVersion = "captured-article-bundle-v1";

export function createCapturedArticleBundle({
  captureId,
  sourceId,
  sourceName,
  provider,
  sourceUrl,
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
  diagnostics = [],
}) {
  const bundle = removeUndefined({
    version: capturedArticleBundleVersion,
    captureId:
      clean(captureId) ??
      createStableId("capture", [sourceUrl, finalUrl, capturedAt, text]),
    sourceId: clean(sourceId),
    sourceName: clean(sourceName),
    provider: clean(provider) ?? "unknown",
    sourceUrl: requireUrl(sourceUrl, "sourceUrl"),
    finalUrl: requireUrl(finalUrl ?? sourceUrl, "finalUrl"),
    title: clean(title),
    authorName: clean(authorName),
    publishedAt: clean(publishedAt),
    capturedAt,
    languageHints: uniqueStrings(languageHints),
    captureMode,
    text: String(text ?? ""),
    html: html == null ? undefined : String(html),
    images: images.map(normalizeBundleImage),
    diagnostics,
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
  requireUrl(bundle.finalUrl, "finalUrl");
  if (!clean(bundle.capturedAt)) throw new Error("captured_bundle_captured_at_required");
  if (!String(bundle.text ?? "").trim()) {
    throw new Error("captured_bundle_text_required");
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
    canonicalUrl: bundle.sourceUrl,
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
    contentHash: hashText(
      JSON.stringify({
        sourceUrl: bundle.sourceUrl,
        text,
    images: bundle.images.map((image) => ({
      id: image.id,
      assetId: image.assetId,
      role: image.role,
      contentHash: image.contentHash,
      sourceUrl: image.sourceUrl,
      storagePath: image.storagePath,
      path: image.path,
    })),
  }),
    ),
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
    extractedBy: image.extractedBy,
    confidence: boundedNumber(image.confidence),
  });
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
    "vision_summary",
  ].includes(value)
    ? value
    : "article_image";
}

function createStableId(prefix, parts) {
  return `${prefix}-${hashText(parts.map((part) => String(part ?? "")).join("\u001f")).slice(0, 24)}`;
}

function hashText(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
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
