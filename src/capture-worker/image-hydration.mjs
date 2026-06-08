import { createHash } from "node:crypto";

const defaultMaxImages = 8;
const defaultMaxBytes = 5_000_000;
const defaultTimeoutMs = 15_000;

export async function hydrateArticleBundleImages({
  bundle,
  fetchImpl = fetch,
  maxImages = defaultMaxImages,
  maxBytes = defaultMaxBytes,
  timeoutMs = defaultTimeoutMs,
}) {
  if (!bundle?.images?.length) return bundle;
  const images = [];
  const captureWarnings = [...(bundle.captureWarnings ?? [])];
  let attemptedCount = 0;

  for (const image of bundle.images) {
    if (image.bytes || image.body || attemptedCount >= maxImages) {
      images.push(image);
      continue;
    }

    const sourceUrl = clean(image.sourceUrl);
    if (!sourceUrl) {
      images.push(image);
      continue;
    }

    attemptedCount += 1;
    const hydrated = await hydrateOneImage({
      image,
      articleUrl: bundle.sourceUrl,
      fetchImpl,
      maxBytes,
      timeoutMs,
    });
    if (hydrated.warning) captureWarnings.push(hydrated.warning);
    images.push(hydrated.image);
  }

  return {
    ...bundle,
    images,
    captureWarnings,
  };
}

async function hydrateOneImage({
  image,
  articleUrl,
  fetchImpl,
  maxBytes,
  timeoutMs,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fetchUrl = fetchableImageUrl(image.sourceUrl);
  const normalizedImage = { ...image, sourceUrl: fetchUrl };
  try {
    const response = await fetchImpl(fetchUrl, {
      signal: controller.signal,
      headers: {
        referer: articleUrl,
        "user-agent":
          "Mozilla/5.0 AppleWebKit/537.36 Chrome/125.0 Safari/537.36 local-activities-capture",
      },
    });
    if (!response.ok) {
      return withWarning(
        normalizedImage,
        "image_fetch_failed",
        `HTTP ${response.status}`,
      );
    }

    const contentType = normalizeImageContentType(
      response.headers.get("content-type"),
    );
    if (!contentType) {
      return withWarning(
        normalizedImage,
        "image_content_type_unsupported",
        response.headers.get("content-type") ?? "missing content type",
      );
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) {
      return withWarning(normalizedImage, "image_empty", "empty image body");
    }
    if (bytes.byteLength > maxBytes) {
      return withWarning(
        normalizedImage,
        "image_too_large",
        `${bytes.byteLength} bytes exceeds ${maxBytes}`,
      );
    }

    return {
      image: {
        ...normalizedImage,
        bytes,
        contentType,
        contentHash: hashBytes(bytes),
      },
      didHydrate: true,
    };
  } catch (error) {
    return withWarning(normalizedImage, "image_fetch_failed", errorMessage(error));
  } finally {
    clearTimeout(timer);
  }
}

function fetchableImageUrl(sourceUrl) {
  const decoded = decodeBasicHtmlEntities(sourceUrl);
  try {
    const url = new URL(decoded);
    if (
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname) &&
      url.pathname.includes("/img-proxy")
    ) {
      const upstream = url.searchParams.get("u");
      if (upstream) return upstream;
    }
    return url.toString();
  } catch {
    return decoded;
  }
}

function withWarning(image, code, message) {
  return {
    image,
    didHydrate: false,
    warning: {
      code,
      message,
      severity: "warning",
      imageId: image.id,
      sourceUrl: image.sourceUrl,
    },
  };
}

function normalizeImageContentType(value) {
  const contentType = String(value ?? "").split(";")[0].trim().toLowerCase();
  return ["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(
      contentType,
    )
    ? contentType === "image/jpg" ? "image/jpeg" : contentType
    : undefined;
}

function hashBytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function decodeBasicHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
