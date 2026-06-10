import { createHash } from "node:crypto";

const payloadVersion = "2026-05-collector-v1";

export function extractImageCandidatesFromHtml(html, { articleUrl } = {}) {
  if (!html) return [];

  const candidates = [];
  const imageTagPattern = /<img\b[^>]*>/gi;
  for (const match of html.matchAll(imageTagPattern)) {
    const tag = match[0];
    const url =
      readAttribute(tag, "data-src") ??
      readAttribute(tag, "data-original") ??
      readAttribute(tag, "src");
    const normalizedUrl = normalizeImageUrl(url, articleUrl);
    if (!normalizedUrl) continue;
    candidates.push(
      removeUndefined({
        url: normalizedUrl,
        alt: readAttribute(tag, "alt"),
        width: readPositiveInteger(readAttribute(tag, "width")),
        height: readPositiveInteger(readAttribute(tag, "height")),
        source: "html_img",
      }),
    );
  }

  const backgroundPattern = /url\((['"]?)(.*?)\1\)/gi;
  for (const match of html.matchAll(backgroundPattern)) {
    const normalizedUrl = normalizeImageUrl(match[2], articleUrl);
    if (!normalizedUrl) continue;
    candidates.push({
      url: normalizedUrl,
      source: "css_background",
    });
  }

  return dedupeCandidates(candidates).slice(0, 24);
}

export function classifyImageCandidate(candidate) {
  const roleHint = String(candidate.role ?? candidate.sourceRole ?? "")
    .trim()
    .toLowerCase();
  if (["qr", "registration", "registration_qr"].includes(roleHint)) return "qr";
  if (roleHint === "poster") return "poster";

  const labelText = [
    candidate.alt,
    candidate.text,
    candidate.textContent,
    candidate.caption,
    candidate.nearbyText,
    candidate.ariaLabel,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/二维码|扫码|报名|预约|qr\s*code|qrcode|registration|register|sign\s*up|reserve/.test(labelText)) {
    return "qr";
  }
  const posterText = `${labelText} ${candidate.url ?? ""}`.toLowerCase();
  if (/poster|海报|活动|event|展览|festival|讲座/.test(posterText)) return "poster";
  if (
    candidate.width >= 480 &&
    candidate.height >= 480 &&
    candidate.height / Math.max(candidate.width, 1) >= 0.75
  ) {
    return "poster";
  }
  return "article_image";
}

export function buildImageEvidenceAssetEnvelopes({
  collectorId,
  runId,
  observedAt,
  articleUrl,
  imageCandidates,
  storeImages = false,
  fetchImpl = fetch,
  putPublicAsset,
}) {
  const envelopes = imageCandidates.map((candidate) => {
    const role = classifyImageCandidate(candidate);
    const contentHash = hashText(candidate.url);
    const assetHash = hashText(`${articleUrl}\n${role}\n${candidate.url}`);
    return {
      collectorId,
      runId,
      observedAt,
      payloadVersion,
      payload: removeUndefined({
        assetId: `asset-${assetHash.slice(0, 24)}`,
        articleUrl,
        role,
        mediaType: "image",
        sourceUrl: candidate.url,
        width: candidate.width,
        height: candidate.height,
        contentHash,
        extractedBy: "dom",
        confidence: role === "article_image" ? 0.55 : 0.8,
        textContent: candidateText(candidate),
      }),
    };
  });

  if (!storeImages || typeof putPublicAsset !== "function") return envelopes;
  return Promise.all(
    envelopes.map((envelope) =>
      withStoredImageEvidence({ envelope, fetchImpl, putPublicAsset }),
    ),
  );
}

export async function storeImageEvidenceAssets({
  evidenceAssets,
  fetchImpl = fetch,
  putPublicAsset,
}) {
  if (typeof putPublicAsset !== "function") return evidenceAssets;
  return Promise.all(
    evidenceAssets.map(async (payload) => {
      const envelope = await withStoredImageEvidence({
        envelope: { payload },
        fetchImpl,
        putPublicAsset,
      });
      return envelope.payload;
    }),
  );
}

export function captureModeForImageEvidence({ visibleText, evidenceAssets }) {
  const roles = evidenceAssets.map((asset) => asset.payload.role);
  const hasQr = roles.includes("qr") || roles.includes("registration");
  const hasPoster = roles.includes("poster");
  const hasText = Boolean(visibleText?.trim());
  if (hasQr && hasPoster) return "image_with_qr_registration";
  if (hasQr) return "text_with_qr_registration";
  if (!hasText && hasPoster) return "image_dominant";
  return "text_complete";
}

function readAttribute(tag, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, "i");
  return tag.match(pattern)?.[2]?.trim() || undefined;
}

function normalizeImageUrl(value, articleUrl) {
  const text = value?.trim();
  if (!text || text.startsWith("data:")) return undefined;
  try {
    return new URL(text, articleUrl).toString();
  } catch {
    return undefined;
  }
}

function readPositiveInteger(value) {
  const number = Number.parseInt(value ?? "", 10);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const result = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    result.push(candidate);
  }
  return result;
}

function hashText(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hashBytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function candidateText(candidate) {
  const text = [
    candidate.alt,
    candidate.text,
    candidate.textContent,
    candidate.caption,
    candidate.nearbyText,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  return text || undefined;
}

async function withStoredImageEvidence({ envelope, fetchImpl, putPublicAsset }) {
  try {
    const sourceUrl = envelope.payload.sourceUrl;
    if (!sourceUrl) return envelope;

    const response = await fetchImpl(sourceUrl);
    if (!response.ok) return envelope;

    const contentType = normalizeImageContentType(
      response.headers.get("content-type"),
    );
    if (!contentType) return envelope;

    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.byteLength > 5_000_000) return envelope;

    const storageRole = storageRoleForEvidenceRole(envelope.payload.role);
    const stored = await putPublicAsset({
      bytes,
      contentType,
      keyHint: envelope.payload.assetId,
      role: storageRole,
    });

    return {
      ...envelope,
      payload: removeUndefined({
        ...envelope.payload,
        storagePath: stored.url,
        contentHash: hashBytes(bytes),
      }),
    };
  } catch {
    return envelope;
  }
}

function storageRoleForEvidenceRole(role) {
  if (role === "qr" || role === "registration") return "registration_qr";
  if (role === "poster") return "poster";
  if (role === "screenshot") return "screenshot";
  return "article_image";
}

function normalizeImageContentType(value) {
  const contentType = String(value ?? "").split(";")[0].trim().toLowerCase();
  return ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
    contentType,
  )
    ? contentType
    : undefined;
}

function removeUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, innerValue]) => innerValue !== undefined),
  );
}
