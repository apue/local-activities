import { createHash } from "node:crypto";

import { validateCapturedArticleBundle } from "../capture/article-bundle.mjs";

export const articleBundleFileVersion = "article-bundle-v1";
export const defaultArticleBundlesBucket = "article-bundles";
export const allowedDataClasses = new Set(["production", "eval", "test", "smoke"]);

export function buildArticleBundleFiles({
  bundle,
  dataClass,
  bucket = defaultArticleBundlesBucket,
  bundleId,
}) {
  validateCapturedArticleBundle(bundle);
  const resolvedDataClass = normalizeDataClass(dataClass);
  const resolvedBundleId = bundleId ?? createArticleBundleId({
    bundle,
    dataClass: resolvedDataClass,
  });
  const storagePrefix = `${bucket}/${resolvedDataClass}/${resolvedBundleId}`;
  const images = (bundle.images ?? []).map((image) =>
    imageManifestRecord({ image, bundleId: resolvedBundleId }),
  );
  const links = bundle.links ?? [];
  const diagnostics = [
    ...(bundle.diagnostics ?? []),
    ...(bundle.captureWarnings ?? []).map((warning) => ({
      key: "capture_warning",
      value: warning.code,
      message: warning.message,
      severity: warning.severity,
    })),
  ];
  const manifest = removeUndefined({
    bundleVersion: articleBundleFileVersion,
    capturedBundleVersion: bundle.version,
    bundleId: resolvedBundleId,
    captureId: bundle.captureId,
    sourceProvider: bundle.provider,
    sourceId: bundle.sourceId,
    sourceName: bundle.sourceName,
    sourceUrl: bundle.sourceUrl,
    canonicalUrl: bundle.canonicalUrl ?? bundle.sourceUrl,
    finalUrl: bundle.finalUrl,
    title: bundle.title,
    authorName: bundle.authorName,
    publishedAt: bundle.publishedAt,
    capturedAt: bundle.capturedAt,
    contentHash: bundle.contentHash,
    captureMode: bundle.captureMode,
    languageHints: bundle.languageHints ?? [],
    dataClass: resolvedDataClass,
    images,
    links,
    miniPrograms: bundle.miniPrograms ?? [],
    diagnostics,
  });

  const files = [
    jsonFile("manifest.json", manifest),
    textFile("article.html", bundle.html ?? ""),
    textFile("article.txt", bundle.text ?? ""),
    jsonFile("links.json", {
      links,
      miniPrograms: bundle.miniPrograms ?? [],
    }),
    jsonFile("diagnostics.json", {
      diagnostics,
      captureWarnings: bundle.captureWarnings ?? [],
    }),
    ...imageReferenceFiles(bundle.images ?? []),
  ];

  return {
    bundleId: resolvedBundleId,
    bucket,
    storagePrefix,
    manifest,
    files,
  };
}

export function createArticleBundleId({ bundle, dataClass }) {
  validateCapturedArticleBundle(bundle);
  const resolvedDataClass = normalizeDataClass(dataClass);
  return `bundle_${hashText(`${bundle.sourceUrl}\n${bundle.contentHash}\n${resolvedDataClass}`).slice(0, 24)}`;
}

export function edgePayloadFromManifest({ manifest, storagePrefix }) {
  return removeUndefined({
    sourceUrl: manifest.sourceUrl,
    publishedAt: manifest.publishedAt,
    bundleId: manifest.bundleId,
    storagePrefix,
    contentHash: manifest.contentHash,
    sourceProvider: manifest.sourceProvider,
    sourceId: manifest.sourceId,
    sourceName: manifest.sourceName,
    dataClass: manifest.dataClass,
  });
}

function imageReferenceFiles(images) {
  return images.map((image) => {
    const record = imageManifestRecord({ image });
    if (record.hasBytes) {
      return imageFile(record.path, imageBody(image), record.contentType);
    }
    return jsonFile(record.path, record);
  });
}

function imageManifestRecord({ image }) {
  const hasBytes = Boolean(image.bytes ?? image.body);
  const extension = image.extension ?? extensionFromContentType(image.contentType);
  const path = hasBytes
    ? `images/${image.id}${extension ? `.${extension}` : ""}`
    : `images/${image.id}.reference.json`;
  return removeUndefined({
    ...image,
    bytes: undefined,
    body: undefined,
    path,
    hasBytes,
  });
}

function extensionFromContentType(contentType) {
  const value = clean(contentType)?.toLowerCase();
  if (value === "image/jpeg" || value === "image/jpg") return "jpg";
  if (value === "image/png") return "png";
  if (value === "image/webp") return "webp";
  return undefined;
}

function jsonFile(path, value) {
  return {
    path,
    body: `${JSON.stringify(value, null, 2)}\n`,
    contentType: "application/json",
  };
}

function imageFile(path, body, contentType) {
  return {
    path,
    body,
    contentType: contentType ?? "application/octet-stream",
  };
}

function textFile(path, body) {
  return {
    path,
    body: String(body ?? ""),
    contentType: path.endsWith(".html") ? "text/html" : "text/plain",
  };
}

function imageBody(image) {
  return image.bytes ?? image.body;
}

function hashText(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

export function normalizeDataClass(value = "production") {
  const text = clean(value) ?? "production";
  if (!allowedDataClasses.has(text)) throw new Error(`invalid_data_class:${text}`);
  return text;
}

function removeUndefined(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}
